import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOrderOf } from '../tenants/Region.js';
import { isAmbiguous, parseDate } from './Dates.js';
import { isWholeNumber, parseNumber, separatorsOf } from './Numbers.js';

const de = separatorsOf('de-DE');
const us = separatorsOf('en-US');
const fr = separatorsOf('fr-FR');
const ch = separatorsOf('de-CH');

test('die Trennzeichen stammen aus der Sprache, nicht aus einer Tabelle', () => {
  assert.deepEqual(de, { group: '.', decimal: ',' });
  assert.deepEqual(us, { group: ',', decimal: '.' });
  assert.equal(ch.group, "'", 'die Schweiz gruppiert mit einem geraden Apostroph, U+0027');
});

test('dieselbe Zeichenfolge ergibt je Region eine andere Zahl', () => {
  // Der teuerste Fall des ganzen Moduls: beide Lesarten gelingen, und sie
  // unterscheiden sich um den Faktor tausend.
  assert.equal(parseNumber('1,234', de), 1.234);
  assert.equal(parseNumber('1,234', us), 1234);

  assert.equal(parseNumber('1.234,56', de), 1234.56);
  assert.equal(parseNumber('1,234.56', us), 1234.56);
});

test('eine Gruppe hat drei Stellen — sonst ist es keine Gruppe', () => {
  // Genau diese Strenge trennt „amerikanische Zahl" von „deutscher Zahl mit
  // merkwürdigem Komma". Ohne sie liest UniCom fremde Dateien klaglos falsch.
  assert.equal(parseNumber('1,2345', us), undefined);
  assert.equal(parseNumber('1,2345', de), 1.2345);
  assert.equal(parseNumber('12.34.567', de), undefined);
  assert.equal(parseNumber('1.234.567', de), 1234567);
});

test('Vorzeichen und Klammernotation', () => {
  assert.equal(parseNumber('-1.234,56', de), -1234.56);
  assert.equal(parseNumber('(1.234,56)', de), -1234.56);
  assert.equal(parseNumber('+42', de), 42);
});

test('Leerzeichen als Gruppentrenner, in allen Ausprägungen', () => {
  // Frankreich gruppiert offiziell mit U+202F. In einer Datei, die durch drei
  // Programme gelaufen ist, steht dort auch mal U+00A0 oder ein gewöhnliches
  // Leerzeichen — und gemeint ist jedes Mal dieselbe Zahl.
  assert.equal(fr.group, '\u202f');

  for (const leerzeichen of ['\u202f', '\u00a0', '\u0020', '\u2009']) {
    assert.equal(parseNumber(`1${leerzeichen}234,56`, fr), 1234.56, `U+${leerzeichen.codePointAt(0)!.toString(16)}`);
  }
});

test('was keine Zahl ist, wird auch keine', () => {
  for (const text of ['ABC123', '', '   ', '1,2,3', '12-34', '1.2.3,4,5', 'NULL']) {
    assert.equal(parseNumber(text, de), undefined, text);
  }
});

test('ganze Zahl und Dezimalzahl werden unterschieden', () => {
  assert.equal(isWholeNumber('1.234', de), true, 'unter de-DE sind das tausendzweihundertvierunddreißig');
  assert.equal(isWholeNumber('1.234', us), false, 'unter en-US ist es eins Komma zwei drei vier');
});

test('das Datum folgt der Reihenfolge der Region', () => {
  const deutsch = dateOrderOf('de-DE');
  const amerikanisch = dateOrderOf('en-US');

  assert.deepEqual(parseDate('04/03/2026', deutsch), { year: 2026, month: 3, day: 4 });
  assert.deepEqual(parseDate('04/03/2026', amerikanisch), { year: 2026, month: 4, day: 3 });
});

test('die ISO-Schreibweise gilt unabhängig von der Region', () => {
  // Wer 2026-03-04 schreibt, meint nichts anderes — auch nicht in den USA.
  for (const locale of ['de-DE', 'en-US', 'ja-JP']) {
    assert.deepEqual(parseDate('2026-03-04', dateOrderOf(locale)), { year: 2026, month: 3, day: 4 }, locale);
  }
});

test('zweistellige Jahreszahlen nach der Pivot-Regel', () => {
  const deutsch = dateOrderOf('de-DE');

  assert.deepEqual(parseDate('18.08.26', deutsch), { year: 2026, month: 8, day: 18 });
  assert.deepEqual(parseDate('18.08.50', deutsch), { year: 1950, month: 8, day: 18 });
  assert.deepEqual(parseDate('18.08.49', deutsch), { year: 2049, month: 8, day: 18 });
});

test('der Kalender wird geprüft, nicht nur der Zahlenbereich', () => {
  const deutsch = dateOrderOf('de-DE');

  assert.equal(parseDate('31.02.2026', deutsch), undefined, 'den 31. Februar gibt es nicht');
  assert.equal(parseDate('29.02.2026', deutsch), undefined, '2026 ist kein Schaltjahr');
  assert.deepEqual(parseDate('29.02.2024', deutsch), { year: 2024, month: 2, day: 29 });
});

test('ein Datum, das der Region widerspricht, wird nicht gelesen', () => {
  // 13 kann kein Monat sein. Unter amerikanischer Lesart ist die Angabe damit
  // kein Datum — und das ist die richtige Antwort, nicht „na dann eben Tag".
  assert.equal(parseDate('13/05/2026', dateOrderOf('en-US')), undefined);
  assert.deepEqual(parseDate('13/05/2026', dateOrderOf('de-DE')), { year: 2026, month: 5, day: 13 });
});

test('mehrdeutige Angaben sind als solche erkennbar', () => {
  assert.equal(isAmbiguous('04/03/2026'), true);
  assert.equal(isAmbiguous('13/05/2026'), false, 'nur eine Lesart gelingt');
  assert.equal(isAmbiguous('2026-03-04'), false, 'ISO ist eindeutig');
  assert.equal(isAmbiguous('03/03/2026'), false, 'beide Lesarten ergeben denselben Tag');
});
