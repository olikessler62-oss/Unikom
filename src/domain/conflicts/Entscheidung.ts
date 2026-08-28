import type { FieldType } from '../consolidation/Recognition.js';
import { konvertiere } from '../quality/Konvertierung.js';
import { pruefe, type Befund, type Qualitaetsregel } from '../quality/Regeln.js';
import type { Region } from '../tenants/Region.js';
import type { Konfliktfall, Konfliktstatus, Streitfeld } from './Konfliktfall.js';

/**
 * Die Entscheidung eines Menschen über einen Konflikt (SPEC-07, Abschnitt 6
 * und 7).
 *
 * ## Die Vorschau ist dieselbe Rechnung
 *
 * „Vor der Bestätigung muss das erwartete Ergebnis der Entscheidung
 * nachvollziehbar dargestellt werden." Es gibt deshalb **eine** Funktion:
 * `wendeAn`. Die Vorschau ruft sie auf und speichert nicht; die Bestätigung
 * ruft sie auf und speichert. Zwei Rechnungen, die auseinanderlaufen können,
 * wären der sichere Weg zu einem Kunden, der etwas anderes bestätigt hat als
 * das, was danach passierte.
 *
 * ## Fachregeln gelten auch für Menschen
 *
 * „Die jeweils geltenden Mapping-, Datentyp-, Validierungs- und sonstigen
 * Fachregeln bleiben auch bei manueller Bearbeitung wirksam." Wer in ein
 * Ganzzahlfeld `1.234,56` tippt, bekommt denselben Konflikt wie die Automatik
 * — die manuelle Bearbeitung ist ein anderer Weg zur Entscheidung und kein
 * Weg an den Regeln vorbei.
 */
export type Feldwahl =
  /** Einen der vorliegenden Werte übernehmen. */
  | { art: 'QUELLE'; quelle: string }
  /** Selbst eingeben oder korrigieren. */
  | { art: 'EINGABE'; wert: string }
  /** Ausdrücklich leer lassen — etwas anderes als „nicht entschieden". */
  | { art: 'LEER' };

export interface Feldentscheidung {
  feld: string;
  wahl: Feldwahl;
}

export type Entscheidung =
  /** Werte festlegen; der Fall gilt danach als bereinigt. */
  | { art: 'BEREINIGEN'; felder: readonly Feldentscheidung[]; bemerkung?: string; regel?: string }
  /** Die Datensätze gehören zusammen — feldweise entschieden. */
  | { art: 'ZUSAMMENFUEHREN'; felder: readonly Feldentscheidung[]; bemerkung?: string; regel?: string }
  /** Sie gehören nicht zusammen; beide bleiben, wie sie sind. */
  | { art: 'NICHT_ZUSAMMENFUEHREN'; bemerkung?: string; regel?: string }
  /** Den Konflikt sehenden Auges hinnehmen (Abschnitt 6). */
  | { art: 'AKZEPTIEREN'; bemerkung?: string; regel?: string }
  /** Später — und das ist keine fachliche Entscheidung (Abschnitt 4). */
  | { art: 'ZURUECKSTELLEN'; bemerkung?: string }
  | { art: 'WIEDERAUFNEHMEN'; bemerkung?: string };

export interface Feldherkunft {
  feld: string;
  wert: string;
  /** Die Quelle, oder „Eingabe" — der Bericht soll beides unterscheiden. */
  quelle: string;
  begruendung: string;
}

export interface Anwendungsoptionen {
  region: Region;
  nullWerte?: readonly string[];
  jahrhundertGrenze?: number;
  /** Die fachlichen Regeln, die auch für eine Eingabe gelten. */
  qualitaet?: readonly Qualitaetsregel[];
  /**
   * Ob der Mandant erlaubt, einen Fall hinzunehmen statt ihn zu entscheiden.
   *
   * Fehlt die Angabe, ist es erlaubt — so war es, bevor es die Einstellung
   * gab. Eine fehlende Angabe zum Verbot zu lesen, hieße, jeden Aufrufer, der
   * sie noch nicht mitgibt, stillschweigend zu verriegeln.
   */
  akzeptierenErlaubt?: boolean;
  jetzt?: Date;
}

export interface Anwendung {
  /** Was aus dem Datensatz würde. */
  werte: Record<string, string>;
  herkunft: Feldherkunft[];
  /** Was gegen die Entscheidung spricht — leer heißt: nichts. */
  befunde: Befund[];
  /** Ob sie so bestätigt werden darf. */
  zulaessig: boolean;
  /** Der Status, den der Fall danach hätte. */
  status: Konfliktstatus;
  /** Was der Historieneintrag darüber sagen wird. */
  beschreibung: string;
}

