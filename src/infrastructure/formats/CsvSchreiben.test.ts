import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { decode, readCsv } from './Csv.js';
import { alsBytes, maskiere, schreibeCsv } from './CsvSchreiben.js';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

test('eine gewöhnliche Zeile bleibt unangetastet', () => {
  const text = schreibeCsv(['kdnr', 'ort'], [['4711', 'Bonn']]);

  assert.equal(text, 'kdnr;ort' + CR + LF + '4711;Bonn' + CR + LF);
});

test('ein Trennzeichen im Wert kommt in Anführungszeichen', () => {
  // Ohne sie wäre aus einer Spalte zwei geworden — und die Datei sähe heil aus.
  assert.equal(maskiere('Meier; Sohn', ';'), '"Meier; Sohn"');
});

test('ein Anführungszeichen im Wert wird verdoppelt', () => {
  assert.equal(maskiere('Er sagte "ja"', ';'), '"Er sagte ""ja"""');
});

test('ein Zeilenumbruch im Wert zerreißt die Zeile nicht', () => {
  const wert = 'Hauptstr. 1' + LF + '12345 Bonn';

  assert.equal(maskiere(wert, ';'), '"' + wert + '"');
});

test('Leerzeichen am Rand werden gesichert', () => {
  /*
   * RFC 4180 verlangt das nicht. Viele Leser schneiden aber ab, und dann käme
   * ein Wert anders zurück, als er hineinging.
   */
  assert.equal(maskiere('  Bonn', ';'), '"  Bonn"');
  assert.equal(maskiere('Bonn ', ';'), '"Bonn "');
});

test('eine kürzere Zeile bekommt leere Felder statt weniger Spalten', () => {
  // Sonst verschöbe sich alles dahinter um eine Spalte.
  const text = schreibeCsv(['a', 'b', 'c'], [['1']]);

  assert.equal(text.split(CR + LF)[1], '1;;');
});

test('auch die letzte Zeile bekommt ihr Ende', () => {
  assert.ok(schreibeCsv(['a'], [['1']]).endsWith(CR + LF));
});

test('ohne Kopfzeile steht nur, was in den Zeilen steht', () => {
  assert.equal(schreibeCsv(['a'], [['1']], { kopfzeile: false }), '1' + CR + LF);
});

test('ohne Zeilen und ohne Kopf entsteht keine Datei aus Umbrüchen', () => {
  assert.equal(schreibeCsv([], [], { kopfzeile: false }), '');
});

/* ---------- Der Rückweg ---------- */

test('was geschrieben wurde, liest sich unverändert wieder ein', () => {
  /*
   * Die eigentliche Zusage: Ein Werkzeug, das seine eigenen Dateien nicht
   * unverändert wieder einliest, ist an der schwersten Stelle unbrauchbar —
   * beim Kunden, dessen Adresse ein Semikolon enthält.
   */
  const felder = ['kdnr', 'name', 'anschrift', 'bemerkung'];
  const zeilen = [
    ['4711', 'Meier; Sohn', 'Hauptstr. 1' + LF + '12345 Bonn', 'Er sagte "ja"'],
    ['4712', 'Müller', '  mit Rand  ', ''],
  ];

  const bytes = alsBytes(schreibeCsv(felder, zeilen));
  const gelesen = readCsv(bytes, { region: DEFAULT_REGION });

  assert.deepEqual(gelesen.fields, felder);
  assert.deepEqual(gelesen.rows, zeilen);
});

test('die Bytefolge am Anfang ist da, damit Excel Umlaute nicht zerlegt', () => {
  const bytes = alsBytes('Müller');

  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(decode(bytes), 'Müller');
});

test('ohne Bytefolge, wo keine gewünscht ist', () => {
  assert.equal(alsBytes('a', 'utf-8')[0], 'a'.charCodeAt(0));
});

test('Windows-1252 schreibt Umlaute als ein Byte', () => {
  // Für die Empfänger, deren System kein UTF-8 kennt.
  const bytes = alsBytes('Müller', 'windows-1252');

  assert.equal(bytes.length, 6);
  assert.equal(decode(bytes, 'windows-1252'), 'Müller');
});

test('ein Zeichen ohne Entsprechung wird sichtbar und nicht still fortgelassen', () => {
  assert.equal(decode(alsBytes('a中b', 'windows-1252'), 'windows-1252'), 'a?b');
});
