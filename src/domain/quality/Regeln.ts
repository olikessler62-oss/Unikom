import { parseDate } from '../consolidation/Dates.js';
import { parseNumber, separatorsOf } from '../consolidation/Numbers.js';
import { dateOrderOf, type Region } from '../tenants/Region.js';
import { leerart } from './Normalisierung.js';

/**
 * Fachliche Qualitätsregeln (SPEC-04, Abschnitt 5; SPEC-08, Abschnitt 5 bis 9).
 *
 * ```text
 * Kundennummer darf nicht leer sein.
 * E-Mail muss einem gültigen Format entsprechen.
 * Geburtsdatum darf nicht in der Zukunft liegen.
 * Menge darf nicht negativ sein.
 * WENN Zahlungsart = "Lastschrift" DANN muss IBAN vorhanden sein.
 * ```
 *
 * ## Nicht jede Auffälligkeit blockiert
 *
 * SPEC-08, Abschnitt 9, ist an dieser Stelle ausdrücklich: Eine Verarbeitung
 * darf nur blockiert werden, wenn eine sichere Verarbeitung nicht möglich ist.
 * Vier Stufen, und drei davon lassen die Daten durch:
 *
 * ```text
 * INFO      →  fällt auf, ändert nichts
 * WARNUNG   →  ungewöhnlich, aber möglicherweise richtig
 * KONFLIKT  →  dieser Datensatz geht an einen Menschen, die anderen laufen weiter
 * FEHLER    →  hier ist nichts sicher zu verarbeiten
 * ```
 *
 * ## Ursache und Auswirkung, getrennt
 *
 * „Die Ursache und Auswirkung jeder Warnung oder jedes Fehlers müssen dem
 * Benutzer in verständlicher Sprache erklärt werden." Deshalb zwei Felder und
 * nicht eines: Ein einzelnes Textfeld füllt sich mit „Validierungsfehler in
 * Feld 3", und niemand weiß danach, was zu tun ist.
 */
export type Schwere = 'INFO' | 'WARNUNG' | 'KONFLIKT' | 'FEHLER';

export interface Befund {
  /** Die Zeile im Bestand, ab 1. */
  zeile: number;
  feld?: string;
  schwere: Schwere;
  /** Was ist — in Worten, die der Benutzer nachprüfen kann. */
  ursache: string;
  /** Was daraus folgt. */
  auswirkung: string;
  /** Der Wert, um den es geht. */
  wert?: string;
  /** Welche Regel angeschlagen hat. */
  regel?: string;
}

export type Pruefung =
  | { art: 'PFLICHT' }
  | { art: 'FORMAT'; muster: string; beschreibung: string }
  | { art: 'BEREICH'; min?: number; max?: number }
  | { art: 'NICHT_ZUKUNFT' }
  | { art: 'AUS_LISTE'; werte: readonly string[] };

export interface Qualitaetsregel {
  id: string;
  /** Wie sie einem Menschen gegenüber heißt. */
  name: string;
  feld: string;
  pruefung: Pruefung;
  schwere: Schwere;
  /**
   * Die Bedingung einer feldübergreifenden Regel: `WENN Zahlungsart =
   * "Lastschrift" DANN …`. Ohne sie gilt die Regel immer.
   */
  wenn?: { feld: string; ist: string };
  /** Was der Benutzer stattdessen lesen soll. */
  erklaerung?: string;
}

/** Ein Datensatz, wie die Prüfung ihn sieht: Feldname → Wert. */
export type Datensatz = ReadonlyMap<string, string>;

export interface Pruefoptionen {
  region: Region;
  nullWerte?: readonly string[];
  /** Der Bezugszeitpunkt für „nicht in der Zukunft" — der Test gibt ihn vor. */
  jetzt?: Date;
}

/** Ein paar Regeln, die Unikom mitbringt — sie gelten, bis jemand sie ändert. */
export const AUSGELIEFERTE_REGELN: readonly Qualitaetsregel[] = [
  {
    id: 'email-format',
    name: 'E-Mail muss ein gültiges Format haben',
    feld: 'email',
    pruefung: {
      art: 'FORMAT',
      muster: '^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$',
      beschreibung: 'etwas@etwas.endung, ohne Leerzeichen',
    },
    schwere: 'KONFLIKT',
  },
  {
    id: 'geburtsdatum-zukunft',
    name: 'Geburtsdatum darf nicht in der Zukunft liegen',
    feld: 'birthDate',
    pruefung: { art: 'NICHT_ZUKUNFT' },
    schwere: 'KONFLIKT',
  },
  {
    id: 'menge-negativ',
    name: 'Menge darf nicht negativ sein',
    feld: 'quantity',
    pruefung: { art: 'BEREICH', min: 0 },
    schwere: 'KONFLIKT',
  },
  {
    id: 'kundennummer-pflicht',
    name: 'Kundennummer darf nicht leer sein',
    feld: 'customerId',
    pruefung: { art: 'PFLICHT' },
    schwere: 'KONFLIKT',
  },
];

/**
 * Prüft einen Datensatz gegen die Regeln.
 *
 * Eine Regel, deren Bedingung nicht zutrifft, schweigt — sie meldet nicht
 * „nicht geprüft". Ein Bericht, der für jede nicht zutreffende Regel eine Zeile
 * enthält, ist einer, in dem niemand mehr das Wesentliche findet.
 */