/** Welchen Status eine Entscheidung herbeiführt. */
export function statusNach(entscheidung: Entscheidung): Konfliktstatus {
  switch (entscheidung.art) {
    case 'BEREINIGEN':
    case 'ZUSAMMENFUEHREN':
    case 'NICHT_ZUSAMMENFUEHREN':
      return 'BEREINIGT';

    case 'AKZEPTIEREN':
      return 'AKZEPTIERT';

    case 'ZURUECKSTELLEN':
      return 'ZURUECKGESTELLT';

    case 'WIEDERAUFNEHMEN':
      return 'OFFEN';
  }
}

function felderVon(entscheidung: Entscheidung): readonly Feldentscheidung[] {
  return entscheidung.art === 'BEREINIGEN' || entscheidung.art === 'ZUSAMMENFUEHREN' ? entscheidung.felder : [];
}

/**
 * Der Wert, der aus einer Feldwahl folgt — und woher er stammt.
 *
 * Eine Wahl, die auf eine Quelle zeigt, die es in diesem Feld nicht gibt, wird
 * nicht stillschweigend zu einem leeren Wert. Sie ist ein Befund: Wahrscheinlich
 * hat sich der Fall zwischen Ansicht und Bestätigung geändert, und dann ist die
 * Entscheidung nicht die, die der Benutzer treffen wollte.
 */
function werteAus(
  feld: Streitfeld,
  wahl: Feldwahl
): { wert: string; quelle: string; begruendung: string; fehlt?: string } {
  if (wahl.art === 'LEER') {
    return { wert: '', quelle: '-', begruendung: 'ausdrücklich leer gelassen' };
  }

  if (wahl.art === 'EINGABE') {
    return { wert: wahl.wert, quelle: 'Eingabe', begruendung: 'von Hand eingegeben' };
  }

  const angebot = feld.angebote.find((eintrag) => eintrag.quelle === wahl.quelle);

  if (!angebot) {
    return {
      wert: '',
      quelle: wahl.quelle,
      begruendung: `Der Wert aus ${wahl.quelle} liegt nicht mehr vor`,
      fehlt: `Für „${feld.feld}" wurde der Wert aus ${wahl.quelle} gewählt, aber dort liegt keiner (mehr) vor`,
    };
  }

  return { wert: angebot.wert, quelle: angebot.quelle, begruendung: `Wert aus ${angebot.quelle} übernommen` };
}

const ART_BESCHREIBUNG: Record<Entscheidung['art'], string> = {
  BEREINIGEN: 'Werte festgelegt',
  ZUSAMMENFUEHREN: 'Datensätze zusammengeführt',
  NICHT_ZUSAMMENFUEHREN: 'Datensätze bleiben getrennt',
  AKZEPTIEREN: 'Konflikt bewusst akzeptiert',
  ZURUECKSTELLEN: 'zurückgestellt',
  WIEDERAUFNEHMEN: 'wieder aufgenommen',
};

