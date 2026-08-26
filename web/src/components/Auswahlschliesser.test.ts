import assert from 'node:assert/strict';
import test from 'node:test';

import { ABSTAND, alsRechteck, umschliesst, zuWeitFort, type Rechteck } from './Auswahlschliesser.js';

/** Ein Feld von 200 × 30, darunter eine Liste bis y = 300. */
const RAHMEN: Rechteck = { links: 100, oben: 100, rechts: 300, unten: 300 };

/* ---------- Der Rand ---------- */

test('zwanzig Pixel ist eine Handbreit — nicht null', () => {
  /*
   * Die Kante ist keine Wand: Wer am Rand der Liste entlangfährt, verlöre sie
   * sonst bei jedem Zittern.
   */
  assert.equal(ABSTAND, 20);
});

test('innerhalb der Liste geschieht nichts', () => {
  assert.equal(zuWeitFort(RAHMEN, { x: 200, y: 200 }), false);
});

test('auf der Kante geschieht nichts', () => {
  assert.equal(zuWeitFort(RAHMEN, { x: 300, y: 300 }), false);
});

test('genau am Rand geschieht noch nichts', () => {
  assert.equal(zuWeitFort(RAHMEN, { x: 320, y: 300 }), false);
  assert.equal(zuWeitFort(RAHMEN, { x: 300, y: 320 }), false);
});

test('der Rand liegt auf jeder Seite und nicht nur rechts', () => {
  /*
   * Die Liste steht oft am rechten Rand der Fläche; wer nur dort misst, sieht
   * es lange nicht. Nach links, oben und unten gilt dieselbe Handbreit.
   */
  assert.equal(zuWeitFort(RAHMEN, { x: 90, y: 200 }), false, 'links im Rand');
  assert.equal(zuWeitFort(RAHMEN, { x: 200, y: 90 }), false, 'oben im Rand');
  assert.equal(zuWeitFort(RAHMEN, { x: 200, y: 310 }), false, 'unten im Rand');
});

test('einen Schritt weiter schließt sie', () => {
  assert.equal(zuWeitFort(RAHMEN, { x: 321, y: 300 }), true);
});

test('nach oben, unten, links und rechts gilt dasselbe', () => {
  assert.equal(zuWeitFort(RAHMEN, { x: 79, y: 200 }), true, 'links');
  assert.equal(zuWeitFort(RAHMEN, { x: 200, y: 79 }), true, 'oben');
  assert.equal(zuWeitFort(RAHMEN, { x: 200, y: 321 }), true, 'unten');
});

test('gemessen wird je Achse und nicht in der Luftlinie', () => {
  /*
   * Ein Zeiger seitlich neben der Liste ist fort, auch wenn er auf ihrer Höhe
   * geblieben ist. Die Luftlinie ließe eine schräge Ecke zu, in der die Liste
   * stehen bliebe, obwohl der Zeiger längst woanders ist.
   */
  assert.equal(zuWeitFort(RAHMEN, { x: 315, y: 315 }), false, 'die Ecke des Randes gehört noch dazu');
  assert.equal(zuWeitFort(RAHMEN, { x: 325, y: 305 }), true, 'eine Achse genügt');
});

test('der Abstand lässt sich vorgeben', () => {
  assert.equal(zuWeitFort(RAHMEN, { x: 310, y: 200 }, 5), true);
});

/* ---------- Der Rahmen um Feld und Liste ---------- */

test('der Rahmen umschließt alle Teile', () => {
  const rahmen = umschliesst([
    { links: 100, oben: 100, rechts: 300, unten: 130 },
    { links: 100, oben: 135, rechts: 460, unten: 300 },
  ]);

  assert.deepEqual(rahmen, { links: 100, oben: 100, rechts: 460, unten: 300 });
});

test('ohne Teile gibt es keinen Rahmen', () => {
  // Kein Eintrag hat Ausdehnung: Die Liste ist zu, und es gibt nichts zu schließen.
  assert.equal(umschliesst([]), undefined);
});

test('ein einzelnes Teil ist schon der Rahmen', () => {
  const eines = { links: 1, oben: 2, rechts: 3, unten: 4 };

  assert.deepEqual(umschliesst([eines]), eines);
});

test('das geschlossene Feld gehört dazu', () => {
  /*
   * Ohne es läge die Grenze mitten auf dem Feld, sobald die Liste nach unten
   * aufklappt — und ein Zeiger auf dem Feld selbst schlösse die Liste, die er
   * gerade geöffnet hat.
   */
  const feld = { links: 100, oben: 100, rechts: 300, unten: 130 };
  const liste = { links: 100, oben: 135, rechts: 300, unten: 400 };

  assert.equal(zuWeitFort(umschliesst([feld, liste]) as Rechteck, { x: 200, y: 110 }), false);
});

test('ein Kasten des Browsers wird auf unsere Namen gebracht', () => {
  assert.deepEqual(alsRechteck({ left: 1, top: 2, right: 3, bottom: 4 }), {
    links: 1,
    oben: 2,
    rechts: 3,
    unten: 4,
  });
});
