import test from 'node:test';
import assert from 'node:assert/strict';

import { findNode, mapNode, toNodes, type TreeNode } from './tree.js';

/**
 * Der Baum wird umgebaut, nicht angefasst.
 *
 * Geprüft wird deshalb weniger, dass die Änderung ankommt, als dass sie *nur*
 * dort ankommt: Ein Knoten, der beim Aufklappen eines Nachbarn seinen Zustand
 * verliert, klappt vor den Augen des Benutzers wieder zu — und das sieht nach
 * einer langsamen Leitung aus, nicht nach einem Fehler im Baum.
 */

function baum(): TreeNode[] {
  return [
    {
      name: 'kunde-a',
      path: '/kunde-a',
      relativePath: 'kunde-a',
      open: true,
      busy: false,
      children: [
        { name: '2026', path: '/kunde-a/2026', relativePath: 'kunde-a/2026', open: false, busy: false },
        { name: '2025', path: '/kunde-a/2025', relativePath: 'kunde-a/2025', open: false, busy: false },
      ],
    },
    { name: 'kunde-b', path: '/kunde-b', relativePath: 'kunde-b', open: false, busy: false },
  ];
}

test('aus einer Auflistung werden zugeklappte Knoten', () => {
  const knoten = toNodes([{ name: 'eingang', path: '/kunde/eingang', relativePath: 'eingang' }]);

  assert.equal(knoten.length, 1);
  assert.equal(knoten[0].open, false);
  assert.equal(knoten[0].busy, false);
  // Noch nicht geholt ist etwas anderes als geholt und leer.
  assert.equal(knoten[0].children, undefined);
});

test('geändert wird der genannte Knoten, und zwar auch in der Tiefe', () => {
  const geändert = mapNode(baum(), '/kunde-a/2026', (node) => ({ ...node, open: true, children: [] }));

  assert.equal(geändert[0].children?.[0].open, true);
  assert.deepEqual(geändert[0].children?.[0].children, []);
});

test('die übrigen Knoten behalten ihren Zustand', () => {
  const vorher = baum();
  const geändert = mapNode(vorher, '/kunde-a/2026', (node) => ({ ...node, open: true }));

  assert.equal(geändert[0].open, true, 'der Elternknoten bleibt offen');
  assert.equal(geändert[0].children?.[1].open, false, 'das Geschwister bleibt zu');
  assert.equal(geändert[1].open, false);
  // Der Nachbarzweig wird nicht einmal neu gebaut — er ist dasselbe Objekt.
  assert.equal(geändert[1], vorher[1]);
});

test('ein Pfad, den es nicht gibt, ändert nichts', () => {
  const vorher = baum();
  const geändert = mapNode(vorher, '/gibt-es-nicht', (node) => ({ ...node, open: true }));

  assert.deepEqual(geändert, vorher);
});

test('gesucht wird auch in der Tiefe', () => {
  assert.equal(findNode(baum(), '/kunde-a/2025')?.name, '2025');
  assert.equal(findNode(baum(), '/kunde-b')?.name, 'kunde-b');
  assert.equal(findNode(baum(), '/woanders'), undefined);
});
