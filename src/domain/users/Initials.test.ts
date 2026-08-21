import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseInitials, initialsCandidates } from './Initials.js';

test('das Kürzel entsteht aus Vorname, Nachname und dessen letztem Buchstaben', () => {
  assert.equal(chooseInitials({ firstName: 'Anna', lastName: 'Berger' }, []), 'ABR');
  assert.equal(chooseInitials({ firstName: 'Oliver', lastName: 'Kessler' }, []), 'OKR');
});

test('bei einem vergebenen Kürzel wandert die dritte Stelle durch den Vornamen', () => {
  // Anna Berger hat ABR. Der zweite Name derselben Anfangsbuchstaben nimmt den
  // nächsten Buchstaben des Vornamens: A-N-N-E → ABN.
  const zweites = chooseInitials({ firstName: 'Anne', lastName: 'Bauer' }, ['ABR']);

  assert.equal(zweites, 'ABN');
  assert.equal(chooseInitials({ firstName: 'Anne', lastName: 'Bauer' }, ['ABR', 'ABN']), 'ABE');
});

test('ist der Vorname aufgebraucht, kommt der Nachname an die Reihe', () => {
  // Al Bond: Grundregel A-B-D, dann der Rest des Vornamens (L), erst danach
  // der des Nachnamens (O, N — das D am Ende steht schon in der Grundregel).
  assert.deepEqual(initialsCandidates('Al', 'Bond').slice(0, 4), ['ABD', 'ABL', 'ABO', 'ABN']);
  assert.equal(chooseInitials({ firstName: 'Al', lastName: 'Bond' }, ['ABD', 'ABL']), 'ABO');
});

test('sind alle Buchstaben des Namens vergeben, kommen Ziffern', () => {
  const buchstaben = ['ABD', 'ABL', 'ABO', 'ABN'];

  assert.equal(chooseInitials({ firstName: 'Al', lastName: 'Bond' }, buchstaben), 'AB2');
});

test('Umlaute fallen auf ihren Grundbuchstaben', () => {
  assert.equal(chooseInitials({ firstName: 'Öznur', lastName: 'Müller' }, []), 'OMR');
  assert.equal(chooseInitials({ firstName: 'Élodie', lastName: 'Straß' }, []), 'ESS');
});

test('Bindestriche und Leerzeichen zählen nicht als Buchstaben', () => {
  assert.equal(chooseInitials({ firstName: 'Hans-Peter', lastName: 'von Ahlen' }, []), 'HVN');
});

test('ein passendes Kürzel bleibt bei einer Namensberichtigung stehen', () => {
  // Anna Berger heißt in Wahrheit Anne Berger. ABR passt weiter — und ein
  // Kürzel, das ohne Not wechselt, ist als Wiedererkennung wertlos.
  assert.equal(chooseInitials({ firstName: 'Anne', lastName: 'Berger' }, [], 'ABR'), 'ABR');
});

test('ein Kürzel, das nicht mehr zum Namen passt, wird neu gebildet', () => {
  assert.equal(chooseInitials({ firstName: 'Peter', lastName: 'Berger' }, [], 'ABR'), 'PBR');
});

test('ein Kürzel, das inzwischen einem anderen gehört, wird nicht behalten', () => {
  assert.equal(chooseInitials({ firstName: 'Anne', lastName: 'Berger' }, ['ABR'], 'ABR'), 'ABN');
});

test('sind alle Kürzel dieser Anfangsbuchstaben vergeben, sagt der Fehler das auch', () => {
  const alle = initialsCandidates('Ab', 'Cd');

  assert.throws(() => chooseInitials({ firstName: 'Ab', lastName: 'Cd' }, alle), /kein dreistelliges Kürzel mehr frei/);
});

test('ein Name ohne Buchstaben ergibt kein Kürzel', () => {
  assert.throws(() => chooseInitials({ firstName: '1', lastName: '2' }, []), /keinen einzigen Buchstaben/);
});

test('jedes Kürzel hat drei Stellen, auch bei sehr kurzen Namen', () => {
  for (const kurz of [
    { firstName: 'A', lastName: 'B' },
    { firstName: 'Jo', lastName: 'Ex' },
  ]) {
    assert.equal(chooseInitials(kurz, []).length, 3, `${kurz.firstName} ${kurz.lastName}`);
  }
});
