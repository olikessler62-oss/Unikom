import assert from 'node:assert/strict';
import test from 'node:test';

import { findeBezeichnungen, normalisiere } from './Bezeichnungen.js';
import { ordneAlleZu, ordneZu } from './Feldzuordnung.js';

test('dieselbe Bezeichnung in vier Schreibweisen findet dasselbe Feld', () => {
  // Das Beispiel aus SPEC-02, Abschnitt 15, und SPEC-09, Abschnitt 4.
  for (const name of ['Kundennummer', 'Kunden-Nr.', 'CustomerID', 'Customer_Number']) {
    const vorschlag = ordneZu({ name, typ: 'INTEGER' });

    assert.equal(vorschlag.intern, 'customerId', name);
    assert.equal(vorschlag.sicherheit, 'EINDEUTIG', name);
  }
});

test('Groß- und Kleinschreibung, Trennzeichen und Umlaute sind kein Unterschied', () => {
  // Dieselbe Spalte heißt in zwei Exporten „Straße" und „Strasse" — das ist
  // keine Absicht, sondern das Ergebnis zweier Systeme.
  assert.equal(normalisiere('Kunden-Nr.'), 'kundennr');
  assert.equal(normalisiere('KUNDEN NR'), 'kundennr');
  assert.equal(normalisiere('Straße'), 'strasse');
  assert.equal(ordneZu({ name: 'STRASSE', typ: 'STRING' }).intern, 'street');
});

test('DOB und Geburtsdatum sind dasselbe Feld', () => {
  assert.equal(ordneZu({ name: 'DOB', typ: 'DATE' }).intern, 'birthDate');
  assert.equal(ordneZu({ name: 'Date of Birth', typ: 'DATE' }).intern, 'birthDate');
});

test('der Name allein entscheidet nicht — der Typ muss passen', () => {
  // Eine Spalte „Geburtsdatum" voller Namen ist ein falsch beschrifteter
  // Export und kein Geburtsdatum. SPEC-09, Abschnitt 4.
  const vorschlag = ordneZu({ name: 'Geburtsdatum', typ: 'STRING' });

  assert.equal(vorschlag.intern, undefined);
  assert.equal(vorschlag.sicherheit, 'MEHRDEUTIG');
  assert.match(vorschlag.gruende.join(' '), /erwartet wird DATE/);
});

test('ein mehrdeutiger Name wird nicht eigenmächtig zugeordnet', () => {
  // „Nummer" könnte alles sein. SPEC-09, Abschnitt 3: Mehrdeutige Zuordnungen
  // dürfen nicht eigenmächtig vorgenommen werden.
  const vorschlag = ordneZu({ name: 'Bezeichnung', typ: 'STRING' });

  assert.equal(vorschlag.sicherheit, 'EINDEUTIG', 'Bezeichnung ist eindeutig der Artikelname');

  const unbekannt = ordneZu({ name: 'Feld 3', typ: 'STRING' });

  assert.equal(unbekannt.sicherheit, 'MEHRDEUTIG');
  assert.match(unbekannt.gruende.join(' '), /steht in keiner Bezeichnungsliste/);
});

test('was mehrere interne Felder beansprucht, bleibt beim Menschen', () => {
  const vorschlag = ordneZu(
    { name: 'Kennung', typ: 'STRING' },
    {
      liste: [
        { intern: 'a', label: 'Feld A', namen: ['Kennung'] },
        { intern: 'b', label: 'Feld B', namen: ['Kennung'] },
      ],
    }
  );

  assert.equal(vorschlag.sicherheit, 'MEHRDEUTIG');
  assert.deepEqual(
    vorschlag.kandidaten?.map((kandidat) => kandidat.intern),
    ['a', 'b']
  );
});

test('Werte, die dem Namen widersprechen, stufen die Zuordnung zurück', () => {
  const passt = ordneZu({ name: 'E-Mail', typ: 'STRING', werte: ['anna@example.org', 'b@c.de'] });
  const passtNicht = ordneZu({ name: 'E-Mail', typ: 'STRING', werte: ['Anna Berger', 'Bernd Meier'] });

  assert.equal(passt.sicherheit, 'EINDEUTIG');
  assert.equal(passtNicht.sicherheit, 'MEHRDEUTIG');
  assert.match(passtNicht.gruende.join(' '), /Werte passen \*\*nicht\*\*/);
});

test('eine leere Spalte wird zum Vorschlag, nicht zur Gewissheit', () => {
  // Der Typ kann nichts stützen, wenn nichts drinsteht.
  const vorschlag = ordneZu({ name: 'Kundennummer', typ: 'NULL' });

  assert.equal(vorschlag.sicherheit, 'VORSCHLAG');
  assert.match(vorschlag.gruende.join(' '), /weder stützen noch widerlegen/);
});

test('jede Zuordnung nennt ihren Grund', () => {
  // Ein Vorschlag ohne Begründung ist eine Behauptung, und die kann niemand
  // prüfen.
  for (const name of ['Kundennummer', 'Geburtsdatum', 'Feld 3']) {
    assert.ok(ordneZu({ name, typ: 'STRING' }).gruende.length > 0, name);
  }
});

test('eine bestätigte Zuordnung schlägt jede Erkennung', () => {
  // Der Grund, warum derselbe Lieferant beim zweiten Mal nicht wieder gefragt
  // wird.
  const vorschlag = ordneZu(
    { name: 'Spalte 7', typ: 'STRING' },
    { bekannt: new Map([['Spalte 7', 'customerId']]) }
  );

  assert.equal(vorschlag.intern, 'customerId');
  assert.equal(vorschlag.sicherheit, 'EINDEUTIG');
  assert.match(vorschlag.gruende.join(' '), /bereits bestätigt/);
});

test('zwei Spalten dürfen nicht auf dasselbe Feld zeigen', () => {
  // Sonst entschiede die Reihenfolge, nicht die Bedeutung.
  const vorschlaege = ordneAlleZu([
    { name: 'Kundennummer', typ: 'INTEGER' },
    { name: 'Kunden-Nr', typ: 'INTEGER' },
  ]);

  assert.deepEqual(
    vorschlaege.map((vorschlag) => vorschlag.sicherheit),
    ['MEHRDEUTIG', 'MEHRDEUTIG']
  );
  assert.match(vorschlaege[0].gruende.join(' '), /entschiede die Reihenfolge/);
});

test('verschiedene Spalten auf verschiedene Felder bleiben eindeutig', () => {
  const vorschlaege = ordneAlleZu([
    { name: 'Kundennummer', typ: 'INTEGER' },
    { name: 'Ort', typ: 'STRING' },
    { name: 'Betrag', typ: 'DECIMAL' },
  ]);

  assert.deepEqual(
    vorschlaege.map((vorschlag) => vorschlag.intern),
    ['customerId', 'city', 'totalAmount']
  );
});

test('die ausgelieferte Liste hat keine Bezeichnung doppelt', () => {
  // Ein Name, der zwei internen Feldern gehört, ist entweder ein Fehler in der
  // Liste oder eine echte Mehrdeutigkeit — und die gehört ausgewiesen, nicht
  // eingeschmuggelt.
  const doppelt = ['Kundennummer', 'Artikelnummer', 'PLZ', 'DOB', 'IBAN'].filter(
    (name) => findeBezeichnungen(name).length > 1
  );

  assert.deepEqual(doppelt, []);
});
