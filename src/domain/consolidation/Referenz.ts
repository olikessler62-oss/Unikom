import { naheliegende, type Naheliegend } from './Aehnlichkeit.js';
import { einfrieren } from './Profil.js';
import type { Datensatz, Datenstand } from './Quellen.js';
import { STANDARDVERGLEICH, TRENNER, vergleichswert, type Vergleich } from './Schluessel.js';

/**
 * Referenzdaten und Referenzabgleich (SPEC-04, Abschnitt 6).
 *
 * Eine Referenz ist kein weiterer Eingang, sondern ein Nachschlagewerk: Der
 * Postleitzahlenbestand, die Artikelliste, die Kundenstammdaten. Sie beantwortet
 * zwei Fragen — **kennt sie diesen Wert?** und, wenn ausdrücklich eingerichtet,
 * **was weiß sie sonst noch darüber?**
 *
 * ```text
 * ein Treffer      →  darf automatisch übernommen werden
 * kein Treffer     →  Warnung, Konflikt oder Ignorieren — je nach Profil
 * mehrere Treffer  →  niemals automatisch; das entscheidet ein Mensch
 * ```
 *
 * Die dritte Zeile ist die wichtigste. Zwei plausible Treffer sind keine
 * Auswahl, sondern eine Frage; wer hier den ersten nimmt, hat eine Münze
 * geworfen und das Ergebnis als Tatsache eingetragen.
 *
 * ## Referenzdaten werden nur gelesen
 *
 * „Eine Konsolidierung darf die Referenzdaten nicht verändern" (SPEC-04,
 * Abschnitt 6). Das steht hier nicht als guter Vorsatz, sondern als
 * eingefrorenes Objekt: Der Index friert den Bestand ein, und ein Schreibversuch
 * wirft — nicht erst beim Kunden, sondern im ersten Test, der es probiert.
 */
export interface Referenzbestand {
  id: string;
  name: string;
  /**
   * Welcher Datenstand verwendet wurde (SPEC-04, Abschnitt 6, „Referenzversion";
   * SPEC-06, Abschnitt 13). Ein Lauf, der sich nicht auf eine Version berufen
   * kann, ist nicht reproduzierbar.
   */
  version?: string;
  stand?: Datenstand;
  felder: readonly string[];
  zeilen: readonly (readonly string[])[];
}

export type OhneTreffer = 'WARNUNG' | 'KONFLIKT' | 'IGNORIEREN';

export interface Referenzregel {
  /** Die Felder des Datensatzes, mit denen nachgeschlagen wird. */
  felder: readonly string[];
  /** Wie dieselben Felder in der Referenz heißen; ohne Angabe gleich. */
  referenzfelder?: readonly string[];
  vergleich?: Vergleich;
  /**
   * Welche Werte übernommen werden: Zielfeld ← Referenzfeld.
   *
   * Ohne diese Angabe wird nur geprüft. „Dies muss ausdrücklich im Profil
   * definiert sein" (SPEC-04, Abschnitt 6) — eine Referenz, die ungefragt Werte
   * in den Bestand schreibt, wäre eine zweite Datenquelle, die niemand
   * ausgewählt hat.
   */
  uebernehmen?: readonly { feld: string; aus: string }[];
  /** Was gilt, wenn nichts gefunden wird. Voreinstellung: `WARNUNG`. */
  ohneTreffer?: OhneTreffer;
  /**
   * Bei einem Fehltreffer nachsehen, was am nächsten liegt (SPEC-04,
   * Abschnitt 6, „optional Fuzzy Matching").
   *
   * Ändert am Ausgang **nichts**: Kein Treffer bleibt kein Treffer, und
   * übernommen wird nichts. Die Meldung bekommt nur den nächsten Schritt
   * dazu — „kein Eintrag; am nächsten liegt 53111" statt „kein Eintrag".
   */
  aehnlich?: boolean | { schwelle?: number };
}

export interface Uebernahme {
  feld: string;
  wert: string;
  /** Das Referenzfeld, aus dem er stammt. */
  aus: string;
  /** Ob dabei etwas überschrieben wurde. */
  ueberschrieben?: string;
}

