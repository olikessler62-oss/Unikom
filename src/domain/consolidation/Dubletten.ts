import type { Datensatz } from './Quellen.js';

/**
 * Dubletten innerhalb und zwischen Quellen (SPEC-04, Abschnitt 7; SPEC-06,
 * Abschnitt 6).
 *
 * ## Zwei Einstellungen statt einer Liste
 *
 * SPEC-04 zählt sieben Verhalten auf: ersten behalten, letzten behalten, nach
 * Priorität, zusammenführen, verwerfen, separat ausgeben, protokollieren. Die
 * ersten vier beantworten die Frage **wer bleibt**, die letzten drei die Frage
 * **wohin mit den übrigen**. In eine Liste gepresst hieße das, sieben Namen zu
 * merken, von denen vier dasselbe wie zwei andere in Kombination bedeuten.
 *
 * ```text
 * Auswahl                    Verbleib der übrigen
 * ERSTER            ×        MITGEBEN    im Bericht ausgewiesen
 * LETZTER                    SEPARAT     eigene Ausleitung
 * PRIORITAET                 VERWERFEN   ausdrücklich fallengelassen
 * ZUSAMMENFUEHREN
 * ALLE_BEHALTEN
 * ENTSCHEIDEN
 * ```
 *
 * ## Niemals ungefragt
 *
 * „Dubletten werden niemals ungefragt gelöscht" (SPEC-06, Abschnitt 6). Auch
 * `VERWERFEN` löscht deshalb nicht still: Der Datensatz steht im Bericht, mit
 * Quelle, Zeile und dem Satz, warum er fallengelassen wurde. Der Unterschied
 * zwischen „verworfen" und „verschwunden" ist die ganze Frage.
 */
export type Dublettenauswahl =
  /** Der erste Datensatz der Gruppe vertritt sie. */
  | 'ERSTER'
  | 'LETZTER'
  /** Der aus der höchstpriorisierten Quelle. */
  | 'PRIORITAET'
  /** Feldweise zu einem Datensatz vereinigen. */
  | 'ZUSAMMENFUEHREN'
  /** Nichts tun — alle bleiben nebeneinander stehen. */
  | 'ALLE_BEHALTEN'
  /** Die Gruppe geht als Ganzes an einen Menschen. */
  | 'ENTSCHEIDEN';

export type Dublettenverbleib = 'MITGEBEN' | 'SEPARAT' | 'VERWERFEN';

export interface Dublettenregel {
  auswahl: Dublettenauswahl;
  /** Voreinstellung: `MITGEBEN`. */
  verbleib?: Dublettenverbleib;
}

/** Was mit einer Gruppe geschehen soll — der Aufrufer führt es aus. */
export type Gruppenbehandlung =
  | { art: 'EINZELN'; datensaetze: Datensatz[] }
  | { art: 'ZUSAMMENFUEHREN'; datensaetze: Datensatz[] }
  | { art: 'ENTSCHEIDUNG'; datensaetze: Datensatz[] };

export interface Beiseitegelegt {
  datensatz: Datensatz;
  verbleib: Dublettenverbleib;
  grund: string;
}

export interface Dublettenbefund {
  /** Der Konsolidierungsschlüssel im Klartext. */
  schluessel: string;
  anzahl: number;
  /** Ob alle Datensätze Feld für Feld gleich sind. */
  exakt: boolean;
  art: 'INNERHALB' | 'UEBERGREIFEND' | 'BEIDES';
  quellen: string[];
  /** Was geschehen ist — in einem Satz. */
  behandlung: string;
}

export interface Dublettenergebnis {
  behandlung: Gruppenbehandlung;
  beiseite: Beiseitegelegt[];
  /** Fehlt, wenn die Gruppe nur einen Datensatz hat — dann ist nichts doppelt. */
  befund?: Dublettenbefund;
}

/**
 * Ob die Datensätze Feld für Feld gleich sind (SPEC-04, Abschnitt 7).
 *
 * Wörtlich gleich, nicht fachlich: „Müller GmbH" und „Mueller GmbH" sind
 * fachlich dieselbe Firma und trotzdem kein exaktes Duplikat. Der Unterschied
 * zählt, weil ein exaktes Duplikat gefahrlos zusammenfallen kann und eine
 * fachliche Dublette eine Entscheidung ist.
 */
export function istExakt(gruppe: readonly Datensatz[]): boolean {
  if (gruppe.length < 2) {
    return false;
  }

  const felder = new Set(gruppe.flatMap((datensatz) => [...datensatz.werte.keys()]));
  const [erster, ...uebrige] = gruppe;

  return uebrige.every((datensatz) =>
    [...felder].every((feld) => (datensatz.werte.get(feld) ?? '') === (erster.werte.get(feld) ?? ''))
  );
}

