import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCALES, previewOf } from './regions.js';

/* ---------- Die Auswahl kommt aus dem System ---------- */

test('die Welt steht zur Auswahl und nicht nur Europa', () => {
  /*
   * Hier standen einmal achtzehn europäische Länder. Ein Kunde mit einer
   * Lieferung aus Brasilien war damit nicht einzustellen.
   */
  const kennungen = LOCALES.map((eintrag) => eintrag.value);

  for (const erwartet of ['de-DE', 'en-US', 'ja-JP', 'pt-BR', 'hi-IN', 'zh-CN', 'ar-EG', 'en-AU']) {
    assert.ok(kennungen.includes(erwartet), `${erwartet} fehlt`);
  }

  // Weltweit heißt: deutlich mehr als ein Kontinent hergibt.
  assert.ok(LOCALES.length > 150, `nur ${LOCALES.length} Regionen`);
});

test('Zusammenschlüsse und Platzhalter stehen nicht darin', () => {
  /*
   * Das System kennt einen Namen für „Europäische Union" und „Unbekannte
   * Region". Nach beiden lässt sich kein Datum lesen.
   */
  const kennungen = LOCALES.map((eintrag) => eintrag.value);

  for (const code of ['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB']) {
    assert.ok(
      !kennungen.some((kennung) => kennung.endsWith(`-${code}`)),
      `${code} steht in der Auswahl`
    );
  }
});

test('mehrsprachige Länder stehen mehrfach, mit ihrer Sprache dabei', () => {
  /*
   * `maximize` nennt für die Schweiz nur Deutsch. Wer aus Genf liefert,
   * schreibt Zahlen aber anders — und beim Lesen entscheidet das über den
   * Betrag.
   */
  const schweiz = LOCALES.filter((eintrag) => eintrag.value.endsWith('-CH'));

  assert.ok(schweiz.length >= 2, `nur ${schweiz.length} Einträge für die Schweiz`);
  assert.ok(schweiz.some((eintrag) => eintrag.value === 'de-CH'));
  assert.ok(schweiz.some((eintrag) => eintrag.value === 'fr-CH'));

  // Und die Sprache steht dabei, sonst wären es zwei gleich benannte Zeilen.
  for (const eintrag of schweiz) {
    assert.match(eintrag.label, /Schweiz, /);
  }
});

test('wo die Sprache nichts trennt, steht sie auch nicht dabei', () => {
  // „Japan, Japanisch" wäre eine Angabe, die nichts unterscheidet.
  const japan = LOCALES.find((eintrag) => eintrag.value === 'ja-JP');

  assert.equal(japan?.label, 'Japan (ja-JP)');
});

test('jeder Eintrag nennt seine Kennung', () => {
  // Ohne sie ließe sich nicht nachsehen, was am Mandanten tatsächlich steht.
  for (const eintrag of LOCALES) {
    assert.ok(eintrag.label.endsWith(`(${eintrag.value})`), eintrag.label);
  }
});

test('die Liste steht alphabetisch', () => {
  // Bei zweihundert Einträgen ist die Reihenfolge der einzige Weg hinein.
  const beschriftungen = LOCALES.map((eintrag) => eintrag.label);
  const sortiert = [...beschriftungen].sort((eine, andere) => eine.localeCompare(andere, 'de'));

  assert.deepEqual(beschriftungen, sortiert);
});

test('keine Kennung steht zweimal', () => {
  const kennungen = LOCALES.map((eintrag) => eintrag.value);

  assert.equal(new Set(kennungen).size, kennungen.length);
});

/* ---------- Die Vorschau ---------- */

test('die Vorschau zeigt, wie dieser Mandant ein Datum schreibt', () => {
  assert.equal(previewOf('de-DE', 'Europe/Berlin').order, 'Tag zuerst');
  assert.equal(previewOf('en-US', 'America/New_York').order, 'Monat zuerst');
  assert.equal(previewOf('ja-JP', 'Asia/Tokyo').order, 'Jahr zuerst');
});

test('eine unbrauchbare Kennung bringt die Vorschau nicht um', () => {
  // Am Mandanten kann etwas stehen, das dieser Browser nicht kennt.
  assert.equal(previewOf('kein-locale', 'Europe/Berlin').sample, '-');
});
