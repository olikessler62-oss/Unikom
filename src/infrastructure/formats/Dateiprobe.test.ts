import assert from 'node:assert/strict';
import test from 'node:test';

import { PROBE_BYTES, bisZurLetztenZeile, istText, probeAus, signaturVon } from './Dateiprobe.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const UMBRUCH = String.fromCharCode(10);

/* ---------- Wie viel angesehen wird ---------- */

test('vierundsechzig Kilobyte sind rund achthundert Zeilen', () => {
  /*
   * Die Zahl ist kein Zufallswert: Sie soll für ein Muster reichen und für eine
   * Antwort, die sofort da ist. Wer sie ändert, ändert beides.
   */
  assert.equal(PROBE_BYTES, 65536);
});

/* ---------- Ist das Text ---------- */

test('gewöhnlicher Text ist Text', () => {
  assert.equal(istText(bytes('4711;Meier;Bonn')), true);
});

test('ein Nullbyte macht es zu etwas anderem', () => {
  assert.equal(istText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])), false);
});

test('das Nullbyte zählt auch mitten in der Datei', () => {
  // Ein Archiv fängt lesbar an; das erste Nullbyte kommt ein paar Bytes später.
  const gemischt = new Uint8Array([...bytes('PK'), 0x03, 0x04, ...bytes('xl/workbook.xml'), 0x00]);

  assert.equal(istText(gemischt), false);
});

test('Umlaute sind kein Grund zur Ablehnung', () => {
  // Sie sind mehrteilig und enthalten Bytes über 0x7f — aber nie eine Null.
  assert.equal(istText(bytes('Müller;Köln;Straße')), true);
});

/* ---------- Woran der Anfang erinnert ---------- */

test('ein Archiv wird erkannt — dazu gehört auch eine Excel-Mappe', () => {
  assert.equal(signaturVon(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])), 'ZIP');
});

test('das alte Office-Format wird erkannt', () => {
  assert.equal(signaturVon(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1])), 'OLE2');
});

test('ein PDF wird erkannt', () => {
  assert.equal(signaturVon(bytes('%PDF-1.7')), 'PDF');
});

test('UTF-16 wird an seiner Bytefolgemarke erkannt — in beiden Richtungen', () => {
  /*
   * Es ist Text und wird trotzdem abgewiesen; „binär" wäre die falsche
   * Auskunft. Beide Richtungen, weil beide vorkommen: Windows schreibt die
   * eine, ein Austauschformat gern die andere.
   */
  assert.equal(signaturVon(new Uint8Array([0xff, 0xfe, 0x34, 0x00])), 'UTF-16');
  assert.equal(signaturVon(new Uint8Array([0xfe, 0xff, 0x00, 0x34])), 'UTF-16');
});

test('eine gewöhnliche Datei erinnert an nichts', () => {
  assert.equal(signaturVon(bytes('kdnr;name;ort')), undefined);
});

test('eine Datei, die kürzer ist als jede Signatur, erinnert an nichts', () => {
  // `every` über die Magie ist für eine leere Datei sonst wahr — und dann hieße
  // eine Datei ohne Inhalt „Zip-Archiv".
  assert.equal(signaturVon(new Uint8Array([])), undefined);
  assert.equal(signaturVon(new Uint8Array([0x50])), undefined);
});

/* ---------- Wo geschnitten wird ---------- */

test('geschnitten wird hinter dem letzten Umbruch', () => {
  const gelesen = bisZurLetztenZeile(bytes(`erste${UMBRUCH}zweite${UMBRUCH}halbe`));

  assert.equal(new TextDecoder().decode(gelesen), `erste${UMBRUCH}zweite${UMBRUCH}`);
});

test('ohne Umbruch bleibt alles stehen', () => {
  /*
   * Eine einzige lange Zeile. Auf null zu schneiden wäre schlechter als ein
   * unvollständiges letztes Zeichen: Dann käme aus einer Datei mit Inhalt eine
   * leere Probe.
   */
  const gelesen = bisZurLetztenZeile(bytes('alles in einer Zeile'));

  assert.equal(new TextDecoder().decode(gelesen), 'alles in einer Zeile');
});

/* ---------- Die Probe im Ganzen ---------- */

test('was vollständig hereinpasst, wird nicht beschnitten', () => {
  // Die letzte Zeile ohne abschließenden Umbruch ist der Normalfall. Sie hier
  // fortzunehmen hieße, jeder Datei ihre letzte Zeile zu stehlen.
  const probe = probeAus(bytes(`erste${UMBRUCH}letzte ohne Umbruch`), false);

  assert.equal(probe.text, `erste${UMBRUCH}letzte ohne Umbruch`);
});

test('was abgeschnitten hereinkam, endet an einer ganzen Zeile', () => {
  const probe = probeAus(bytes(`erste${UMBRUCH}zweite${UMBRUCH}hal`), true);

  assert.equal(probe.text, `erste${UMBRUCH}zweite${UMBRUCH}`);
});

test('ein zerschnittener Umlaut verdirbt nicht die ganze Probe', () => {
  /*
   * Der eigentliche Grund für den Schnitt an der Zeile. „ü" sind zwei Bytes;
   * bricht die Probe zwischen ihnen ab, ist das kein gültiges UTF-8 mehr, und
   * `detectEncoding` fiele streng auf Windows-1252 zurück — für die **ganze**
   * Probe. Aus „Müller" oben würde „MÃ¼ller", wegen eines halben Zeichens unten.
   */
  const ganz = bytes(`Müller${UMBRUCH}Köln${UMBRUCH}`);
  const halb = bytes('Schrö');
  const zerschnitten = new Uint8Array([...ganz, ...halb.subarray(0, halb.length - 1)]);

  const probe = probeAus(zerschnitten, true);

  assert.equal(probe.kodierung, 'utf-8');
  assert.equal(probe.text, `Müller${UMBRUCH}Köln${UMBRUCH}`);
});

test('eine Windows-1252-Datei wird als solche entziffert', () => {
  // „Müller" in Windows-1252: das ü ist ein einzelnes Byte 0xfc.
  const gelesen = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);
  const probe = probeAus(gelesen, false);

  assert.equal(probe.kodierung, 'windows-1252');
  assert.equal(probe.text, 'Müller');
});

test('die Bytezahl ist die nach dem Schnitt und nicht die davor', () => {
  // Sie steht später in der Auskunft „so viel wurde angesehen". Die Zahl vor
  // dem Schnitt wäre dort um eine halbe Zeile zu groß.
  const probe = probeAus(bytes(`abc${UMBRUCH}defg`), true);

  assert.equal(probe.bytes, 4);
});
