import test from 'node:test';
import assert from 'node:assert/strict';

import { pathSegments } from './paths.js';

/**
 * Die Pfadleiste im Verzeichnisfenster.
 *
 * Drei Schreibweisen stehen im selben Fenster, und jede hat ihre eigene Wurzel.
 * Wird die falsch bestimmt, führt ein Klick auf das erste Glied ins Leere — und
 * das merkt man erst dort, wo es zählt: an einer Freigabe beim Kunden.
 */

test('ein Laufwerkspfad beginnt beim Laufwerk', () => {
  assert.deepEqual(pathSegments('C:\\Daten\\kunde-a\\eingang'), [
    { label: 'C:', path: 'C:\\' },
    { label: 'Daten', path: 'C:\\Daten' },
    { label: 'kunde-a', path: 'C:\\Daten\\kunde-a' },
    { label: 'eingang', path: 'C:\\Daten\\kunde-a\\eingang' },
  ]);
});

test('ein Netzwerkpfad beginnt bei Server und Freigabe zusammen', () => {
  // Eine Ebene über der Freigabe gibt es nichts anzusehen: Der Server allein
  // ist kein Verzeichnis, sondern ein Rechner.
  const wurzel = '\\\\SERVER01\\Austausch';

  assert.deepEqual(pathSegments(wurzel + '\\kunde-a\\eingang'), [
    { label: wurzel, path: wurzel },
    { label: 'kunde-a', path: wurzel + '\\kunde-a' },
    { label: 'eingang', path: wurzel + '\\kunde-a\\eingang' },
  ]);
});

test('ein Serverpfad beginnt bei der Wurzel', () => {
  assert.deepEqual(pathSegments('/kunde123/orders/incoming'), [
    { label: '/', path: '/' },
    { label: 'kunde123', path: '/kunde123' },
    { label: 'orders', path: '/kunde123/orders' },
    { label: 'incoming', path: '/kunde123/orders/incoming' },
  ]);
});

test('doppelte und gemischte Trennzeichen ergeben kein leeres Glied', () => {
  // So kommen Pfade wirklich an: getippt, eingefügt, aus zwei Quellen
  // zusammengesetzt. Ein leeres Glied wäre ein Knopf ohne Beschriftung.
  assert.deepEqual(
    pathSegments('C:\\Daten//kunde-a\\\\eingang').map((teil) => teil.label),
    ['C:', 'Daten', 'kunde-a', 'eingang']
  );
});

test('ein Laufwerk allein ist ein einziges Glied', () => {
  assert.deepEqual(pathSegments('D:'), [{ label: 'D:', path: 'D:\\' }]);
});

test('nichts eingegeben heißt keine Leiste', () => {
  assert.deepEqual(pathSegments('   '), []);
});
