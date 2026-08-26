import assert from 'node:assert/strict';
import test from 'node:test';

import { datensaetze, type Datensatz, type Quelle } from './Quellen.js';
import {
  nachDatensatz,
  QUELLE_BEARBEITUNG,
  type Datensatzentscheidung,
  type Vorentscheidung,
} from './Vorentscheidung.js';
import { fuehreZusammen } from './Zusammenfuehren.js';

function satz(quelle: string, zeile: number, werte: Record<string, string>): Datensatz {
  return { quelle, zeile, werte: new Map(Object.entries(werte)) };
}

/** Ein Fall, wie ihn die Konfliktbearbeitung abgibt. */
function fall(werte: Record<string, string>, datensatz = '4711', nummer = '3f2a'): Vorentscheidung {
  return { datensatz, werte, herkunft: `Konfliktfall ${nummer}, entschieden am 26.08.2026 von OKE` };
}

/** Was davon beim Zusammenführen ankommt — über denselben Weg wie im Lauf. */
function fuer(werte: Record<string, string>, datensatz = '4711'): Datensatzentscheidung | undefined {
  return nachDatensatz([fall(werte, datensatz)]).get(datensatz);
}

function werteVon(entscheidung: Datensatzentscheidung | undefined): Record<string, string> {
  return Object.fromEntries([...(entscheidung?.felder ?? [])].map(([feld, satz]) => [feld, satz.wert]));
}

/* ---------- Zusammenlegen ---------- */

test('mehrere Fälle zu einem Datensatz werden feldweise zusammengelegt', () => {
  /*
   * Je strittigem Feld entsteht ein eigener Konfliktfall. Ein Datensatz mit
   * drei strittigen Feldern hat also drei — und überschriebe man statt
   * zusammenzulegen, käme eine Entscheidung an und zwei wären wieder Konflikte.
   */
  const gesammelt = nachDatensatz([fall({ ort: 'Bonn' }), fall({ plz: '53111' })]);

  assert.equal(gesammelt.size, 1);
  assert.deepEqual(werteVon(gesammelt.get('4711')), { ort: 'Bonn', plz: '53111' });
});

test('jedes Feld nennt den Fall, aus dem es kommt', () => {
  /*
   * Die Herkunft steht am Feld und nicht am Datensatz. Trüge der Datensatz eine
   * einzige, bekämen alle Felder die des zuletzt eingelesenen Falls — und die
   * Nachvollziehbarkeit zählte zwei Fallnummern weniger, ohne es zu sagen.
   */
  const gesammelt = nachDatensatz([fall({ ort: 'Bonn' }, '4711', 'aaa'), fall({ plz: '53111' }, '4711', 'bbb')]);
  const felder = gesammelt.get('4711')?.felder;

  assert.match(felder?.get('ort')?.herkunft ?? '', /Konfliktfall aaa/);
  assert.match(felder?.get('plz')?.herkunft ?? '', /Konfliktfall bbb/);
});

test('beim selben Feld gewinnt die spätere Entscheidung', () => {
  // Sie ist die jüngere Antwort auf dieselbe Frage — mitsamt ihrer Herkunft.
  const gesammelt = nachDatensatz([fall({ ort: 'Bonn' }, '4711', 'aaa'), fall({ ort: 'Köln' }, '4711', 'bbb')]);

  assert.equal(gesammelt.get('4711')?.felder.get('ort')?.wert, 'Köln');
  assert.match(gesammelt.get('4711')?.felder.get('ort')?.herkunft ?? '', /Konfliktfall bbb/);
});

test('verschiedene Datensätze bleiben getrennt', () => {
  const gesammelt = nachDatensatz([fall({ ort: 'Bonn' }), fall({ ort: 'Köln' }, '4712')]);

  assert.deepEqual([...gesammelt.keys()].sort(), ['4711', '4712']);
  assert.equal(gesammelt.get('4711')?.felder.get('ort')?.wert, 'Bonn');
});

test('ohne Entscheidungen bleibt die Sammlung leer', () => {
  assert.equal(nachDatensatz([]).size, 0);
});

/* ---------- Die Entscheidung schlägt jede Regel ---------- */

test('der entschiedene Wert steht im Ergebnis, nicht der aus der Quellenpriorität', () => {
  /*
   * Als weitere Quelle mitzukommen wäre naheliegend und falsch: Dann könnte die
   * eingestellte Quellenpriorität sie überstimmen, und der Mensch, der zwanzig
   * Minuten an dem Fall gesessen hat, fände seinen Wert nicht wieder.
   */
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Köln' })],
    { quellen: ['a', 'b'] },
    undefined,
    fuer({ ort: 'Hamburg' })
  );

  assert.equal(ergebnis.werte.get('ort'), 'Hamburg');
  assert.equal(ergebnis.konflikte.length, 0, 'und es bleibt kein Konflikt übrig');
});