export function wendeAn(fall: Konfliktfall, entscheidung: Entscheidung, optionen: Anwendungsoptionen): Anwendung {
  const werte: Record<string, string> = { ...(fall.ergebnis ?? {}) };
  const herkunft: Feldherkunft[] = [];
  const befunde: Befund[] = [];
  const gewaehlt = new Map(felderVon(entscheidung).map((eintrag) => [eintrag.feld, eintrag.wahl]));

  for (const feld of fall.felder) {
    const wahl = gewaehlt.get(feld.feld);

    if (!wahl) {
      /*
       * Ein Feld ohne Wahl bleibt unentschieden. Es stillschweigend mit dem
       * ersten Angebot zu füllen wäre die bequeme Variante — und genau die
       * automatische Entscheidung, die dieser ganze Bildschirm vermeiden soll.
       */
      if (entscheidung.art === 'BEREINIGEN' || entscheidung.art === 'ZUSAMMENFUEHREN') {
        befunde.push({
          zeile: 0,
          feld: feld.feld,
          schwere: 'KONFLIKT',
          ursache: `Für „${feld.feld}" ist nichts ausgewählt`,
          auswirkung:
            'Ein Feld, über das nicht entschieden wurde, bleibt strittig. ' +
            'Der Fall kann so nicht als bereinigt gelten',
        });
      }

      continue;
    }

    const ergebnis = werteAus(feld, wahl);

    werte[feld.feld] = ergebnis.wert;
    herkunft.push({ feld: feld.feld, wert: ergebnis.wert, quelle: ergebnis.quelle, begruendung: ergebnis.begruendung });

    if (ergebnis.fehlt) {
      befunde.push({
        zeile: 0,
        feld: feld.feld,
        schwere: 'KONFLIKT',
        ursache: ergebnis.fehlt,
        auswirkung:
          'Vermutlich hat sich der Fall zwischen Ansicht und Bestätigung geändert. ' +
          'Die Entscheidung wird nicht übernommen',
      });

      continue;
    }

    /*
     * Und jetzt gelten die Fachregeln — für den eingetippten Wert genauso wie
     * für den aus der Quelle. Ein Datum, das in der Zukunft liegt, liegt auch
     * dann in der Zukunft, wenn ein Mensch es eingegeben hat.
     */
    befunde.push(...pruefeFeld(feld, ergebnis.wert, optionen));
  }

  /* Feldübergreifende Regeln auf dem fertigen Datensatz. */
  if (optionen.qualitaet && optionen.qualitaet.length > 0 && herkunft.length > 0) {
    const datensatz = new Map(Object.entries(werte));
    const anwendbar = optionen.qualitaet.filter((regel) => datensatz.has(regel.feld));

    befunde.push(
      ...pruefe(datensatz, 0, anwendbar, {
        region: optionen.region,
        nullWerte: optionen.nullWerte,
        jetzt: optionen.jetzt,
      })
    );
  }

  /*
   * Die Erlaubnis des Mandanten — hier und nicht im Dienst.
   *
   * `wendeAn` ist die eine Rechnung, an der die Vorschau und die Entscheidung
   * gleichermaßen hängen. Wer das Verbot erst beim Bestätigen prüfte, zeigte
   * dem Benutzer vorher eine Vorschau auf etwas, das er nicht tun darf — und
   * ließe ihn eine Bemerkung tippen, die niemand liest.
   */
  if (entscheidung.art === 'AKZEPTIEREN' && optionen.akzeptierenErlaubt === false) {
    befunde.push({
      zeile: 0,
      schwere: 'FEHLER',
      ursache: 'Dieser Mandant lässt es nicht zu, einen Konflikt hinzunehmen',
      auswirkung:
        'Der Fall bleibt offen, bis jemand ihn bereinigt. ' +
        'Geändert wird das unter „Mandanten" und nicht hier',
    });
  }

  const schwer = befunde.some((befund) => befund.schwere === 'KONFLIKT' || befund.schwere === 'FEHLER');

  return {
    werte,
    herkunft,
    befunde,
    zulaessig: !schwer,
    status: statusNach(entscheidung),
    beschreibung: ART_BESCHREIBUNG[entscheidung.art],
  };
}

/**
 * Der Zieltyp und die Pflicht — die Regeln des Feldes selbst.
 *
 * Sie stehen am `Streitfeld` und nicht in einer Regelliste, weil sie aus dem
 * Profil des Laufs kommen, in dem der Konflikt entstanden ist. Ein Feld, das
 * damals eine Ganzzahl sein sollte, bleibt es auch, wenn jemand das Profil
 * inzwischen geändert hat: Der Fall wird nach den Regeln entschieden, unter
 * denen er entstand.
 */
function pruefeFeld(feld: Streitfeld, wert: string, optionen: Anwendungsoptionen): Befund[] {
  if (!feld.typ) {
    return [];
  }

  const ergebnis = konvertiere(wert, feld.typ as FieldType, {
    region: optionen.region,
    nullWerte: optionen.nullWerte,
    leerErlaubt: feld.leerErlaubt,
    jahrhundertGrenze: optionen.jahrhundertGrenze,
  });

  if (ergebnis.ok) {
    return ergebnis.hinweis
      ? [
          {
            zeile: 0,
            feld: feld.feld,
            schwere: 'INFO',
            ursache: ergebnis.hinweis,
            auswirkung: 'Der Wert wird übernommen; ein Blick darauf schadet nicht',
            wert,
          },
        ]
      : [];
  }

  return [
    {
      zeile: 0,
      feld: feld.feld,
      schwere: 'KONFLIKT',
      ursache: ergebnis.grund,
      auswirkung: ergebnis.auswirkung,
      wert,
      regel: `Zieltyp ${feld.typ}`,
    },
  ];
}
