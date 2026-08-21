import assert from 'node:assert/strict';
import test from 'node:test';

import { recogniseField } from '../../domain/consolidation/Recognition.js';
import { columnValues, readCsv } from '../../infrastructure/formats/Csv.js';
import { alsBytes, FAELLE, type Fall } from './Faelle.js';

function lies(fall: Fall) {
  const table = readCsv(alsBytes(fall.inhalt, fall.encoding), { region: fall.region });
  const felder = table.fields.map((name, index) =>
    recogniseField(name, columnValues(table, index), { region: fall.region })
  );

  return { table, felder };
}

for (const fall of FAELLE) {
  test(`${fall.name} — ${fall.zweck}`, () => {
    const { table, felder } = lies(fall);
    const erwartet = fall.erwartet;

    if (erwartet.encoding) {
      assert.equal(table.encoding, erwartet.encoding, 'Zeichensatz');
    }

    if (erwartet.delimiter) {
      assert.equal(table.delimiter, erwartet.delimiter, 'Trennzeichen');
    }

    if (erwartet.delimiterCertain !== undefined) {
      assert.equal(table.delimiterCertain, erwartet.delimiterCertain, `Trennzeichen sicher — ${table.notes.join(' / ')}`);
    }

    if (erwartet.header !== undefined) {
      assert.equal(table.header, erwartet.header, `Kopfzeile — ${table.notes.join(' / ')}`);
    }

    if (erwartet.fields) {
      assert.deepEqual(table.fields, erwartet.fields, 'Feldnamen');
    }

    if (erwartet.zeilen !== undefined) {
      assert.equal(table.rows.length, erwartet.zeilen, 'Datenzeilen');
    }

    if (erwartet.ragged) {
      assert.deepEqual(table.ragged, erwartet.ragged, 'Zeilen mit abweichender Spaltenzahl');
    }

    for (const [name, typ] of Object.entries(erwartet.typen ?? {})) {
      const feld = felder.find((eintrag) => eintrag.name === name);

      assert.ok(feld, `Feld „${name}" fehlt; gefunden: ${felder.map((eintrag) => eintrag.name).join(', ')}`);
      assert.equal(feld.type, typ, `Typ von „${name}" (Konfidenz ${feld.confidence.toFixed(2)}, ${feld.note ?? ''})`);
      assert.equal(feld.certain, true, `„${name}" sollte sicher erkannt sein`);
    }

    for (const name of erwartet.unsicher ?? []) {
      const feld = felder.find((eintrag) => eintrag.name === name);

      assert.ok(feld, `Feld „${name}" fehlt`);
      assert.equal(feld.certain, false, `„${name}" muss als Prüffall gelten, nicht stillschweigend durchgehen`);
      assert.ok(feld.note, 'ein Prüffall ohne Begründung ist keiner');
    }

    for (const name of erwartet.mitHinweis ?? []) {
      const feld = felder.find((eintrag) => eintrag.name === name);

      assert.ok(feld?.note, `„${name}" braucht einen Hinweis für den Menschen`);
    }
  });
}

test('jeder Fall sagt, ob UniCom ihn allein lösen muss', () => {
  // Ein Katalog, in dem alles lösbar ist, prüft nur die schönen Tage.
  const nichtLoesbar = FAELLE.filter((fall) => !fall.loesbar);

  assert.ok(nichtLoesbar.length >= 4, 'zu wenige Fälle, in denen UniCom nachfragen muss');

  for (const fall of nichtLoesbar) {
    const erwartet = fall.erwartet;
    const meldetEtwas =
      (erwartet.unsicher?.length ?? 0) > 0 ||
      (erwartet.ragged?.length ?? 0) > 0 ||
      erwartet.delimiterCertain === false ||
      erwartet.header !== undefined;

    assert.ok(meldetEtwas, `„${fall.name}" ist als nicht lösbar geführt, erwartet aber keine Meldung`);
  }
});

test('kein Fall trägt denselben Namen zweimal', () => {
  assert.equal(new Set(FAELLE.map((fall) => fall.name)).size, FAELLE.length);
});