export type Abgleich =
  | { art: 'TREFFER'; zeile: number; uebernahmen: Uebernahme[]; begruendung: string }
  | { art: 'KEIN_TREFFER'; folge: OhneTreffer; meldung: string; gesucht: string; naheliegend?: Naheliegend[] }
  | { art: 'MEHRDEUTIG'; zeilen: number[]; meldung: string; gesucht: string }
  | { art: 'UNVOLLSTAENDIG'; fehlend: string[]; meldung: string };

/**
 * Der Index über einen Referenzbestand.
 *
 * Ein Bestand mit fünfzigtausend Postleitzahlen wird nicht je Datensatz
 * durchlaufen. Der Index wird einmal gebaut und dann befragt — und er hält den
 * Bestand fest, damit die Version, gegen die abgeglichen wurde, im Bericht
 * genannt werden kann.
 */
export interface Referenzindex {
  bestand: Referenzbestand;
  regel: Referenzregel;
  /** Vergleichsschlüssel → Zeilennummern der Referenz, ab 1. */
  stellen: Map<string, number[]>;
  /** Wie derselbe Schlüssel lesbar aussieht — für Meldungen. */
  klartext: Map<string, string>;
}

function referenzfelderFuer(regel: Referenzregel): readonly string[] {
  return regel.referenzfelder && regel.referenzfelder.length > 0 ? regel.referenzfelder : regel.felder;
}

export function referenzindex(bestand: Referenzbestand, regel: Referenzregel): Referenzindex {
  /*
   * Eingefroren, bevor irgendjemand ihn zu sehen bekommt. `readonly` ist eine
   * Zusage an den Übersetzer und nach dem Übersetzen verschwunden; das hier
   * hält auch dann, wenn der Aufrufer aus JavaScript kommt.
   */
  const geschuetzt = einfrieren(bestand);
  const felder = referenzfelderFuer(regel);
  const vergleich = regel.vergleich ?? STANDARDVERGLEICH;
  const stellen = new Map<string, number[]>();
  const klartext = new Map<string, string>();

  const spalten = felder.map((feld) => geschuetzt.felder.indexOf(feld));

  geschuetzt.zeilen.forEach((zeile, stelle) => {
    const teile = spalten.map((spalte) => (spalte >= 0 ? (zeile[spalte] ?? '') : ''));

    if (teile.some((teil) => teil.trim() === '')) {
      // Eine Referenzzeile ohne Schlüssel kann nichts beantworten. Sie
      // aufzunehmen hieße, einen leeren Schlüssel zum Treffer zu machen.
      return;
    }

    const schluessel = teile.map((teil) => vergleichswert(teil, vergleich)).join(TRENNER);
    stellen.set(schluessel, [...(stellen.get(schluessel) ?? []), stelle + 1]);

    if (!klartext.has(schluessel)) {
      klartext.set(schluessel, teile.join(' | '));
    }
  });

  return { bestand: geschuetzt, regel, stellen, klartext };
}

/** Der Wert einer Referenzzeile. */
export function referenzwert(bestand: Referenzbestand, zeile: number, feld: string): string {
  const spalte = bestand.felder.indexOf(feld);

  return spalte >= 0 ? (bestand.zeilen[zeile - 1]?.[spalte] ?? '') : '';
}

