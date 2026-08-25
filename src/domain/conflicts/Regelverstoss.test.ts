import assert from 'node:assert/strict';
import test from 'node:test';

import type { Befund } from '../quality/Regeln.js';
import { fallAus, LEER, REGELVERSTOSS, type Regelverstoss } from './Regelverstoss.js';

const KOPF = { tenantId: 'default', laufId: 'TR-1' };

function befund(teile: Partial<Befund> = {}): Befund {
  return {
    zeile: 44,
    feld: 'Kundennummer',
    schwere: 'KONFLIKT',
    ursache: '„Kundennummer" ist leer',
    auswirkung: 'Ohne diesen Wert lässt sich der Datensatz nicht zuordnen',
    regel: 'Kundennummer darf nicht leer sein',
    ...teile,
  };
}

function verstoss(teile: Partial<Regelverstoss> = {}): Regelverstoss {
  return {
    quelle: 'Kunden.csv',
    zeile: 44,
    satz: new Map([
      ['Kundennummer', ''],
      ['Ort', 'Köln'],
    ]),
    befunde: [befund()],
    ...teile,
  };
}

/* ---------- Der Fall ---------- */

test('aus einem Regelverstoß wird ein offener Konfliktfall', () => {
  const fall = fallAus(verstoss(), KOPF);

  assert.equal(fall.status, 'OFFEN');
  assert.equal(fall.art, REGELVERSTOSS);
  assert.equal(fall.tenantId, 'default');
  assert.equal(fall.laufId, 'TR-1');
});

test('er ist ein Konflikt und nie kritisch', () => {
  /*
   * Die Schwere der Regel hat ihn überhaupt erst hierher gebracht: Was
   * „Fehler" heißt, ist gar nicht zur Entscheidung vorgelegt worden, sondern
   * gescheitert.
   */
  assert.equal(fallAus(verstoss(), KOPF).kritikalitaet, 'KONFLIKT');
});

test('der Datensatz ist an Datei und Zeile zu erkennen', () => {
  // Etwas Besseres gibt es nicht: Ein Regelverstoß entsteht auch dort, wo
  // gerade der Schlüssel fehlt.
  assert.equal(fallAus(verstoss(), KOPF).datensatz, '„Kunden.csv", Zeile 44');
});

test('Ursache, Erwartung und Vorgefundenes stehen darin', () => {
  const fall = fallAus(verstoss(), KOPF);

  assert.match(fall.ursache, /„Kundennummer" ist leer/);
  assert.equal(fall.erwartet, 'Kundennummer darf nicht leer sein');
  assert.equal(fall.vorgefunden, `Kundennummer: ${LEER}`);
});

test('ein vorhandener Wert steht in Anführungszeichen', () => {
  const fall = fallAus(
    verstoss({
      satz: new Map([['Ort', 'Kölnn']]),
      befunde: [befund({ feld: 'Ort', ursache: '„Ort" steht nicht in der Liste' })],
    }),
    KOPF
  );

  assert.equal(fall.vorgefunden, 'Ort: „Kölnn"');
});

/* ---------- Die Streitfelder ---------- */

test('der vorgefundene Wert steht als Angebot der Quelle darin', () => {
  /*
   * Obwohl gerade er nicht genügt: Ein Feld ohne jedes Angebot sähe aus, als
   * wäre nichts geliefert worden. Wer ihn übernimmt, bekommt die Prüfung
   * erneut — Fachregeln gelten auch für eine Eingabe von Hand.
   */
  const fall = fallAus(verstoss({ satz: new Map([['Kundennummer', '47-11']]) }), KOPF);

  assert.equal(fall.felder.length, 1);
  assert.equal(fall.felder[0].feld, 'Kundennummer');
  assert.deepEqual(fall.felder[0].angebote[0].quelle, 'Kunden.csv');
  assert.equal(fall.felder[0].angebote[0].wert, '47-11');
});

test('der Befund darf den Wert selbst mitbringen', () => {
  // Er kennt ihn genauer als der Datensatz — etwa den umgeformten Wert.
  const fall = fallAus(verstoss({ befunde: [befund({ wert: 'abc' })] }), KOPF);

  assert.equal(fall.felder[0].angebote[0].wert, 'abc');
});

test('Zeile und Regel reisen als Metadaten mit', () => {
  const angebot = fallAus(verstoss(), KOPF).felder[0].angebote[0];

  assert.equal(angebot.metadaten?.Zeile, '44');
  assert.equal(angebot.metadaten?.Regel, 'Kundennummer darf nicht leer sein');
});

test('drei Verstöße in einer Zeile ergeben einen Fall mit drei Feldern', () => {
  /*
   * Drei Fälle daraus zu machen hieße, denselben Datensatz dreimal
   * vorzulegen — und der Mensch entschiede dreimal, ohne die anderen beiden
   * zu sehen.
   */
  const fall = fallAus(
    verstoss({
      befunde: [befund(), befund({ feld: 'Ort' }), befund({ feld: 'Land' })],
    }),
    KOPF
  );

  assert.deepEqual(
    fall.felder.map((feld) => feld.feld),
    ['Kundennummer', 'Ort', 'Land']
  );
});

test('zwei Regeln über dasselbe Feld ergeben ein Streitfeld', () => {
  // Sonst stünde dasselbe Feld zweimal untereinander, und die zweite Eingabe
  // überschriebe die erste.
  const fall = fallAus(verstoss({ befunde: [befund(), befund({ regel: 'Format' })] }), KOPF);

  assert.equal(fall.felder.length, 1);
});

test('ein Befund ohne Feld bekommt kein Streitfeld', () => {
  /*
   * Ihm eines zu geben hieße, einen Namen zu erfinden, unter dem der Mensch
   * etwas einträgt, das nirgends ankommt.
   */
  const fall = fallAus(verstoss({ befunde: [befund({ feld: undefined })] }), KOPF);

  assert.equal(fall.felder.length, 0);
  assert.match(fall.ursache, /ist leer/, 'die Ursache steht trotzdem im Fall');
});

/* ---------- Was der Mensch tun soll ---------- */

test('bei einem Feld nennt der nächste Schritt es beim Namen', () => {
  assert.match(fallAus(verstoss(), KOPF).naechsteSchritte, /„Kundennummer" prüfen/);
});

test('bei mehreren steht der Satz allgemein', () => {
  const fall = fallAus(verstoss({ befunde: [befund(), befund({ feld: 'Ort' })] }), KOPF);

  assert.match(fall.naechsteSchritte, /beanstandeten Felder/);
});

test('ohne benannte Regel bleibt die Erwartung trotzdem ein Satz', () => {
  const fall = fallAus(verstoss({ befunde: [befund({ regel: undefined })] }), KOPF);

  assert.equal(fall.erwartet, 'Ein Wert, der die Regel erfüllt');
  assert.equal(fall.regel, undefined);
});
