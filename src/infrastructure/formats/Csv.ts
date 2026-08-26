import { recogniseField, type RecognitionOptions } from '../../domain/consolidation/Recognition.js';
import { ersatzname } from '../../domain/consolidation/Spaltennamen.js';

/**
 * CSV lesen — und dabei drei Feststellungen treffen, die keine Wahl sind:
 * Zeichensatz, Trennzeichen und ob die erste Zeile eine Kopfzeile ist.
 *
 * „Feststellung" im Sinne von SPEC-02, Abschnitt 40: Sie beschreiben die
 * Datei, nicht den Geschmack des Mandanten. Eine Datei, die mit Komma trennt,
 * trennt nicht Semikolon, weil jemand Semikolon eingestellt hat. Wo die
 * Erkennung unsicher ist, sagt sie es — dann gehört die Angabe ins Profil.
 */
export type Encoding = 'utf-8' | 'utf-8-bom' | 'windows-1252';

export const DELIMITERS: readonly string[] = [';', ',', '\t', '|'];

const BOM = [0xef, 0xbb, 0xbf];

export function detectEncoding(bytes: Uint8Array): Encoding {
  if (bytes.length >= 3 && BOM.every((byte, index) => bytes[index] === byte)) {
    return 'utf-8-bom';
  }

  try {
    // Streng: Eine latin1-Datei enthält Bytefolgen, die in UTF-8 nicht
    // vorkommen dürfen. Ohne `fatal` liefert der Decoder klaglos
    // Ersatzzeichen — aus „Müller" würde „M?ller", und niemand merkt es.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

export function decode(bytes: Uint8Array, encoding: Encoding = detectEncoding(bytes)): string {
  const nutzdaten = encoding === 'utf-8-bom' ? bytes.slice(BOM.length) : bytes;
  const decoder = encoding === 'windows-1252' ? 'windows-1252' : 'utf-8';

  return new TextDecoder(decoder).decode(nutzdaten);
}

/**
 * Zählt je Zeile, wie oft ein Zeichen außerhalb von Anführungszeichen steht.
 * Ein Semikolon in „Meier; Sohn" ist kein Trennzeichen.
 */
function zaehleAusserhalb(text: string, kandidaten: readonly string[], quote: string): Map<string, number[]> {
  const zaehler = new Map<string, number[]>(kandidaten.map((kandidat) => [kandidat, [0]]));
  let inAnfuehrung = false;

  for (let stelle = 0; stelle < text.length; stelle += 1) {
    const zeichen = text[stelle];

    if (zeichen === quote) {
      inAnfuehrung = !inAnfuehrung;
      continue;
    }

    if (inAnfuehrung) {
      continue;
    }

    if (zeichen === '\n') {
      for (const werte of zaehler.values()) {
        werte.push(0);
      }
      continue;
    }

    const werte = zaehler.get(zeichen);

    if (werte) {
      werte[werte.length - 1] += 1;
    }
  }

  return zaehler;
}

export interface DelimiterGuess {
  delimiter: string;
  certain: boolean;
  note?: string;
}

export function detectDelimiter(text: string, kandidaten: readonly string[] = DELIMITERS, quote = '"'): DelimiterGuess {
  const zaehler = zaehleAusserhalb(text, kandidaten, quote);
  const zeilen = Math.max(...[...zaehler.values()].map((werte) => werte.filter((wert) => wert > 0).length));

  const geeignet = [...zaehler.entries()]
    .map(([delimiter, werte]) => {
      const gefuellt = werte.slice(0, Math.min(werte.length, 20)).filter((_, index) => index < werte.length - 1 || werte[index] > 0);
      const erste = gefuellt[0] ?? 0;

      return { delimiter, erste, gleich: erste > 0 && gefuellt.every((wert) => wert === erste) };
    })
    .filter((eintrag) => eintrag.erste > 0)
    .sort((links, rechts) => rechts.erste - links.erste);

  if (geeignet.length === 0) {
    // Keine der Möglichkeiten kommt vor: eine einspaltige Datei. Dann ist es
    // gleichgültig, welches Trennzeichen gilt — es trennt nichts.
    return { delimiter: kandidaten[0], certain: true, note: 'Die Datei hat nur eine Spalte' };
  }

  const durchgehend = geeignet.filter((eintrag) => eintrag.gleich);

  if (durchgehend.length === 1) {
    return { delimiter: durchgehend[0].delimiter, certain: true };
  }

  if (durchgehend.length > 1) {
    return {
      delimiter: durchgehend[0].delimiter,
      certain: false,
      note:
        `Mehrere Zeichen trennen gleichmäßig (${durchgehend.map((eintrag) => sichtbar(eintrag.delimiter)).join(', ')}); ` +
        'das Trennzeichen gehört ins Profil',
    };
  }

  return {
    delimiter: geeignet[0].delimiter,
    certain: false,
    note: `Kein Zeichen trennt alle ${zeilen} Zeilen gleich oft; das Trennzeichen gehört ins Profil`,
  };
}

function sichtbar(zeichen: string): string {
  return zeichen === '\t' ? 'TAB' : zeichen;
}

/** Zerlegt den Text in Zeilen und Felder — mit Textqualifizierer und verdoppeltem Anführungszeichen. */
export function splitRows(text: string, delimiter: string, quote = '"'): string[][] {
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = '';
  let inAnfuehrung = false;

  for (let stelle = 0; stelle < text.length; stelle += 1) {
    const zeichen = text[stelle];

    if (inAnfuehrung) {
      if (zeichen === quote) {
        if (text[stelle + 1] === quote) {
          feld += quote;
          stelle += 1;
        } else {
          inAnfuehrung = false;
        }
      } else {
        feld += zeichen;
      }
      continue;
    }

    if (zeichen === quote) {
      inAnfuehrung = true;
    } else if (zeichen === delimiter) {
      zeile.push(feld);
      feld = '';
    } else if (zeichen === '\n' || zeichen === '\r') {
      if (zeichen === '\r' && text[stelle + 1] === '\n') {
        stelle += 1;
      }
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = '';
    } else {
      feld += zeichen;
    }
  }

  if (feld !== '' || zeile.length > 0) {
    zeile.push(feld);
    zeilen.push(zeile);
  }

  return zeilen;
}

export interface HeaderGuess {
  header: boolean;
  certain: boolean;
  note?: string;
}

/**
 * Ob die erste Zeile eine Kopfzeile ist.
 *
 * Erkannt wird es daran, dass die erste Zeile *nicht* zu den Werten darunter
 * passt: Steht unter „Betrag" eine Zahlenspalte und in der ersten Zeile keine
 * Zahl, ist sie eine Beschriftung.
 *
 * Im Zweifel gilt: **keine** Kopfzeile. Eine fälschlich angenommene Kopfzeile
 * verschluckt einen echten Datensatz, und zwar lautlos. Eine fälschlich
 * verneinte kostet nur gute Feldnamen — das sieht man und kann es richten.
 */
export function detectHeader(rows: readonly string[][], options: RecognitionOptions): HeaderGuess {
  if (rows.length < 2) {
    return { header: false, certain: false, note: 'Zu wenige Zeilen, um es zu erkennen' };
  }

  const [erste, ...koerper] = rows;
  const spalten = erste.length;
  let unterschiede = 0;
  let vergleichbar = 0;

  for (let spalte = 0; spalte < spalten; spalte += 1) {
    const werte = koerper.map((zeile) => zeile[spalte] ?? '');
    const erkannt = recogniseField(ersatzname(spalte), werte, options);

    if (erkannt.type === 'STRING' || erkannt.type === 'NULL' || !erkannt.certain) {
      continue;
    }

    vergleichbar += 1;

    const kopfWert = recogniseField('Kopf', [erste[spalte] ?? ''], options);

    if (kopfWert.type !== erkannt.type) {
      unterschiede += 1;
    }
  }

  if (vergleichbar === 0) {
    return {
      header: false,
      certain: false,
      note: 'Alle Spalten sind Text; ob die erste Zeile eine Kopfzeile ist, gehört ins Profil',
    };
  }

  return unterschiede === vergleichbar
    ? { header: true, certain: true }
    : {
        header: false,
        certain: unterschiede === 0,
        note:
          unterschiede === 0
            ? undefined
            : `Die erste Zeile passt in ${vergleichbar - unterschiede} von ${vergleichbar} Spalten zu den Werten darunter`,
      };
}

export interface Table {
  encoding: Encoding;
  delimiter: string;
  delimiterCertain: boolean;
  header: boolean;
  headerCertain: boolean;
  /** Feldnamen — aus der Kopfzeile oder ersatzweise „Spalte 1". */
  fields: string[];
  /** Die Datenzeilen, ohne Kopfzeile. */
  rows: string[][];
  /** Zeilennummern in der Datei, deren Spaltenzahl abweicht (SPEC-06, Abschnitt 10). */
  ragged: number[];
  notes: string[];
}

export interface CsvOptions extends RecognitionOptions {
  /** Vorgaben aus dem Profil. Was hier steht, wird nicht mehr erkannt. */
  encoding?: Encoding;
  delimiter?: string;
  header?: boolean;
  quote?: string;
}

export function readCsv(bytes: Uint8Array, options: CsvOptions): Table {
  const quote = options.quote ?? '"';
  const encoding = options.encoding ?? detectEncoding(bytes);
  const text = decode(bytes, encoding);
  const notes: string[] = [];

  const trennzeichen = options.delimiter
    ? { delimiter: options.delimiter, certain: true }
    : detectDelimiter(text, DELIMITERS, quote);

  if (trennzeichen.note) {
    notes.push(trennzeichen.note);
  }

  const alle = splitRows(text, trennzeichen.delimiter, quote).filter(
    (zeile) => zeile.length > 1 || zeile[0].trim() !== ''
  );

  const kopf = options.header === undefined ? detectHeader(alle, options) : { header: options.header, certain: true };

  if (kopf.note) {
    notes.push(kopf.note);
  }

  const rows = kopf.header ? alle.slice(1) : alle;
  const breite = alle[0]?.length ?? 0;
  const fields = kopf.header
    ? (alle[0] ?? []).map((name, index) => name.trim() || ersatzname(index))
    : Array.from({ length: breite }, (_, index) => ersatzname(index));

  const ragged = alle
    .map((zeile, index) => (zeile.length === breite ? 0 : index + 1))
    .filter((nummer) => nummer > 0);

  if (ragged.length > 0) {
    notes.push(`${ragged.length} Zeile(n) haben eine andere Spaltenzahl als die erste: ${ragged.slice(0, 5).join(', ')}`);
  }

  return {
    encoding,
    delimiter: trennzeichen.delimiter,
    delimiterCertain: trennzeichen.certain,
    header: kopf.header,
    headerCertain: kopf.certain,
    fields,
    rows,
    ragged,
    notes,
  };
}

/** Die Werte einer Spalte — die Eingabe der Typerkennung. */
export function columnValues(table: Table, index: number): string[] {
  return table.rows.map((zeile) => zeile[index] ?? '');
}
