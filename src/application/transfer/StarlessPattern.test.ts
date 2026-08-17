import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInMemoryApplication } from '../runtime/UnikomApplication.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferEvent } from './TransferEvents.js';

/**
 * Der Übergang von „Namensanfang" zu „voller Name".
 *
 * Ein Muster ohne Stern meinte früher den Anfang des Namens und meint jetzt den
 * ganzen. Das ist die klarere Regel, aber sie kostet etwas: Jeder Workflow, der
 * von früher stammt, findet ab sofort nichts mehr — und zwar geräuschlos, denn
 * ein Lauf ohne passende Datei ist kein Fehler.
 *
 * Wer keinen Zugang zum System des Kunden hat, hätte hier nichts in der Hand.
 * Darum die Warnung, und darum dieser Test.
 */

async function lauf(pattern: string | undefined, dateien: string[]): Promise<TransferEvent[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-muster-'));
  const quelle = path.join(root, 'quelle');
  await fs.mkdir(quelle, { recursive: true });

  for (const name of dateien) {
    await fs.writeFile(path.join(quelle, name), 'kunde;betrag\nA;1\n');
  }

  const events: TransferEvent[] = [];
  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    events: (event) => events.push(event),
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'muster',
      sourceDirectory: quelle,
      sourceConfig: { type: 'LOCAL', directory: quelle },
      destinationDirectory: path.join(root, 'ziel'),
      filenamePrefix: pattern,
      minimumFileAgeSeconds: 0,
      stabilityCheck: {
        enabled: false,
        intervalSeconds: 0,
        requiredStableChecks: 0,
        compareSize: false,
        compareLastModified: false,
      },
    })
  );

  await application.runtime.orchestrator.runJobNow('muster', new Date());
  application.close();
  await fs.rm(root, { recursive: true, force: true });

  return events;
}

function hinweis(events: TransferEvent[]): TransferEvent | undefined {
  return events.find((event) => event.name === 'RUN_PATTERN_HINT');
}

test('ein Muster ohne Stern, das nichts findet, obwohl Dateien dalagen, wird gemeldet', async () => {
  // Genau der Workflow von früher: „ORDER_" fand den Anfang, jetzt nicht mehr.
  const events = await lauf('ORDER_', ['ORDER_001.csv', 'ORDER_002.csv']);
  const gemeldet = hinweis(events);

  assert.ok(gemeldet, 'ohne diese Warnung sieht der Lauf wie ein ruhiger Tag aus');
  assert.match(gemeldet.message, /2 Dateien lagen bereit/);
  assert.match(gemeldet.message, /„ORDER_\*“/);
});

test('mit Stern gibt es keine Warnung, denn dann stimmt das Muster', async () => {
  const events = await lauf('ORDER_*', ['ORDER_001.csv']);

  assert.equal(hinweis(events), undefined);
});

test('ein leeres Verzeichnis ist kein Anlass zur Sorge', async () => {
  // Nichts gefunden, weil nichts da war: Eine Warnung wäre hier Lärm, und Lärm
  // ist das, was ein Protokoll unlesbar macht.
  const events = await lauf('ORDER_', []);

  assert.equal(hinweis(events), undefined);
});

test('ohne Muster wird nicht gewarnt, denn dann schränkt der Name nichts ein', async () => {
  const events = await lauf(undefined, ['irgendwas.csv']);

  assert.equal(hinweis(events), undefined);
});
