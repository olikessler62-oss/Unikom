import assert from 'node:assert/strict';
import test from 'node:test';

import type { Konfliktfall } from './Konfliktfall.js';
import { vorentscheidungenAus } from './Rueckweg.js';

function fall(teile: Partial<Konfliktfall> = {}): Konfliktfall {
  return {
    id: 'f1',
    tenantId: 'default',
    laufId: 'TR-1',
    datensatz: '4711',
    art: 'WERTEKONFLIKT',
    kritikalitaet: 'KONFLIKT',
    status: 'BEREINIGT',
    ursache: 'zwei Werte',
    erwartet: 'einen',
    vorgefunden: 'zwei',
    naechsteSchritte: 'entscheiden',
    quellen: ['CRM.csv', 'ERP.csv'],
    felder: [],
    ergebnis: { ort: 'Hamburg' },
    entstanden: '2026-08-25T03:00:00.000Z',
    geaendert: '2026-08-26T09:15:00.000Z',
    fassung: 2,
    ...teile,
  };
}

/* ---------- Was mitkommt ---------- */

test('aus einem entschiedenen Fall wird eine Vorgabe', () => {
  const vorgaben = vorentscheidungenAus([fall()]);

  assert.equal(vorgaben.length, 1);
  assert.equal(vorgaben[0].datensatz, '4711');
  assert.deepEqual(vorgaben[0].werte, { ort: 'Hamburg' });
});

test('der Datensatz ist der Schlüssel und nicht die Fallnummer', () => {
  /*
   * Gepaart wird im Korrekturlauf über den Konsolidierungsschlüssel. Die
   * Fallnummer kennt die Konsolidierung nicht — sie fände nichts wieder.
   */
  assert.equal(vorentscheidungenAus([fall({ id: 'abc', datensatz: '4711' })])[0].datensatz, '4711');
});

test('die Herkunft nennt Fall und Tag', () => {
  const herkunft = vorentscheidungenAus([fall({ id: '3f2a' })])[0].herkunft;

  assert.match(herkunft, /Konfliktfall 3f2a/);
  assert.match(herkunft, /entschieden am 2026-08-26/);
});

/* ---------- Was nicht mitkommt ---------- */

test('ein Fall ohne Ergebnis fällt fort', () => {
  /*
   * Ihn mit leeren Werten weiterzureichen hieße, jedes seiner Felder auf „leer"
   * zu setzen und das als Entscheidung auszugeben.
   */
  assert.deepEqual(vorentscheidungenAus([fall({ ergebnis: undefined })]), []);
});

test('ein leeres Ergebnis ist keine Entscheidung', () => {
  assert.deepEqual(vorentscheidungenAus([fall({ ergebnis: {} })]), []);
});

test('die übrigen kommen trotzdem mit', () => {
  // Ein Fall ohne Ergebnis hält die anderen nicht auf.
  const vorgaben = vorentscheidungenAus([fall({ ergebnis: undefined }), fall({ id: 'f2', datensatz: '4712' })]);

  assert.deepEqual(
    vorgaben.map((vorgabe) => vorgabe.datensatz),
    ['4712']
  );
});

test('ohne Fälle gibt es nichts vorzugeben', () => {
  assert.deepEqual(vorentscheidungenAus([]), []);
});
