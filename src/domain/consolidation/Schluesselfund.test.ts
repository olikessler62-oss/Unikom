import assert from 'node:assert/strict';
import test from 'node:test';

import type { Quelle } from './Quellen.js';
import { findeSchluessel } from './Schluesselfund.js';

function quelle(name: string, felder: string[], zeilen: string[][]): Quelle {
  return { id: name, name, felder, zeilen };
}

const KUNDEN = quelle(
  'Kunden.csv',
  ['kdnr', 'name'],
  [
    ['4711', 'Meier'],
    ['4712', 'Schulz'],
  ]
);

const ADRESSEN = quelle(
  'Adressen.csv',
  ['kdnr', 'ort'],
  [
    ['4712', 'Köln'],
    ['4711', 'Bonn'],
  ]
);

/* ---------- Der Regelfall ---------- */

test('ein gemeinsames, eindeutiges Feld wird gefunden', () => {
  const fund = findeSchluessel([KUNDEN, ADRESSEN]);

  assert.equal(fund.art, 'GEFUNDEN');
  assert.equal(fund.art === 'GEFUNDEN' && fund.feld, 'kdnr');
});

test('bei einer einzigen Quelle gibt es nichts zusammenzuführen', () => {
  // Und deshalb auch keinen Schlüssel zu erfinden.
  const fund = findeSchluessel([KUNDEN]);

  assert.equal(fund.art, 'KEINER');
  assert.match(fund.art === 'KEINER' ? fund.grund : '', /nur eine Quelle/);
});

test('ohne gemeinsame Spalte gibt es keinen Schlüssel', () => {
  const fremd = quelle('Fremd.csv', ['artikel'], [['A-1']]);
  const fund = findeSchluessel([KUNDEN, fremd]);

  assert.equal(fund.art, 'KEINER');
  assert.match(fund.art === 'KEINER' ? fund.grund : '', /keine Spalte gemeinsam/);
});

/* ---------- Die drei Bedingungen ---------- */

test('ein Feld mit einer Lücke taugt nicht', () => {
  /*
   * Ein leerer Wert paart sich mit jedem anderen leeren — und aus zwei
   * unbekannten Kunden würde einer.
   */
  const luecke = quelle('Adressen.csv', ['kdnr', 'ort'], [['', 'Köln'], ['4711', 'Bonn']]);
  const fund = findeSchluessel([KUNDEN, luecke]);

  assert.equal(fund.art, 'KEINER');
});

test('was als „nichts" gilt, ist auch hier nichts', () => {
  const luecke = quelle('Adressen.csv', ['kdnr', 'ort'], [['k. A.', 'Köln'], ['4711', 'Bonn']]);

  assert.equal(findeSchluessel([KUNDEN, luecke], { nullWerte: ['k. A.'] }).art, 'KEINER');
});

test('ein Feld mit doppelten Werten taugt nicht', () => {
  // Zwei gleiche Werte in einer Quelle: Welche Zeile ist gemeint?
  const doppelt = quelle('Adressen.csv', ['kdnr', 'ort'], [['4711', 'Köln'], ['4711', 'Bonn']]);

  assert.equal(findeSchluessel([KUNDEN, doppelt]).art, 'KEINER');
});

test('ein Feld, dessen Werte sich nirgends treffen, taugt nicht', () => {
  /*
   * Die Bedingung, an die man zuletzt denkt: Eine laufende Nummer ist in jeder
   * Datei vollständig und eindeutig — und paart „Zeile 1 mit Zeile 1", was
   * zufällig aussieht wie ein Ergebnis.
   */
  const andere = quelle('Adressen.csv', ['kdnr', 'ort'], [['9001', 'Köln'], ['9002', 'Bonn']]);
  const fund = findeSchluessel([KUNDEN, andere]);

  assert.equal(fund.art, 'KEINER');
  assert.match(fund.art === 'KEINER' ? fund.grund : '', /wiederzufinden/);
});

test('eine leere Quelle trägt keinen Schlüssel', () => {
  assert.equal(findeSchluessel([KUNDEN, quelle('Leer.csv', ['kdnr'], [])]).art, 'KEINER');
});

/* ---------- Mehrere Kandidaten ---------- */

test('zwei Felder, die dieselben Zeilen paaren, sind kein Problem', () => {
  /*
   * Dann ist die Wahl keine: Das Ergebnis ist dasselbe, gleich welches man
   * nimmt. Unikom wählt nicht aus, es stellt fest, dass die Auswahl
   * gleichgültig ist.
   */
  const links = quelle('Kunden.csv', ['kdnr', 'email'], [['4711', 'a@x.de'], ['4712', 'b@x.de']]);
  const rechts = quelle('Adressen.csv', ['kdnr', 'email'], [['4712', 'b@x.de'], ['4711', 'a@x.de']]);

  const fund = findeSchluessel([links, rechts]);

  assert.equal(fund.art, 'GEFUNDEN');
  assert.equal(fund.art === 'GEFUNDEN' && fund.feld, 'kdnr');
  assert.deepEqual(fund.art === 'GEFUNDEN' ? fund.gleichwertig : [], ['email']);
});

test('zwei Felder, die verschieden paaren, führen zum Abbruch', () => {
  /*
   * Hier steht eine echte Entscheidung an — und die trifft Unikom nicht. Eine
   * Zusammenführung über den falschen Schlüssel ergibt kein Fehlerbild,
   * sondern ein plausibel aussehendes Ergebnis mit falsch verbundenen Zeilen.
   */
  const links = quelle('Kunden.csv', ['kdnr', 'email'], [['4711', 'a@x.de'], ['4712', 'b@x.de']]);
  const rechts = quelle('Adressen.csv', ['kdnr', 'email'], [['4711', 'b@x.de'], ['4712', 'a@x.de']]);

  const fund = findeSchluessel([links, rechts]);

  assert.equal(fund.art, 'MEHRDEUTIG');
  assert.deepEqual(fund.art === 'MEHRDEUTIG' ? [...fund.kandidaten].sort() : [], ['email', 'kdnr']);
  assert.match(fund.art === 'MEHRDEUTIG' ? fund.grund : '', /nicht dieselben Zeilen/);
});

/* ---------- Der Vergleich ---------- */

test('Schreibweise und Umlaute trennen nicht', () => {
  // „Müller GmbH" und „MUELLER GMBH" sind derselbe Kunde.
  const links = quelle('Kunden.csv', ['firma'], [['Müller GmbH'], ['Schulz AG']]);
  const rechts = quelle('Adressen.csv', ['firma'], [['MUELLER GMBH'], ['schulz ag']]);

  assert.equal(findeSchluessel([links, rechts]).art, 'GEFUNDEN');
});

test('drei Quellen müssen sich alle treffen', () => {
  const dritte = quelle('Umsatz.csv', ['kdnr', 'betrag'], [['4711', '10'], ['4712', '20']]);

  assert.equal(findeSchluessel([KUNDEN, ADRESSEN, dritte]).art, 'GEFUNDEN');
});

test('trifft die dritte Quelle nicht, gibt es keinen Schlüssel', () => {
  const daneben = quelle('Umsatz.csv', ['kdnr', 'betrag'], [['9001', '10']]);

  assert.equal(findeSchluessel([KUNDEN, ADRESSEN, daneben]).art, 'KEINER');
});