/** Ob die Dublette in einer Quelle liegt, zwischen Quellen — oder beides. */
export function dublettenart(gruppe: readonly Datensatz[]): 'INNERHALB' | 'UEBERGREIFEND' | 'BEIDES' {
  const quellen = gruppe.map((datensatz) => datensatz.quelle);
  const verschiedene = new Set(quellen);
  const mehrfachInEiner = verschiedene.size < quellen.length;

  if (verschiedene.size === 1) {
    return 'INNERHALB';
  }

  return mehrfachInEiner ? 'BEIDES' : 'UEBERGREIFEND';
}

function nachPrioritaet(gruppe: readonly Datensatz[], quellen: readonly string[]): Datensatz | undefined {
  for (const quelle of quellen) {
    const treffer = gruppe.find((datensatz) => datensatz.quelle === quelle);

    if (treffer) {
      return treffer;
    }
  }

  return undefined;
}

function beiseite(
  gruppe: readonly Datensatz[],
  behalten: Datensatz,
  verbleib: Dublettenverbleib,
  grund: string
): Beiseitegelegt[] {
  return gruppe.filter((datensatz) => datensatz !== behalten).map((datensatz) => ({ datensatz, verbleib, grund }));
}

export function behandleDubletten(
  schluessel: string,
  gruppe: readonly Datensatz[],
  regel: Dublettenregel,
  quellen: readonly string[] = []
): Dublettenergebnis {
  if (gruppe.length < 2) {
    return { behandlung: { art: 'EINZELN', datensaetze: [...gruppe] }, beiseite: [] };
  }

  const verbleib = regel.verbleib ?? 'MITGEBEN';
  const exakt = istExakt(gruppe);
  const befund = (behandlung: string): Dublettenbefund => ({
    schluessel,
    anzahl: gruppe.length,
    exakt,
    art: dublettenart(gruppe),
    quellen: [...new Set(gruppe.map((datensatz) => datensatz.quelle))],
    behandlung,
  });

  switch (regel.auswahl) {
    case 'ALLE_BEHALTEN':
      return {
        behandlung: { art: 'EINZELN', datensaetze: [...gruppe] },
        beiseite: [],
        befund: befund(`Alle ${gruppe.length} Datensätze bleiben unverändert stehen und sind als Dublette vermerkt`),
      };

    case 'ENTSCHEIDEN':
      return {
        behandlung: { art: 'ENTSCHEIDUNG', datensaetze: [...gruppe] },
        beiseite: [],
        befund: befund('Die Gruppe geht unverändert an einen Menschen'),
      };

    case 'ZUSAMMENFUEHREN':
      return {
        behandlung: { art: 'ZUSAMMENFUEHREN', datensaetze: [...gruppe] },
        beiseite: [],
        befund: befund(
          exakt
            ? `${gruppe.length} wörtlich gleiche Datensätze fallen zu einem zusammen`
            : `${gruppe.length} Datensätze werden feldweise zu einem vereinigt`
        ),
      };

    case 'PRIORITAET': {
      const gewaehlt = nachPrioritaet(gruppe, quellen);

      if (!gewaehlt) {
        /*
         * Nach Priorität auszuwählen, ohne dass für diese Quellen eine
         * Priorität eingerichtet ist, wäre eine Auswahl nach Zufall — und die
         * sieht im Ergebnis genauso aus wie eine richtige.
         */
        return {
          behandlung: { art: 'ENTSCHEIDUNG', datensaetze: [...gruppe] },
          beiseite: [],
          befund: befund(
            'Die Auswahl soll nach Quellenpriorität erfolgen, aber für keine der beteiligten Quellen ' +
              'ist eine Priorität eingerichtet. Die Gruppe geht deshalb an einen Menschen'
          ),
        };
      }

      const grund = `${gewaehlt.quelle} steht in der Quellenpriorität vorn`;

      return {
        behandlung: { art: 'EINZELN', datensaetze: [gewaehlt] },
        beiseite: beiseite(gruppe, gewaehlt, verbleib, grund),
        befund: befund(`Es bleibt der Datensatz aus ${gewaehlt.quelle}; ${gruppe.length - 1} weitere treten zurück`),
      };
    }

    case 'ERSTER':
    case 'LETZTER': {
      const gewaehlt = regel.auswahl === 'ERSTER' ? gruppe[0] : gruppe[gruppe.length - 1];
      const wie = regel.auswahl === 'ERSTER' ? 'der erste' : 'der letzte';
      const grund = `Eingerichtet ist: ${wie} Datensatz der Gruppe bleibt`;

      return {
        behandlung: { art: 'EINZELN', datensaetze: [gewaehlt] },
        beiseite: beiseite(gruppe, gewaehlt, verbleib, grund),
        befund: befund(
          `Es bleibt ${wie} Datensatz (${gewaehlt.quelle}, Zeile ${gewaehlt.zeile}); ` +
            `${gruppe.length - 1} weitere treten zurück`
        ),
      };
    }
  }
}
