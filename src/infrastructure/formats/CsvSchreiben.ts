import type { Encoding } from './Csv.js';

/**
 * CSV schreiben — der Rückweg zu `readCsv`.
 *
 * Lesen gab es lange, Schreiben nicht: Bis hierher endete die Konsolidierung
 * beim Ergebnisstand in der Datenbank, und wer die Daten als Datei wollte, lud
 * sie herunter. Ein Lauf um drei Uhr nachts lädt nichts herunter.
 *
 * ## Wann ein Wert in Anführungszeichen kommt
 *
 * ```text
 * enthält das Trennzeichen        "Meier; Sohn"
 * enthält ein Anführungszeichen   "Er sagte ""ja"""
 * enthält einen Zeilenumbruch     "Hauptstr. 1
 *                                  12345 Bonn"
 * beginnt oder endet mit Leerzeichen
 * ```
 *
 * Die letzte Zeile ist eine Zugabe: RFC 4180 verlangt sie nicht, aber viele
 * Leser schneiden Leerzeichen am Rand ab. Ein Wert, der mit einem Leerzeichen
 * beginnt, käme sonst anders zurück, als er hineinging — und dass ein
 * Datenwerkzeug seine eigenen Dateien nicht unverändert wieder einliest, ist
 * schwer zu erklären.
 *
 * ## Zeilenende und BOM
 *
 * CRLF, weil RFC 4180 es so schreibt und Excel unter Windows es erwartet. Die
 * Bytefolge am Anfang (`utf-8-bom`) ist nicht Zierde: Excel liest eine UTF-8-
 * Datei ohne sie als Windows-1252, und aus „Müller" wird „MÃ¼ller".
 *
 * ## Was hier absichtlich nicht geschieht
 *
 * Werte, die mit `=` beginnen, werden **nicht** entschärft. Excel führt sie als
 * Formel aus, das ist bekannt — aber die naheliegende Gegenmaßnahme, ein
 * vorangestelltes Zeichen, träfe auch `-5`. Ein Werkzeug, das die Zahlen seines
 * Kunden verändert, um Excel zu erziehen, richtet den größeren Schaden an. Wo
 * das Risiko besteht, ist das Zielformat die Antwort, nicht die Verstümmelung.
 */
export interface CsvSchreiboptionen {
  /** Voreinstellung: Semikolon — die deutsche Excel-Erwartung. */
  trennzeichen?: string;
  anfuehrung?: string;
  /** Voreinstellung: CRLF. */
  zeilenende?: string;
  /** Ob die Kopfzeile mitgeschrieben wird. Voreinstellung: ja. */
  kopfzeile?: boolean;
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

export function schreibeCsv(
  felder: readonly string[],
  zeilen: readonly (readonly string[])[],
  optionen: CsvSchreiboptionen = {}
): string {
  const trennzeichen = optionen.trennzeichen ?? ';';
  const anfuehrung = optionen.anfuehrung ?? '"';
  const zeilenende = optionen.zeilenende ?? CR + LF;

  const alsZeile = (werte: readonly string[]): string =>
    /*
     * Über die Felder und nicht über die Werte: Eine Zeile, der ein Wert fehlt,
     * bekommt ein leeres Feld statt einer kürzeren Zeile. Sonst verschöbe sich
     * alles dahinter um eine Spalte, und die Datei sähe heil aus.
     */
    felder.map((_, spalte) => maskiere(werte[spalte] ?? '', trennzeichen, anfuehrung)).join(trennzeichen);

  const ausgabe: string[] = [];

  if (optionen.kopfzeile !== false) {
    ausgabe.push(felder.map((feld) => maskiere(feld, trennzeichen, anfuehrung)).join(trennzeichen));
  }

  for (const zeile of zeilen) {
    ausgabe.push(alsZeile(zeile));
  }

  // Auch die letzte Zeile bekommt ihr Ende: Eine Datei ohne abschließenden
  // Umbruch ist für manche Leser eine Zeile weniger.
  return ausgabe.length === 0 ? '' : ausgabe.join(zeilenende) + zeilenende;
}

export function maskiere(wert: string, trennzeichen: string, anfuehrung = '"'): string {
  const noetig =
    wert.includes(trennzeichen) ||
    wert.includes(anfuehrung) ||
    wert.includes(CR) ||
    wert.includes(LF) ||
    wert !== wert.trim();

  if (!noetig) {
    return wert;
  }

  return anfuehrung + wert.split(anfuehrung).join(anfuehrung + anfuehrung) + anfuehrung;
}

const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * Text in Bytes, in derselben Kodierung, in der gelesen wird.
 *
 * Windows-1252 entsteht aus dem Decoder rückwärts: Alle 256 Bytes einmal
 * entschlüsselt ergeben die Zuordnung Zeichen → Byte. Eine von Hand
 * abgeschriebene Tabelle hätte an einer Stelle einen Tippfehler, und den fände
 * man an dem einen Kunden, dessen Namen ein „š" enthält.
 */
export function alsBytes(text: string, encoding: Encoding = 'utf-8-bom'): Uint8Array {
  if (encoding === 'windows-1252') {
    return nachCp1252(text);
  }

  const nutzdaten = new TextEncoder().encode(text);

  if (encoding !== 'utf-8-bom') {
    return nutzdaten;
  }

  const mitBom = new Uint8Array(BOM.length + nutzdaten.length);

  mitBom.set(BOM);
  mitBom.set(nutzdaten, BOM.length);

  return mitBom;
}

let rueckwaerts: Map<string, number> | undefined;

function cp1252Tabelle(): Map<string, number> {
  if (!rueckwaerts) {
    const decoder = new TextDecoder('windows-1252');

    rueckwaerts = new Map();

    for (let byte = 0; byte < 256; byte += 1) {
      rueckwaerts.set(decoder.decode(new Uint8Array([byte])), byte);
    }
  }

  return rueckwaerts;
}

/** Zeichen ohne Entsprechung werden zu `?` — sichtbar, statt still zu fehlen. */
function nachCp1252(text: string): Uint8Array {
  const tabelle = cp1252Tabelle();
  const bytes = new Uint8Array(text.length);

  for (let stelle = 0; stelle < text.length; stelle += 1) {
    bytes[stelle] = tabelle.get(text[stelle]) ?? 0x3f;
  }

  return bytes;
}
