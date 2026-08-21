import assert from 'node:assert/strict';
import test from 'node:test';

import type { Quelle } from '../../domain/consolidation/Quellen.js';
import { istLeer, wendeUmformungAn } from './Umformungslauf.js';

const QUELLE: Quelle = {
  id: 'a.csv',
  name: 'a.csv',
  felder: ['kdnr', 'name'],
  zeilen: [
    ['1', 'Meier, Anna'],
    ['2', 'Schulz, Bert'],
  ],
};

test('ohne Plan wird nichts angefasst — nicht einmal kopiert', () => {
  /*
   * Der Plan liegt in jedem Lauf im Weg. Ohne diese Abkürzung würde für jede
   * Zeile jeder Quelle eine Map gebaut und wieder abgebaut, um am Ende
   * denselben Wert zu erhalten — bei 600 000 Zeilen ist das keine Feinheit
   * mehr.
   */
  const ergebnis = wendeUmformungAn([QUELLE], undefined);

  assert.equal(ergebnis.quellen[0], QUELLE, 'dieselbe Quelle, nicht eine gleiche');
  assert.equal(ergebnis.veraendert, 0);
});

test('ein Plan ohne eine einzige Regel gilt als leer', () => {
  assert.equal(istLeer(undefined), true);
  assert.equal(istLeer({}), true);
  assert.equal(istLeer({ felder: [], aufteilungen: [], zusammenfuehrungen: [] }), true);
  assert.equal(istLeer({ felder: [{ feld: 'a', schritte: [{ art: 'TRIMMEN' }] }] }), false);
});

test('mit Plan entsteht eine neue Quelle, die alte bleibt unberührt', () => {
  // Ein Lauf, der seine Eingabe verändert, macht jeden zweiten Durchlauf zu
  // etwas anderem als den ersten.
  const ergebnis = wendeUmformungAn([QUELLE], {
    felder: [{ feld: 'name', schritte: [{ art: 'GROSS' }] }],
  });

  assert.notEqual(ergebnis.quellen[0], QUELLE);
  assert.deepEqual(QUELLE.zeilen[0], ['1', 'Meier, Anna']);
  assert.deepEqual(ergebnis.quellen[0].zeilen[0], ['1', 'MEIER, ANNA']);
});

test('was geschah, steht je Regel und nicht je Zeile im Bericht', () => {
  // Eine Zeile je verändertem Wert ergäbe bei 600 000 Zeilen ein Protokoll,
  // das niemand liest und das die Datenbank füllt.
  const ergebnis = wendeUmformungAn([QUELLE], {
    felder: [{ feld: 'name', schritte: [{ art: 'GROSS' }] }],
  });

  assert.equal(ergebnis.hinweise.length, 1);
  assert.match(ergebnis.hinweise[0], /2 Wert\(e\) in „name" umgeformt/);
  assert.equal(ergebnis.veraendert, 2);
});

test('eine Aufteilung legt keine Spalten in einer Datei an, die das Quellfeld nicht hat', () => {
  /*
   * Zwei Dateien, eine mit „name", eine ohne. Legte die Regel auch in der
   * zweiten Zielspalten an, stünden dort lauter leere Werte — und die
   * Vollständigkeitsprüfung fragte, wo sie geblieben sind.
   */
  const ohneName: Quelle = { id: 'b.csv', name: 'b.csv', felder: ['kdnr', 'ort'], zeilen: [['3', 'Bonn']] };

  const ergebnis = wendeUmformungAn([QUELLE, ohneName], {
    aufteilungen: [
      { quelle: 'name', ziele: ['nachname', 'vorname'], trennung: { art: 'ZEICHEN', zeichen: ',' } },
    ],
  });

  assert.deepEqual(ergebnis.quellen[0].felder, ['kdnr', 'name', 'nachname', 'vorname']);
  assert.deepEqual(ergebnis.quellen[1].felder, ['kdnr', 'ort'], 'hier gibt es nichts aufzuteilen');
});

test('eine Zusammenführung braucht mindestens ein vorhandenes Quellfeld', () => {
  // Sonst entstünde eine Spalte aus lauter leeren Werten.
  const ergebnis = wendeUmformungAn([QUELLE], {
    zusammenfuehrungen: [{ ziel: 'anschrift', quellen: ['strasse', 'ort'], trenner: ', ' }],
  });

  assert.deepEqual(ergebnis.quellen[0].felder, ['kdnr', 'name']);
});
