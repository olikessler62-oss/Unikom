import assert from 'node:assert/strict';
import test from 'node:test';

import { eintraegeAus, platzierung, wunschhoehe } from './Auswahlfeld.js';

/**
 * Ein `<option>`, wie React es aus JSX macht - so viel davon, wie gelesen wird.
 *
 * Von Hand gebaut und nicht mit JSX: Diese Prüfungen laufen ohne Browser und
 * ohne Übersetzer für Markup. Was zählt, ist die Form, die ankommt.
 */
function option(eigenschaften: Record<string, unknown>) {
  return { $$typeof: Symbol.for('react.transitional.element'), type: 'option', key: null, props: eigenschaften };
}

/* ---------- Die Einträge lesen ---------- */

test('Wert und Text kommen aus dem option', () => {
  const gelesen = eintraegeAus([option({ value: 'de', children: 'Deutsch' })]);

  assert.deepEqual(gelesen, [{ wert: 'de', text: 'Deutsch', deaktiviert: false }]);
});

test('ohne value gilt der Text als Wert', () => {
  /* Genau wie bei einem echten `<option>`. */
  const gelesen = eintraegeAus([option({ children: 'Alle' })]);

  assert.deepEqual(gelesen, [{ wert: 'Alle', text: 'Alle', deaktiviert: false }]);
});

test('ein leerer Wert bleibt ein leerer Wert', () => {
  /*
   * Die Falle: `value=""` ist der übliche Platzhalter „nichts gewählt". Ein
   * Rückfall auf den Text machte daraus stillschweigend „Alle lesbaren" - und
   * das Formular schickte einen Wert, den niemand eingestellt hat.
   */
  const gelesen = eintraegeAus([option({ value: '', children: 'Alle lesbaren' })]);

  assert.equal(gelesen[0].wert, '');
});

test('eine Zahl als Wert wird zur Zeichenkette', () => {
  const gelesen = eintraegeAus([option({ value: 3, children: 'Drei' })]);

  assert.equal(gelesen[0].wert, '3');
});

test('ein Text aus Stücken wird zusammengesetzt', () => {
  const gelesen = eintraegeAus([option({ value: 'x', children: ['Name', ' · ', 42] })]);

  assert.equal(gelesen[0].text, 'Name · 42');
});

test('was kein option ist, zählt nicht', () => {
  const gelesen = eintraegeAus([option({ value: 'a', children: 'A' }), 'loser Text', null, false]);

  assert.equal(gelesen.length, 1);
});

test('deaktiviert wird übernommen', () => {
  const gelesen = eintraegeAus([option({ value: 'a', children: 'A', disabled: true })]);

  assert.equal(gelesen[0].deaktiviert, true);
});

/* ---------- Wohin die Liste gehört ---------- */

/** Ein Feld von 200 Breite und 28 Höhe. */
const feld = (oben: number) => ({ left: 100, top: oben, bottom: oben + 28, width: 200 });

test('sie hängt unter dem Feld, wenn sie dort hineinpasst', () => {
  const platz = platzierung(feld(100), 200, 800);

  assert.equal(platz.oben, 132, 'vier Pixel Luft unter dem Feld');
  assert.equal(platz.hoehe, 200);
  assert.equal(platz.breite, 200);
});

test('sie klappt nach oben, wenn unten zu wenig Platz ist', () => {
  /* Feld weit unten: darunter 72, darüber 692. */
  const platz = platzierung(feld(700), 300, 800);

  assert.equal(platz.oben, 700 - 4 - 300);
  assert.equal(platz.hoehe, 300);
});

test('sie bleibt unten, wenn dort trotzdem mehr Platz ist', () => {
  /* Feld ganz oben: darüber 12, darunter 728 - oben wäre es enger. */
  const platz = platzierung(feld(16), 900, 800);

  assert.equal(platz.oben, 48);
});

test('passt sie nirgends ganz, wird sie gestutzt', () => {
  /*
   * Gestutzt und nicht überstehend: Eine Liste, die aus dem Fenster ragt, hat
   * Einträge, die niemand erreicht.
   */
  const platz = platzierung(feld(400), 900, 800);

  assert.ok(platz.hoehe < 900);
  assert.ok(platz.oben + platz.hoehe <= 800, 'sie endet im Fenster');
});

test('sie wird nie negativ hoch', () => {
  /* Ein Feld, das selbst schon außerhalb steht - gerechnet wird trotzdem. */
  const platz = platzierung(feld(2000), 300, 800);

  assert.ok(platz.hoehe >= 0);
});

/* ---------- Wie hoch die Liste sein will ---------- */

test('der Rahmen zählt mit', () => {
  /*
   * Drei Einträge zu 24 Pixeln, oben und unten vier Pixel Innenabstand, ein
   * Pixel Rahmen ringsum: 80 innen, 82 außen. Ohne die zwei Pixel rollte die
   * Liste bei drei Einträgen - eine Laufleiste, die sich kaum bewegen lässt.
   */
  assert.equal(wunschhoehe({ scrollHeight: 80, offsetHeight: 82, clientHeight: 80 }), 82);
});

test('rollt sie schon, ändert das nichts an der Rechnung', () => {
  /* clientHeight ist dann die gestutzte Höhe; der Rahmen bleibt zwei Pixel. */
  assert.equal(wunschhoehe({ scrollHeight: 400, offsetHeight: 202, clientHeight: 200 }), 402);
});
