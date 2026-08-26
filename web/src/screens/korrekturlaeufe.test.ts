import assert from 'node:assert/strict';
import test from 'node:test';

import type { Konfliktfall, Konfliktstatus } from '../api/types.js';
import { laeufeMitBereinigten } from './ConflictScreen.js';

function fall(laufId: string, status: Konfliktstatus): Konfliktfall {
  return { id: `${laufId}-${status}`, laufId, status } as unknown as Konfliktfall;
}

test('gezählt wird je Lauf, und nur was bereinigt ist', () => {
  /*
   * Der Korrekturlauf rechnet auf einer Lieferung. Ein offener Fall gehört
   * nicht dazu — und ein akzeptierter trägt keinen Wert, den man anwenden
   * könnte.
   */
  const laeufe = laeufeMitBereinigten([
    fall('TR-1', 'BEREINIGT'),
    fall('TR-1', 'OFFEN'),
    fall('TR-2', 'BEREINIGT'),
  ]);

  assert.deepEqual(laeufe, [
    { laufId: 'TR-1', faelle: 1 },
    { laufId: 'TR-2', faelle: 1 },
  ]);
});

test('mehrere bereinigte Fälle eines Laufs zählen zusammen', () => {
  const laeufe = laeufeMitBereinigten([
    { ...fall('TR-1', 'BEREINIGT'), id: 'a' },
    { ...fall('TR-1', 'BEREINIGT'), id: 'b' },
  ]);

  assert.deepEqual(laeufe, [{ laufId: 'TR-1', faelle: 2 }]);
});

test('ohne bereinigte Fälle gibt es nichts zu wählen', () => {
  assert.deepEqual(laeufeMitBereinigten([fall('TR-1', 'OFFEN')]), []);
});
