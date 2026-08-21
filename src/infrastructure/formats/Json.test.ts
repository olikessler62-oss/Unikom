import assert from 'node:assert/strict';
import test from 'node:test';

import { texte } from './Bestand.js';
import { readJson } from './Json.js';

function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf-8'));
}

test('eine Liste von Objekten wird zur Tabelle', () => {
  const gelesen = readJson(
    bytes(
      JSON.stringify([
        { nummer: 4711, name: 'Mustermann', aktiv: true },
        { nummer: 4712, name: 'Berger', aktiv: false },
      ])
    )
  );

  assert.deepEqual(gelesen.fields, ['nummer', 'name', 'aktiv']);
  assert.deepEqual(texte(gelesen.rows[0]), ['4711', 'Mustermann', 'true']);
});

test('JSON kennt seine Typen, und die werden mitgenommen', () => {
  // Sie wegzuwerfen und anschließend aus dem Text zu erraten wäre Verschwendung
  // mit Fehlerrisiko: „42" und 42 sind in JSON verschiedene Dinge.
  const gelesen = readJson(
    bytes(JSON.stringify([{ zahl: 42, text: '42', wahr: true, nichts: null, leer: '' }]))
  );

  assert.deepEqual(
    gelesen.rows[0].map((zelle) => zelle.declared),
    ['NUMBER', 'STRING', 'BOOLEAN', 'EMPTY', 'EMPTY']
  );
});

test('verschachtelte Objekte werden mit Punkten flachgelegt', () => {
  const gelesen = readJson(
    bytes(JSON.stringify([{ kunde: { name: 'Müller', adresse: { ort: 'Köln', plz: '50667' } } }]))
  );

  assert.deepEqual(gelesen.fields, ['kunde.name', 'kunde.adresse.ort', 'kunde.adresse.plz']);
  assert.deepEqual(texte(gelesen.rows[0]), ['Müller', 'Köln', '50667']);
});

test('Listen bekommen einen Index, damit der Weg zurück lesbar bleibt', () => {
  const gelesen = readJson(
    bytes(JSON.stringify([{ nr: 1, positionen: [{ artikel: 'A' }, { artikel: 'B' }] }]))
  );

  assert.deepEqual(gelesen.fields, ['nr', 'positionen[0].artikel', 'positionen[1].artikel']);
});

test('eine leere Liste wird zum leeren Feld, nicht zu gar keinem', () => {
  // Sonst wäre der Unterschied zwischen „keine Positionen" und „nicht gefragt"
  // fort.
  const gelesen = readJson(bytes(JSON.stringify([{ nr: 1, positionen: [] }])));

  assert.deepEqual(gelesen.fields, ['nr', 'positionen']);
  assert.equal(gelesen.rows[0][1].declared, 'EMPTY');
});

test('die Liste unter einem Schlüssel wird gefunden und benannt', () => {
  const gelesen = readJson(
    bytes(JSON.stringify({ erzeugt: '2026-08-19', customers: [{ nr: 1 }, { nr: 2 }, { nr: 3 }] }))
  );

  assert.equal(gelesen.rows.length, 3);
  assert.match(gelesen.notes.join(' '), /stehen unter „customers"/);
});

test('ein ausdrücklicher Pfad gilt vor jeder Suche', () => {
  const inhalt = JSON.stringify({
    data: { items: [{ nr: 1 }] },
    andere: [{ nr: 9 }, { nr: 8 }, { nr: 7 }],
  });

  const gelesen = readJson(bytes(inhalt), { pfad: 'data.items' });

  assert.equal(gelesen.rows.length, 1);
  assert.deepEqual(texte(gelesen.rows[0]), ['1']);
});

test('ein Pfad, unter dem keine Liste steht, wird abgewiesen', () => {
  assert.throws(() => readJson(bytes(JSON.stringify({ a: 1 })), { pfad: 'a' }), /keine Liste von Datensätzen/);
});

test('bei gleich langen Listen entscheidet niemand still', () => {
  // Eine Wahl zwischen „Kunden" und „Lieferanten", die eine Maschine allein
  // trifft, fällt beim Kunden auf und nicht hier.
  const gelesen = readJson(
    bytes(JSON.stringify({ kunden: [{ a: 1 }, { a: 2 }], lieferanten: [{ b: 1 }, { b: 2 }] }))
  );

  assert.match(gelesen.notes.join(' '), /Mehrere Listen sind gleich lang/);
  assert.match(gelesen.notes.join(' '), /gehört ins Profil/);
});

test('ein einzelnes Objekt ist ein Datensatz und kein Fehler', () => {
  const gelesen = readJson(bytes(JSON.stringify({ nr: 1, ort: 'Köln' })));

  assert.equal(gelesen.rows.length, 1);
  assert.deepEqual(gelesen.fields, ['nr', 'ort']);
});

test('die Feldliste ist die Vereinigung aller Datensätze', () => {
  // Nur den ersten zu nehmen wäre kürzer und verlöre jedes Feld, das erst
  // weiter unten vorkommt — lautlos.
  const gelesen = readJson(bytes(JSON.stringify([{ a: 1 }, { a: 2, b: 3 }])));

  assert.deepEqual(gelesen.fields, ['a', 'b']);
  assert.equal(gelesen.rows[0][1].text, '');
  assert.deepEqual(gelesen.ragged, [1]);
  assert.match(gelesen.notes.join(' '), /nicht alle 2 Felder/);
});

test('eine sehr lange Liste wird begrenzt — und das steht dabei', () => {
  const gelesen = readJson(
    bytes(JSON.stringify([{ positionen: Array.from({ length: 80 }, (_, nummer) => ({ nr: nummer })) }])),
    { maxListe: 10 }
  );

  assert.equal(gelesen.fields.length, 10);
  assert.match(gelesen.notes.join(' '), /80 Einträge; aufgelöst wurden die ersten 10/);
});

test('kaputtes JSON wird mit dem Grund abgewiesen', () => {
  assert.throws(() => readJson(bytes('{ nicht: ')), /kein gültiges JSON/);
});
