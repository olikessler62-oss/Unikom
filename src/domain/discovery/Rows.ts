import { typeOfValue, type FieldType, type Werkzeug } from '../consolidation/Recognition.js';

/**
 * Aus rohem Inhalt Zeilen mit Feldern machen — der RowTokenizer aus FR_007,
 * Abschnitt 16.
 *
 * Die Schwierigkeit ist nicht das Zerlegen, sondern die Frage, **wonach**
 * zerlegt wird. Eine Bestellung im E-Mail-Text hat kein Trennzeichen; dort
 * trennen Leerzeichen, und ausgerechnet ein Feld wie „Schraube M8" enthält
 * selbst eines.
 *
 * Deshalb wird nicht geraten, sondern jede Zerlegung ausprobiert und
 * anschließend danach bewertet, welche die klarste Struktur ergibt.
 */
export type SplitStrategy = 'SEMIKOLON' | 'KOMMA' | 'TABULATOR' | 'PIPE' | 'SPALTEN' | 'LEERZEICHEN' | 'VORGEGEBEN';

export const STRATEGIEN: readonly SplitStrategy[] = [
  'SEMIKOLON',
  'KOMMA',
  'TABULATOR',
  'PIPE',
  'SPALTEN',
  'LEERZEICHEN',
];

const TRENNZEICHEN: Partial<Record<SplitStrategy, string>> = {
  SEMIKOLON: ';',
  KOMMA: ',',
  TABULATOR: '\t',
  PIPE: '|',
};

export interface Row {
  /** Zeilennummer im Inhalt, ab 1 — für die Meldung an den Menschen. */
  line: number;
  /** Die Felder dieser Zeile. Leer, wenn die Zeile leer ist. */
  fields: string[];
  /** Der unveränderte Text, für Kopfzeilen und die Anzeige. */
  raw: string;
}

export function splitContent(inhalt: string, strategie: SplitStrategy): Row[] {
  return inhalt.split(/\r\n|\r|\n/).map((raw, index) => ({
    line: index + 1,
    raw,
    fields: raw.trim() === '' ? [] : felder(raw, strategie),
  }));
}

function felder(zeile: string, strategie: SplitStrategy): string[] {
  const trenner = TRENNZEICHEN[strategie];

  if (trenner) {
    return zeile.split(trenner).map((feld) => feld.trim());
  }

  if (strategie === 'SPALTEN') {
    // Zwei oder mehr Leerzeichen: So sieht eine Tabelle aus, die jemand mit
    // Tabulatoren oder Leerzeichen ausgerichtet hat.
    return zeile.trim().split(/\s{2,}|\t/).map((feld) => feld.trim());
  }

  return zeile.trim().split(/\s+/);
}

/**
 * Aufeinanderfolgende Textfelder zu einem verschmelzen.
 *
 * Nur für die Zerlegung an einzelnen Leerzeichen gedacht: Dort wird aus
 * „4711 Schraube M8 500 0,12" zunächst fünf Felder, und „Schraube" und „M8"
 * gehören zusammen. Zahlen, Datumsangaben und Wahrheitswerte bleiben eigene
 * Felder — sie sind die Anker, an denen die Zeile ihre Gestalt bekommt.
 *
 * Das ist die einzige Stelle, an der aus Daten eine Vermutung wird. Sie ist
 * absichtlich eng: Verschmolzen wird nur Text mit Text.
 */
export function verschmelzeText(fields: readonly string[], werkzeug: Werkzeug): string[] {
  const zusammen: string[] = [];

  for (const feld of fields) {
    const typ = typeOfValue(feld, werkzeug);
    const vorheriger = zusammen.length > 0 ? typeOfValue(zusammen[zusammen.length - 1], werkzeug) : undefined;

    if (typ === 'STRING' && vorheriger === 'STRING') {
      zusammen[zusammen.length - 1] = `${zusammen[zusammen.length - 1]} ${feld}`;
      continue;
    }

    zusammen.push(feld);
  }

  return zusammen;
}

/** Das Muster einer Zeile: der Typ jedes Feldes. FR_007, Abschnitt 2. */
export type Signature = readonly FieldType[];

export function signatureOf(fields: readonly string[], werkzeug: Werkzeug): Signature {
  return fields.map((feld) => typeOfValue(feld, werkzeug));
}

/**
 * Wie gut zwei Zeilenmuster zueinander passen, zwischen 0 und 1.
 *
 * Verschiedene Spaltenzahl heißt nicht sofort 0: Eine Zeile, in der ein Feld
 * fehlt, gehört oft trotzdem zum Block (FR_007, Abschnitt 7). Sie zählt aber
 * schlechter als eine, die passt.
 */
export function matchScore(links: Signature, rechts: Signature): number {
  const laenge = Math.max(links.length, rechts.length);

  if (laenge === 0) {
    return 0;
  }

  let treffer = 0;

  for (let stelle = 0; stelle < laenge; stelle += 1) {
    const a = links[stelle];
    const b = rechts[stelle];

    if (a === undefined || b === undefined) {
      /*
       * Ein fehlendes Feld wiegt weniger als ein andersartiges.
       *
       * „4711;Schraube" in einer dreispaltigen Tabelle ist ein unvollständiger
       * Datensatz, kein fremder. Wer beides gleich streng behandelt, reißt bei
       * schmalen Tabellen den Block auseinander — und die Zeile verschwindet
       * dann nicht als Fehler, sondern als gar nichts.
       */
      treffer += 0.5;
      continue;
    }

    if (a === b) {
      treffer += 1;
    } else if (vertraeglich(a, b)) {
      // Eine ganze Zahl in einer Dezimalspalte ist kein Bruch im Muster, und
      // ein leeres Feld sagt über den Typ nichts aus.
      treffer += 0.75;
    }
  }

  return treffer / laenge;
}

function vertraeglich(a: FieldType, b: FieldType): boolean {
  if (a === 'NULL' || b === 'NULL') {
    return true;
  }

  const zahlen = new Set<FieldType>(['INTEGER', 'DECIMAL']);

  return zahlen.has(a) && zahlen.has(b);
}