test('sie gilt auch dort, wo die Quellen sich einig sind', () => {
  /*
   * Ein Mensch hat den Wert für diesen Datensatz eingetragen — nicht unter dem
   * Vorbehalt, dass die Lieferung ihm nicht widerspricht.
   */
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Bonn' })],
    {},
    undefined,
    fuer({ ort: 'Hamburg' })
  );

  assert.equal(ergebnis.werte.get('ort'), 'Hamburg');
});

test('ohne sie entsteht der Konflikt wie zuvor', () => {
  // Der Nachweis, dass der Test oben etwas misst.
  const ergebnis = fuehreZusammen('4711', [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Köln' })]);

  assert.equal(ergebnis.konflikte.length, 1);
});

test('nur das entschiedene Feld, die übrigen laufen durch die Regeln', () => {
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn', name: 'Meier' }), satz('b', 1, { ort: 'Köln', name: 'Schulz' })],
    { quellen: ['a', 'b'] },
    undefined,
    fuer({ ort: 'Hamburg' })
  );

  assert.equal(ergebnis.werte.get('ort'), 'Hamburg');
  assert.equal(ergebnis.werte.get('name'), 'Meier', 'hier gilt weiterhin die Quellenpriorität');
});

test('eine Entscheidung für einen anderen Datensatz greift nicht', () => {
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Köln' })],
    {},
    undefined,
    nachDatensatz([fall({ ort: 'Hamburg' }, '9999')]).get('4711')
  );

  assert.equal(ergebnis.werte.get('ort'), '');
  assert.equal(ergebnis.konflikte.length, 1);
});

/* ---------- Was der Wert über sich sagt ---------- */

test('der Wert trägt, woher er kommt', () => {
  /*
   * Ein Ergebnis, in dem nicht mehr zu sehen ist, welche Werte von Hand gesetzt
   * wurden, wäre genau das, was die Nachvollziehbarkeit verhindern soll.
   */
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Köln' })],
    {},
    undefined,
    fuer({ ort: 'Hamburg' })
  );
  const feld = ergebnis.felder.find((eintrag) => eintrag.feld === 'ort');

  assert.equal(feld?.grund, 'KONFLIKTBEARBEITUNG');
  assert.equal(feld?.quelle, QUELLE_BEARBEITUNG);
  assert.match(feld?.begruendung ?? '', /Konfliktfall 3f2a/);
});

test('bei mehreren Fällen nennt jedes Feld seinen eigenen', () => {
  const entschieden = nachDatensatz([
    fall({ ort: 'Hamburg' }, '4711', 'aaa'),
    fall({ name: 'Schmitz' }, '4711', 'bbb'),
  ]).get('4711');

  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn', name: 'Meier' }), satz('b', 1, { ort: 'Köln', name: 'Schulz' })],
    {},
    undefined,
    entschieden
  );

  assert.match(ergebnis.felder.find((feld) => feld.feld === 'ort')?.begruendung ?? '', /aaa/);
  assert.match(ergebnis.felder.find((feld) => feld.feld === 'name')?.begruendung ?? '', /bbb/);
});

test('was übergangen wurde, steht vollständig dabei', () => {
  // Damit man nachsehen kann, wogegen entschieden wurde.
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Köln' })],
    {},
    undefined,
    fuer({ ort: 'Hamburg' })
  );
  const feld = ergebnis.felder.find((eintrag) => eintrag.feld === 'ort');

  assert.deepEqual(feld?.uebergangen.map((angebot) => angebot.wert).sort(), ['Bonn', 'Köln']);
});

test('eine Entscheidung ist keine Schätzung', () => {
  /*
   * Konfidenz 1: Sie noch einmal an einer Mindestkonfidenz zu messen hieße, sie
   * zur Vermutung zu erklären.
   */
  const ergebnis = fuehreZusammen(
    '4711',
    [satz('a', 1, { ort: 'Bonn' }), satz('b', 1, { ort: 'Köln' })],
    { mindestKonfidenz: 0.99 },
    undefined,
    fuer({ ort: 'Hamburg' })
  );

  assert.equal(ergebnis.felder.find((eintrag) => eintrag.feld === 'ort')?.konfidenz, 1);
});

test('ein entschiedener Wert darf leer sein', () => {
  /*
   * „Das Feld bleibt leer" ist eine Entscheidung wie jede andere — sonst gäbe
   * es keinen Weg, einen falsch gefüllten Wert wieder loszuwerden.
   */
  const quelle: Quelle = { id: 'a', name: 'a.csv', felder: ['ort'], zeilen: [['Bonn']] };
  const ergebnis = fuehreZusammen('4711', datensaetze(quelle), {}, undefined, fuer({ ort: '' }));

  assert.equal(ergebnis.werte.get('ort'), '');
  assert.equal(ergebnis.felder.find((eintrag) => eintrag.feld === 'ort')?.grund, 'KONFLIKTBEARBEITUNG');
});