export function gleicheAb(datensatz: Datensatz, index: Referenzindex): Abgleich {
  const vergleich = index.regel.vergleich ?? STANDARDVERGLEICH;
  const teile: string[] = [];
  const fehlend: string[] = [];

  for (const feld of index.regel.felder) {
    const wert = datensatz.werte.get(feld) ?? '';

    if (wert.trim() === '') {
      fehlend.push(feld);
    } else {
      teile.push(wert);
    }
  }

  if (fehlend.length > 0) {
    return {
      art: 'UNVOLLSTAENDIG',
      fehlend,
      meldung:
        `Für den Abgleich gegen „${index.bestand.name}" fehlt ${fehlend.map((feld) => `„${feld}"`).join(' und ')}. ` +
        'Mit einem unvollständigen Schlüssel zu suchen, träfe irgendetwas',
    };
  }

  const gesucht = teile.join(' | ');
  const gesuchterSchluessel = teile.map((teil) => vergleichswert(teil, vergleich)).join(TRENNER);
  const gefunden = index.stellen.get(gesuchterSchluessel) ?? [];

  if (gefunden.length === 0) {
    const folge = index.regel.ohneTreffer ?? 'WARNUNG';
    const nah = naheAn(gesuchterSchluessel, index);

    return {
      art: 'KEIN_TREFFER',
      folge,
      gesucht,
      naheliegend: nah.length > 0 ? nah : undefined,
      meldung:
        `„${gesucht}" steht nicht in „${index.bestand.name}"` +
        (index.bestand.version ? ` (Stand ${index.bestand.version})` : '') +
        '. ' +
        (nah.length > 0
          ? `Am nächsten liegt ${nah
              .map((eintrag) => `„${eintrag.wert}" (${Math.round(eintrag.aehnlichkeit * 100)} %)`)
              .join(', ')} — übernommen wird davon nichts, denn Ähnlichkeit ist keine Gleichheit. `
          : '') +
        (folge === 'KONFLIKT'
          ? 'Für diese Referenz ist eingerichtet, dass ein fehlender Treffer den Datensatz zur Prüfung gibt'
          : folge === 'WARNUNG'
            ? 'Der Datensatz läuft weiter; der Hinweis steht im Bericht'
            : 'Für diese Referenz ist eingerichtet, dass ein fehlender Treffer nichts bedeutet'),
    };
  }

  if (gefunden.length > 1) {
    return {
      art: 'MEHRDEUTIG',
      zeilen: gefunden,
      gesucht,
      meldung:
        `„${gesucht}" trifft in „${index.bestand.name}" auf ${gefunden.length} Einträge ` +
        `(Zeile ${gefunden.join(', ')}). Mehrere plausible Treffer sind nicht automatisch entscheidbar — ` +
        'sonst entschiede die Reihenfolge in der Referenzdatei',
    };
  }

  const zeile = gefunden[0];
  const uebernahmen: Uebernahme[] = [];

  for (const angabe of index.regel.uebernehmen ?? []) {
    const wert = referenzwert(index.bestand, zeile, angabe.aus);

    if (wert.trim() === '') {
      continue;
    }

    const vorher = datensatz.werte.get(angabe.feld) ?? '';

    uebernahmen.push({
      feld: angabe.feld,
      wert,
      aus: angabe.aus,
      ueberschrieben: vorher.trim() !== '' && vorher !== wert ? vorher : undefined,
    });
  }

  return {
    art: 'TREFFER',
    zeile,
    uebernahmen,
    begruendung:
      `„${gesucht}" ist in „${index.bestand.name}"` +
      (index.bestand.version ? ` (Stand ${index.bestand.version})` : '') +
      ` genau einmal vorhanden, in Zeile ${zeile}`,
  };
}

/**
 * Was dem Gesuchten am nächsten kommt — nur, wenn es eingerichtet ist.
 *
 * Verglichen wird auf den Vergleichsschlüsseln, gemeldet wird der Klartext.
 * Der Aufwand ist ein Durchlauf durch die Referenz, und er fällt nur an, wenn
 * nichts gefunden wurde: Bei einem sauberen Bestand kostet die Einstellung
 * also gar nichts.
 */
function naheAn(schluessel: string, index: Referenzindex): Naheliegend[] {
  if (!index.regel.aehnlich) {
    return [];
  }

  const schwelle = typeof index.regel.aehnlich === 'object' ? index.regel.aehnlich.schwelle : undefined;

  // `schluesselwert` und nicht `vergleichswert`: Der Name gehört schon der
  // importierten Funktion, und ein verdeckter Import ist der Fehler, den man
  // erst beim dritten Lesen sieht.
  const kandidaten = [...index.stellen.entries()].map(([schluesselwert, zeilen]) => ({
    zeile: zeilen[0],
    wert: schluesselwert,
  }));

  return naheliegende(schluessel, kandidaten, schwelle).map((treffer) => ({
    ...treffer,
    wert: index.klartext.get(treffer.wert) ?? treffer.wert,
  }));
}
