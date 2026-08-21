import assert from 'node:assert/strict';
import test from 'node:test';

import { pruefeGegenSchema } from './JsonSchema.js';

const KUNDE = {
  type: 'object',
  required: ['kdnr', 'name'],
  properties: {
    kdnr: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 40 },
    plz: { type: 'string', pattern: '^[0-9]{5}$' },
    aktiv: { type: 'boolean' },
  },
};

test('was passt, gilt als gültig', () => {
  const urteil = pruefeGegenSchema({ kdnr: 4711, name: 'Meier', plz: '53111', aktiv: true }, KUNDE);

  assert.deepEqual(urteil.verstoesse, []);
  assert.equal(urteil.gueltig, true);
});

test('ein fehlendes Pflichtfeld wird beim Namen genannt', () => {
  const urteil = pruefeGegenSchema({ kdnr: 4711 }, KUNDE);

  assert.equal(urteil.gueltig, false);
  assert.deepEqual(urteil.verstoesse, [{ pfad: 'name', hinweis: 'Dieses Feld fehlt und ist Pflicht' }]);
});

test('alle Verstöße kommen zurück, nicht der erste', () => {
  /*
   * Wer eine Datei mit dreißig Fehlern bekommt, will sie einmal überarbeiten
   * und nicht dreißigmal hochladen.
   */
  const urteil = pruefeGegenSchema({ kdnr: 0, name: '', plz: 'Bonn' }, KUNDE);

  assert.equal(urteil.verstoesse.length, 3);
  assert.deepEqual(
    urteil.verstoesse.map((verstoss) => verstoss.pfad),
    ['kdnr', 'name', 'plz']
  );
});

test('eine Kommazahl ist keine ganze Zahl', () => {
  // 5.0 zählt, 5.5 nicht — sonst ginge eine Kundennummer mit Nachkommastelle
  // durch, und die Gegenseite rundet sie irgendwohin.
  assert.equal(pruefeGegenSchema({ kdnr: 5, name: 'A' }, KUNDE).gueltig, true);
  assert.equal(pruefeGegenSchema({ kdnr: 5.5, name: 'A' }, KUNDE).gueltig, false);
});

test('bei falschem Typ folgt kein Folgefehler', () => {
  // „name muss Text sein" und „name ist zu kurz" über denselben Wert wären
  // zwei Meldungen über einen Mangel.
  const urteil = pruefeGegenSchema({ kdnr: 1, name: 42 }, KUNDE);

  assert.equal(urteil.verstoesse.length, 1);
  assert.match(urteil.verstoesse[0].hinweis, /Erwartet wird string/);
});

test('null ist ein Typ und keine Abwesenheit', () => {
  /*
   * Wer das übergeht, meldet für jedes leere Feld einen Typfehler — und in
   * echten Exporten ist die Hälfte der Felder leer.
   */
  assert.equal(pruefeGegenSchema(null, { type: ['string', 'null'] }).gueltig, true);
  assert.equal(pruefeGegenSchema(null, { type: 'string', nullable: true }).gueltig, true);
  assert.equal(pruefeGegenSchema(null, { type: 'string' }).gueltig, false);
});

test('verschachtelte Listen tragen ihren Pfad', () => {
  const schema = {
    type: 'object',
    properties: { kunden: { type: 'array', items: KUNDE } },
  };

  const urteil = pruefeGegenSchema({ kunden: [{ kdnr: 1, name: 'A' }, { kdnr: 2 }] }, schema);

  assert.equal(urteil.verstoesse.length, 1);
  assert.equal(urteil.verstoesse[0].pfad, 'kunden[1].name');
});

test('zusätzliche Felder sind erlaubt, solange das Schema nichts anderes sagt', () => {
  // Eine Prüfung, die strenger ist als das Schema, meldet Fehler, die keine sind.
  assert.equal(pruefeGegenSchema({ kdnr: 1, name: 'A', extra: 'x' }, KUNDE).gueltig, true);
  assert.equal(
    pruefeGegenSchema({ kdnr: 1, name: 'A', extra: 'x' }, { ...KUNDE, additionalProperties: false }).gueltig,
    false
  );
});

/* ---------- Was nicht geprüft wurde ---------- */

test('unbekannte Schlüsselwörter werden gemeldet und nicht übergangen', () => {
  /*
   * Der wichtigste Test hier. Ein halbes JSON Schema, das sich für vollständig
   * ausgibt, sagt „gültig" zu einer Datei, deren Schema es nicht verstanden
   * hat. Wer `$ref` benutzt, soll erfahren, dass davon nichts geprüft wurde.
   */
  const urteil = pruefeGegenSchema({ kdnr: 1 }, { type: 'object', $ref: '#/definitions/kunde' });

  assert.equal(urteil.gueltig, true, 'was geprüft werden konnte, war in Ordnung');
  assert.deepEqual(urteil.ungeprueft, ['(Wurzel) → $ref']);
});

test('ein unbekanntes Schlüsselwort in der Tiefe nennt seine Stelle', () => {
  const urteil = pruefeGegenSchema(
    { kunde: { kdnr: 1 } },
    { type: 'object', properties: { kunde: { type: 'object', allOf: [] } } }
  );

  assert.deepEqual(urteil.ungeprueft, ['kunde → allOf']);
});

test('dasselbe unbekannte Schlüsselwort wird nicht zweimal gemeldet', () => {
  const urteil = pruefeGegenSchema(
    { liste: [{ a: 1 }, { a: 2 }] },
    { type: 'object', properties: { liste: { type: 'array', items: { type: 'object', $ref: 'x' } } } }
  );

  assert.equal(urteil.ungeprueft.length, 1);
});

/* ---------- Mängel des Schemas selbst ---------- */

test('ein Schema, das kein Objekt ist, wird abgelehnt', () => {
  assert.equal(pruefeGegenSchema({}, 'kunde.json').gueltig, false);
  assert.equal(pruefeGegenSchema({}, null).gueltig, false);
});

test('ein unlesbares Muster ist ein Mangel des Schemas, kein Befund über die Daten', () => {
  // Es als Verstoß der Datei zu buchen schöbe die Schuld auf die Datei.
  const urteil = pruefeGegenSchema('x', { type: 'string', pattern: '([' });

  assert.equal(urteil.gueltig, false);
  assert.match(urteil.verstoesse[0].hinweis, /Das Schema nennt ein Muster/);
});

test('ein unbekannter Typ gilt nicht als verletzt', () => {
  assert.equal(pruefeGegenSchema('x', { type: 'date-time' }).gueltig, true);
});
