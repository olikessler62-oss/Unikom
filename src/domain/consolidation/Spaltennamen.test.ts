import assert from 'node:assert/strict';
import test from 'node:test';

import type { Strukturvorgabe } from '../discovery/Expectation.js';
import { benenneNach, ersatzname, istErsatzname } from './Spaltennamen.js';

const SCHEMA: Strukturvorgabe = {
  verbindlichkeit: 'HINWEIS',
  columns: 3,
  spalten: [
    { position: 1, name: 'kdnr' },
    { position: 2, name: 'name' },
    { position: 3, name: 'ort' },
  ],
};

/** Drei Spalten, wie ein Leser sie liefert, der keine Kopfzeile gefunden hat. */
const OHNE_KOPF = [ersatzname(0), ersatzname(1), ersatzname(2)];

/* ---------- Der Ersatzname ---------- */

test('der Ersatzname zählt, wie ein Mensch zählt', () => {
  assert.equal(ersatzname(0), 'Spalte 1');
});

test('„Spalte 7" ist an Position 7 ein Platzhalter', () => {
  assert.equal(istErsatzname('Spalte 7', 6), true);
});

test('an Position 2 ist es ein gelieferter Name', () => {
  /*
   * Selten und real. Wer den Unterschied übergeht, benennt eine Spalte um, die
   * schon einen Namen hatte.
   */
  assert.equal(istErsatzname('Spalte 7', 1), false);
});

/* ---------- Benennen ---------- */

test('was keinen Namen hat, bekommt den aus dem Schema', () => {
  const benannt = benenneNach(OHNE_KOPF, ['4711', 'Meier', 'Bonn'], SCHEMA);

  assert.deepEqual(benannt.felder, ['kdnr', 'name', 'ort']);
  assert.match(benannt.hinweise[0], /3 Spalte\(n\) ohne Kopfzeile wurden aus dem Schema benannt: kdnr, name, ort/);
});

test('was die Datei benannt hat, behält seinen Namen', () => {
  /*
   * Ein Programm, das gelieferte Spaltennamen überschreibt, entscheidet über
   * die Bedeutung von Daten, die es nicht kennt: Kämen die Spalten eines Tages
   * in anderer Reihenfolge, hieße die dritte weiterhin „ort", und darin stünde
   * der Umsatz.
   */
  const benannt = benenneNach(['Kundennummer', ersatzname(1), 'ort'], undefined, SCHEMA);

  assert.deepEqual(benannt.felder, ['Kundennummer', 'name', 'ort']);
});

test('ein Widerspruch steht im Protokoll', () => {
  // Es ist der Fall, in dem eine Regel stillschweigend nichts prüft.
  const benannt = benenneNach(['Kundennummer', 'name', 'ort'], undefined, SCHEMA);

  assert.ok(
    benannt.hinweise.some((satz) => /Das Schema nennt Spalte 1 „kdnr", die Datei nennt sie „Kundennummer"/.test(satz))
  );
  assert.ok(benannt.hinweise.some((satz) => /eine Regel für „kdnr" greift hier nicht/.test(satz)));
});

test('gleiche Namen sind kein Widerspruch', () => {
  assert.deepEqual(benenneNach(['kdnr', 'name', 'ort'], undefined, SCHEMA).hinweise, []);
});

test('ohne Schema bleibt alles, wie es ist', () => {
  const benannt = benenneNach(OHNE_KOPF, undefined, undefined);

  assert.deepEqual(benannt.felder, OHNE_KOPF);
  assert.deepEqual(benannt.hinweise, []);
});

test('ein Schema ohne Spaltenangaben benennt nichts', () => {
  assert.deepEqual(
    benenneNach(OHNE_KOPF, undefined, { verbindlichkeit: 'HINWEIS', columns: 3 }).felder,
    OHNE_KOPF
  );
});

test('eine Angabe ohne Namen benennt nichts', () => {
  const ohneNamen: Strukturvorgabe = { verbindlichkeit: 'HINWEIS', spalten: [{ position: 1, type: 'STRING' }] };

  assert.deepEqual(benenneNach(OHNE_KOPF, undefined, ohneNamen).felder, OHNE_KOPF);
});

test('eine Angabe außerhalb der Datei benennt nichts', () => {
  /*
   * Das Schema führt vier Spalten, die Datei hat drei. Das ist eine
   * Strukturabweichung und keine Gelegenheit, ein viertes Feld zu erfinden.
   */
  const zuviel: Strukturvorgabe = { verbindlichkeit: 'HINWEIS', spalten: [{ position: 4, name: 'umsatz' }] };
  const benannt = benenneNach(OHNE_KOPF, undefined, zuviel);

  assert.deepEqual(benannt.felder, OHNE_KOPF);
  assert.deepEqual(benannt.hinweise, []);
});

/* ---------- Die Kopfzeile ---------- */

test('trägt die erste Zeile genau diese Namen, ist sie die Kopfzeile', () => {
  const benannt = benenneNach(OHNE_KOPF, ['kdnr', 'name', 'ort'], SCHEMA);

  assert.equal(benannt.kopfzeile, true);
  assert.ok(benannt.hinweise.some((satz) => /wird nicht als Datensatz verarbeitet/.test(satz)));
});

test('Großschreibung und Leerraum trennen nicht', () => {
  // Wer eine Kopfzeile von Hand tippt, schreibt „KdNr" und meint „kdnr".
  assert.equal(benenneNach(OHNE_KOPF, [' KdNr ', 'Name', 'ORT'], SCHEMA).kopfzeile, true);
});

test('eine Zeile mit Daten ist keine Kopfzeile', () => {
  assert.equal(benenneNach(OHNE_KOPF, ['4711', 'Meier', 'Bonn'], SCHEMA).kopfzeile, false);
});

test('eine von dreien reicht nicht', () => {
  /*
   * Sonst stünde in der zweiten Spalte ein Datenwert, und die Zeile wäre ein
   * Datensatz, den man wegen einer Übereinstimmung fortwirft.
   */
  assert.equal(benenneNach(OHNE_KOPF, ['kdnr', 'Meier', 'Bonn'], SCHEMA).kopfzeile, false);
});

test('eine leere Quelle hat keine Kopfzeile', () => {
  assert.equal(benenneNach(OHNE_KOPF, undefined, SCHEMA).kopfzeile, false);
});

test('wo die Datei selbst benannt hat, ist die erste Zeile schon ein Datensatz', () => {
  /*
   * Der Leser hat die Kopfzeile erkannt und fortgenommen. Fiele sie hier ein
   * zweites Mal fort, verlöre die Lieferung ihren ersten Datensatz.
   */
  const benannt = benenneNach(['kdnr', 'name', 'ort'], ['kdnr', 'name', 'ort'], SCHEMA);

  assert.equal(benannt.kopfzeile, false);
});
