import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ABSTAND,
  alsRechteck,
  rahmenUm,
  umschliesst,
  zuWeitFort,
  type Rechteck,
} from './Auswahlschliesser.js';

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

/* ---------- Der Rahmen um ein Fach ---------- */

/** Ein Teil, das sich messen lässt — so viel, wie die Rechnung braucht. */
function teil(links: number, oben: number, rechts: number, unten: number) {
  return {
    getBoundingClientRect: () => ({
      left: links,
      top: oben,
      right: rechts,
      bottom: unten,
      width: rechts - links,
      height: unten - oben,
    }),
  };
}

test('der Rahmen spannt sich über Knopf und Fach', () => {
  const knopf = teil(500, 20, 530, 48);
  const fach = teil(300, 60, 730, 400);

  assert.deepEqual(rahmenUm([knopf, fach]), { links: 300, oben: 20, rechts: 730, unten: 400 });
});

test('ein Teil, das nicht dasteht, zählt nicht mit', () => {
  /*
   * Das Fach steht nur im Dokument, solange es offen ist. Die Ref auf ein
   * geschlossenes Fach ist leer — und ein leerer Platz darf den Rahmen nicht
   * verändern.
   */
  const knopf = teil(500, 20, 530, 48);

  assert.deepEqual(rahmenUm([knopf, null]), { links: 500, oben: 20, rechts: 530, unten: 48 });
  assert.deepEqual(rahmenUm([knopf, undefined]), { links: 500, oben: 20, rechts: 530, unten: 48 });
});

test('ein Teil ohne Ausdehnung zieht den Rahmen nicht in die Ecke', () => {
  /*
   * Das ist die Falle. Ein Element, das im Dokument steht, aber nichts einnimmt,
   * meldet ein Rechteck von null mal null an der Stelle 0,0. Nähme man es mit,
   * spannte sich der Rahmen bis in die linke obere Ecke des Bildschirms — und
   * der Zeiger wäre nie weit genug fort. Das Fach bliebe für immer offen.
   */
  const knopf = teil(500, 20, 530, 48);
  const leer = teil(0, 0, 0, 0);

  const rahmen = rahmenUm([knopf, leer]) as Rechteck;

  assert.deepEqual(rahmen, { links: 500, oben: 20, rechts: 530, unten: 48 });
  assert.equal(zuWeitFort(rahmen, { x: 100, y: 100 }), true);
});

test('ohne ein einziges dastehendes Teil gibt es keinen Rahmen', () => {
  /*
   * Kein Rahmen heißt: nichts zu schließen. Die Regel darf dann gar nichts tun
   * — ein Rahmen von null wäre einer, von dem jeder Zeiger weit fort ist.
   */
  assert.equal(rahmenUm([]), undefined);
  assert.equal(rahmenUm([null, undefined]), undefined);
  assert.equal(rahmenUm([teil(0, 0, 0, 0)]), undefined);
});

test('die Handbreit gilt auch für ein Fach', () => {
  const rahmen = rahmenUm([teil(500, 20, 530, 48), teil(300, 60, 730, 400)]) as Rechteck;

  assert.equal(zuWeitFort(rahmen, { x: 280, y: 200 }), false, 'zwanzig links: bleibt');
  assert.equal(zuWeitFort(rahmen, { x: 279, y: 200 }), true, 'einundzwanzig links: fort');
  assert.equal(zuWeitFort(rahmen, { x: 500, y: 420 }), false, 'zwanzig unter dem Fach: bleibt');
  assert.equal(zuWeitFort(rahmen, { x: 500, y: 421 }), true, 'einundzwanzig darunter: fort');
});
