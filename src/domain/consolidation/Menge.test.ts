import assert from 'node:assert/strict';
import test from 'node:test';

import { beurteileMenge, datensaetzeIn, HOECHSTMENGE, SPEICHER_JE_DATENSATZ_BYTES } from './Menge.js';
import type { Quelle } from './Quellen.js';

test('eine gewöhnliche Menge trägt', () => {
  const urteil = beurteileMenge(10_000);

  assert.equal(urteil.traegt, true);
  assert.equal(urteil.grund, undefined);
});

test('genau an der Grenze trägt es noch', () => {
  // Eine Grenze, die schon bei sich selbst greift, ist eine andere Grenze.
  assert.equal(beurteileMenge(HOECHSTMENGE).traegt, true);
  assert.equal(beurteileMenge(HOECHSTMENGE + 1).traegt, false);
});

test('die Schätzung folgt der Messung', () => {
  // Rund zwei Kilobyte je Datensatz — gemessen, nicht geraten.
  const urteil = beurteileMenge(500_000);

  assert.equal(urteil.geschaetztMb, Math.round((500_000 * SPEICHER_JE_DATENSATZ_BYTES) / 1024 / 1024));
  assert.ok(urteil.geschaetztMb > 900 && urteil.geschaetztMb < 1100, `${urteil.geschaetztMb} MB`);
});

test('der Grund nennt beide Zahlen und mindestens einen Ausweg', () => {
  /*
   * Eine Grenze ohne Auskunft, wie man sie verschiebt, ist eine Sackgasse —
   * und sie trifft jemanden, der nachts um drei nicht am Rechner sitzt.
   */
  const grund = beurteileMenge(1_000_000, 500_000).grund ?? '';

  assert.match(grund, /1\.000\.000/);
  assert.match(grund, /500\.000/);
  assert.match(grund, /UNIKOM_HOECHSTMENGE/);
  assert.match(grund, /nichts verarbeitet/);
});

test('eine eigene Grenze gilt statt der Voreinstellung', () => {
  assert.equal(beurteileMenge(20, 10).traegt, false);
  assert.equal(beurteileMenge(20, 1_000).traegt, true);
});

test('gezählt wird über alle Quellen', () => {
  const quellen: Quelle[] = [
    { id: 'a', name: 'a', felder: ['x'], zeilen: [['1'], ['2']] },
    { id: 'b', name: 'b', felder: ['x'], zeilen: [['3']] },
  ];

  assert.equal(datensaetzeIn(quellen), 3);
});

test('ohne Quellen ist die Menge null', () => {
  assert.equal(datensaetzeIn([]), 0);
  assert.equal(beurteileMenge(0).traegt, true);
});
