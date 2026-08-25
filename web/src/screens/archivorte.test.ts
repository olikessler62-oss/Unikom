import assert from 'node:assert/strict';
import test from 'node:test';

import type { Job } from '../api/types.js';
import { archivorte } from './ArchivScreen.js';

function job(teile: Partial<Job> = {}): Job {
  return {
    id: 'job1',
    tenantId: 'default',
    name: 'Nachtlauf',
    enabled: true,
    executionMode: 'MANUAL',
  } as Job;
}

function mitArchiv(teile: { id?: string; name?: string; tenantId?: string; archiv?: string; weitere?: unknown[] }): Job {
  return {
    ...job(),
    id: teile.id ?? 'job1',
    name: teile.name ?? 'Nachtlauf',
    tenantId: teile.tenantId ?? 'default',
    consolidation: {
      enabled: true,
      dateien: teile.archiv ? { abholung: { archiv: teile.archiv } } : undefined,
      weitere: teile.weitere,
    },
  } as Job;
}

test('das Archivverzeichnis kommt vom Workflow', () => {
  /*
   * Wer es hier eintippen müsste, tippt es eines Tages falsch und sieht dann
   * in ein leeres Verzeichnis — ohne zu merken, dass er am falschen Ort sucht.
   */
  const orte = archivorte([mitArchiv({ archiv: '/archiv/nord' })], 'default');

  assert.deepEqual(orte, [{ verzeichnis: '/archiv/nord', workflow: 'Nachtlauf', durchgang: undefined }]);
});

test('ein Workflow ohne Archiv taucht nicht auf', () => {
  assert.deepEqual(archivorte([mitArchiv({})], 'default'), []);
});

test('ein fremder Mandant taucht nicht auf', () => {
  // Die Trennung der Mandanten ist der Grund, warum es sie überhaupt gibt.
  const orte = archivorte([mitArchiv({ tenantId: 'kunde-b', archiv: '/archiv/fremd' })], 'default');

  assert.deepEqual(orte, []);
});

test('auch die weiteren Durchgänge werden abgesucht', () => {
  const orte = archivorte(
    [
      mitArchiv({
        archiv: '/archiv/erster',
        weitere: [{ enabled: true, name: 'Zweiter Durchgang', dateien: { abholung: { archiv: '/archiv/zweiter' } } }],
      }),
    ],
    'default'
  );

  assert.deepEqual(
    orte.map((ort) => ort.verzeichnis),
    ['/archiv/erster', '/archiv/zweiter']
  );
  assert.equal(orte[1].durchgang, 'Zweiter Durchgang');
});

test('dasselbe Verzeichnis steht einmal da, nicht zweimal', () => {
  /*
   * Zwei Durchgänge dürfen dasselbe Archiv benutzen. Zweimal in der Auswahl
   * wären zwei Zeilen mit demselben Inhalt — und der Benutzer sucht den
   * Unterschied, den es nicht gibt.
   */
  const orte = archivorte(
    [
      mitArchiv({ id: 'a', name: 'Nord', archiv: '/archiv/gemeinsam' }),
      mitArchiv({ id: 'b', name: 'Süd', archiv: '/archiv/gemeinsam' }),
    ],
    'default'
  );

  assert.equal(orte.length, 1);
  assert.equal(orte[0].workflow, 'Nord', 'genannt wird der erste, der es benutzt');
});

test('die Auswahl steht alphabetisch', () => {
  // Bei zwanzig Verzeichnissen ist die Reihenfolge der einzige Weg hinein.
  const orte = archivorte(
    [
      mitArchiv({ id: 'a', archiv: '/archiv/west' }),
      mitArchiv({ id: 'b', archiv: '/archiv/nord' }),
      mitArchiv({ id: 'c', archiv: '/archiv/ost' }),
    ],
    'default'
  );

  assert.deepEqual(
    orte.map((ort) => ort.verzeichnis),
    ['/archiv/nord', '/archiv/ost', '/archiv/west']
  );
});