export function pruefe(
  datensatz: Datensatz,
  zeile: number,
  regeln: readonly Qualitaetsregel[],
  options: Pruefoptionen
): Befund[] {
  const befunde: Befund[] = [];

  for (const regel of regeln) {
    if (regel.wenn) {
      const bedingung = datensatz.get(regel.wenn.feld);

      if ((bedingung ?? '').trim().toLowerCase() !== regel.wenn.ist.trim().toLowerCase()) {
        continue;
      }
    }

    /*
     * Ein Feld, das es in diesem Bestand gar nicht gibt, ist etwas anderes als
     * ein leeres Feld. Die Pflichtprüfung nimmt beides; die übrigen Prüfungen
     * schweigen, weil sie über etwas Nichtvorhandenes nichts sagen können.
     */
    const vorhanden = datensatz.has(regel.feld);
    const wert = datensatz.get(regel.feld) ?? '';
    const gefuellt = vorhanden && leerart(wert, options.nullWerte) === 'GEFUELLT';

    if (regel.pruefung.art === 'PFLICHT') {
      if (!gefuellt) {
        befunde.push({
          zeile,
          feld: regel.feld,
          schwere: regel.schwere,
          ursache: vorhanden ? `„${regel.feld}" ist leer` : `„${regel.feld}" kommt in diesem Bestand nicht vor`,
          auswirkung:
            regel.erklaerung ??
            (regel.wenn
              ? `Weil ${regel.wenn.feld} „${regel.wenn.ist}" ist, wird dieses Feld gebraucht`
              : 'Ohne diesen Wert lässt sich der Datensatz nicht eindeutig zuordnen'),
          regel: regel.name,
        });
      }

      continue;
    }

    if (!gefuellt) {
      continue;
    }

    const befund = pruefeWert(wert, regel, options);

    if (befund) {
      befunde.push({ ...befund, zeile, feld: regel.feld, schwere: regel.schwere, wert, regel: regel.name });
    }
  }

  return befunde;
}

function pruefeWert(
  wert: string,
  regel: Qualitaetsregel,
  options: Pruefoptionen
): { ursache: string; auswirkung: string } | undefined {
  switch (regel.pruefung.art) {
    case 'FORMAT':
      return new RegExp(regel.pruefung.muster).test(wert)
        ? undefined
        : {
            ursache: `„${wert}" entspricht nicht dem erwarteten Format`,
            auswirkung: regel.erklaerung ?? `Erwartet wird: ${regel.pruefung.beschreibung}`,
          };

    case 'BEREICH': {
      const zahl = parseNumber(wert, separatorsOf(options.region.locale));

      if (zahl === undefined) {
        return {
          ursache: `„${wert}" ist keine Zahl und lässt sich nicht gegen einen Wertebereich prüfen`,
          auswirkung: regel.erklaerung ?? 'Der Wert geht als Prüffall an einen Menschen',
        };
      }

      const { min, max } = regel.pruefung;

      if (min !== undefined && zahl < min) {
        return {
          ursache: `${zahl} liegt unter dem erlaubten Kleinstwert ${min}`,
          auswirkung: regel.erklaerung ?? `Für „${regel.feld}" ist alles unter ${min} nicht vorgesehen`,
        };
      }

      if (max !== undefined && zahl > max) {
        return {
          ursache: `${zahl} liegt über dem erlaubten Größtwert ${max}`,
          auswirkung: regel.erklaerung ?? `Für „${regel.feld}" ist alles über ${max} nicht vorgesehen`,
        };
      }

      return undefined;
    }

    case 'NICHT_ZUKUNFT': {
      const datum = parseDate(wert, dateOrderOf(options.region.locale));

      if (!datum) {
        return {
          ursache: `„${wert}" ist kein Datum in der Schreibweise dieser Region`,
          auswirkung: regel.erklaerung ?? 'Ohne ein lesbares Datum lässt sich nicht prüfen, ob es in der Zukunft liegt',
        };
      }

      const jetzt = options.jetzt ?? new Date();
      const heute = Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());

      return Date.UTC(datum.year, datum.month - 1, datum.day) <= heute
        ? undefined
        : {
            ursache: `${wert} liegt in der Zukunft`,
            auswirkung:
              regel.erklaerung ??
              'Häufig ist die Ursache eine zweistellige Jahreszahl, die ins falsche Jahrhundert gelesen wurde',
          };
    }

    case 'AUS_LISTE': {
      const erlaubt = regel.pruefung.werte;

      return erlaubt.some((eintrag) => eintrag.toLowerCase() === wert.trim().toLowerCase())
        ? undefined
        : {
            ursache: `„${wert}" steht nicht in der Liste der erlaubten Werte`,
            auswirkung: regel.erklaerung ?? `Erlaubt sind: ${erlaubt.join(', ')}`,
          };
    }

    default:
      // PFLICHT wird oben behandelt und kommt hier nicht an. Der Zweig steht
      // trotzdem da: Kommt eine Prüfung hinzu und wird hier vergessen, schweigt
      // sie — und das ist besser, als etwas Falsches zu melden.
      return undefined;
  }
}

/**
 * Ob die Verarbeitung nach diesen Befunden weitergehen darf.
 *
 * Nur ein **FEHLER** hält alles an. Ein Konflikt trennt den einen Datensatz ab
 * und lässt die übrigen laufen: „Gültige Datensätze sollen unabhängig davon
 * weiterverarbeitet werden können" (SPEC-08, Abschnitt 8).
 */
export function blockiert(befunde: readonly Befund[]): boolean {
  return befunde.some((befund) => befund.schwere === 'FEHLER');
}

/** Die Zeilen, die als Prüffall an einen Menschen gehen. */
export function zeilenMitKonflikt(befunde: readonly Befund[]): number[] {
  return [...new Set(befunde.filter((befund) => befund.schwere === 'KONFLIKT').map((befund) => befund.zeile))].sort(
    (links, rechts) => links - rechts
  );
}
