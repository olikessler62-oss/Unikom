import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { StaticFeatureSet } from '../../domain/licensing/Feature.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import {
  activeStages,
  followingStage,
  numberedStages,
  precedingStage,
  type StageConfig,
} from '../../domain/transfer/WorkflowStages.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { requiredFeaturesFor } from '../licensing/JobLicensing.js';
import { TransferExecutionService } from './TransferExecutionService.js';
import { TransferJobService } from './TransferJobService.js';

/**
 * A workflow is built from links that are bought separately and combined
 * freely. Written around what that makes possible and what it makes breakable:
 * a link that inherits from nothing, a link that hands on to nothing, and a
 * module that gets used without being paid for.
 */

/** Reads from the link before it, writes into a directory of its own. */
const CHAINED: StageConfig = {
  enabled: true,
  input: { from: 'PRECEDING' },
  output: { to: 'DIRECTORY', directory: '/out' },
};

/** The same link as the whole workflow: it has to name both ends itself. */
const STANDALONE: StageConfig = {
  enabled: true,
  input: { from: 'DIRECTORY', directory: '/verzeichnis-x' },
  output: { to: 'DIRECTORY', directory: '/verzeichnis-x-fertig' },
};

const OFF = { enabled: false } as const;

test('consolidating a directory is a whole workflow on its own', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const saved = await service.create(
    createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE } })
  );

  assert.deepEqual(activeStages(saved), ['CONSOLIDATE']);
  // Only what it uses is charged for — no transfer, no conversion, no import.
  assert.deepEqual(requiredFeaturesFor(saved), ['CONSOLIDATION']);
  assert.ok(!requiredFeaturesFor(saved).includes('TRANSFER'), 'nobody pays for a transfer they never run');
});

test('converting and importing are separate modules that each stand alone', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const converting = await service.create(
    createTransferJob({ transfer: OFF, conversion: { ...STANDALONE } })
  );
  const importing = await service.create(
    createTransferJob({
      transfer: OFF,
      // An import writes into tables, so it names no destination directory.
      dataImport: { enabled: true, input: { from: 'DIRECTORY', directory: '/verzeichnis-x' } },
    })
  );

  assert.deepEqual(requiredFeaturesFor(converting), ['CONVERSION']);
  assert.deepEqual(requiredFeaturesFor(importing), ['DATA_IMPORT']);

  // Buying one must not hand over the other.
  assert.ok(!requiredFeaturesFor(converting).includes('DATA_IMPORT'));
  assert.ok(!requiredFeaturesFor(importing).includes('CONVERSION'));
});

test('transfer and conversion without consolidation chain directly', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const saved = await service.create(createTransferJob({ conversion: { ...CHAINED } }));

  assert.deepEqual(activeStages(saved), ['TRANSFER', 'CONVERT']);
  assert.deepEqual(requiredFeaturesFor(saved), ['TRANSFER', 'CONVERSION'], 'two links, two modules');
  assert.equal(precedingStage('CONVERT', saved), 'TRANSFER', 'it reads what the transfer put down');
  assert.equal(followingStage('CONVERT', saved), undefined, 'nothing follows the last link');
});

/**
 * The numbers mark the sequence of *this* workflow, not the identity of the
 * modules. Two customers with different modules therefore see different numbers
 * on the same link, which is the point: the number answers "when does this run",
 * and the name answers "what is this".
 */
test('the numbers count the links this workflow actually uses', () => {
  const full = createTransferJob({
    consolidation: { ...CHAINED },
    dataImport: { enabled: true, input: { from: 'PRECEDING' } },
    conversion: { ...CHAINED },
  });

  assert.deepEqual(
    [...numberedStages(full)],
    [
      ['TRANSFER', 1],
      ['CONSOLIDATE', 2],
      ['IMPORT', 3],
      ['CONVERT', 4],
    ]
  );

  // The same conversion link is number 2 for somebody who bought less.
  const two = createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE }, conversion: { ...CHAINED } });

  assert.deepEqual(
    [...numberedStages(two)],
    [
      ['CONSOLIDATE', 1],
      ['CONVERT', 2],
    ]
  );
});

test('a workflow of one link carries no number at all', () => {
  // A lone "1" would only suggest a missing "2".
  assert.equal(numberedStages(createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE } })).size, 0);
  assert.equal(numberedStages(createTransferJob({})).size, 0);
});

test('a workflow with nothing switched on is refused', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create(createTransferJob({ transfer: OFF })),
    /kein einziger Schritt eingeschaltet/,
    'otherwise it would run every night and do nothing'
  );
});

test('a link cannot inherit a source when nothing precedes it', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create(createTransferJob({ transfer: OFF, consolidation: { ...CHAINED } })),
    /keinen Schritt davor/
  );
});

test('a link cannot hand on when nothing follows it', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({ consolidation: { ...CHAINED, output: { to: 'FOLLOWING' } } })
      ),
    /folgt aber kein Schritt/
  );

  // With a link behind it there is somewhere for the result to go.
  await service.create(
    createTransferJob({
      consolidation: { ...CHAINED, output: { to: 'FOLLOWING' } },
      conversion: { ...CHAINED },
    })
  );
});

test('a directory that was chosen but left empty is refused', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({ consolidation: { ...CHAINED, input: { from: 'DIRECTORY', directory: '  ' } } })
      ),
    /Quelle von „Daten konsolidieren“ braucht ein Verzeichnis/
  );

  await assert.rejects(
    () => service.create(createTransferJob({ conversion: { ...CHAINED, output: undefined } })),
    /Ziel von „Daten konvertieren“ braucht ein Verzeichnis/
  );
});

test('an import needs no directory, because it writes into tables', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await service.create(createTransferJob({ dataImport: { enabled: true, input: { from: 'PRECEDING' } } }));
});

test('a stored job that predates the switches still transfers', () => {
  // Such a job carries no flags at all and must keep doing what it did.
  assert.deepEqual(activeStages(createTransferJob({})), ['TRANSFER']);
  assert.equal(precedingStage('TRANSFER', createTransferJob({})), undefined);
});

test('a job needing a module the installation lacks is refused when it is saved', async () => {
  const service = new TransferJobService(
    new InMemoryTransferJobRepository(),
    new StaticFeatureSet(['TRANSFER', 'CONVERSION'])
  );

  await assert.rejects(
    () => service.create(createTransferJob({ consolidation: { ...CHAINED } })),
    /Daten konsolidieren/,
    'the message has to name the module, not just say no'
  );

  // The ones they do have go through.
  await service.create(createTransferJob({ conversion: { ...CHAINED } }));
});

test('a switched-off link costs nothing', () => {
  const job = createTransferJob({
    consolidation: { ...CHAINED, enabled: false },
    conversion: { ...CHAINED, enabled: false },
  });

  // The transfer is still on, and it is a module like the others now.
  assert.deepEqual(requiredFeaturesFor(job), ['TRANSFER']);
  assert.deepEqual(requiredFeaturesFor(createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE } })), [
    'CONSOLIDATION',
  ]);
});

/**
 * The wiring can be saved before the engines exist. What must not happen is
 * that such a job runs the transfer and quietly drops the rest: the files would
 * arrive unprocessed under the name of a workflow that promises processing, and
 * nothing in the result would say so.
 */
test('a workflow whose module is not built yet refuses to run instead of doing half of it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-stages-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'dest');

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'customer;amount\nMUELLER;42\n', 'utf8');

  const service = new TransferExecutionService({
    transferFileRepository: new InMemoryTransferFileRepository(),
    stagingRoot: path.join(root, 'application-data'),
  });

  const result = await service.execute(
    createTransferJob({
      sourceDirectory: source,
      destinationDirectory: destination,
      allowedExtensions: ['csv'],
      consolidation: { ...CHAINED },
    }),
    new LocalSourceAdapter(source)
  );

  assert.equal(result.status, TransferRunStatus.FAILED);
  assert.match(result.message, /noch nicht gebaut/);
  assert.match(result.message, /Daten konsolidieren/, 'the message names the link, not a number');
  assert.deepEqual(await fs.readdir(destination), [], 'nothing may have been delivered');
  assert.deepEqual(await fs.readdir(source), ['ORDER_001.csv'], 'and the source is untouched');
});

test('a workflow that only transfers still runs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-stages-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'dest');

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'customer;amount\nMUELLER;42\n', 'utf8');

  const service = new TransferExecutionService({
    transferFileRepository: new InMemoryTransferFileRepository(),
    stagingRoot: path.join(root, 'application-data'),
  });

  const result = await service.execute(
    createTransferJob({
      sourceDirectory: source,
      destinationDirectory: destination,
      allowedExtensions: ['csv'],
      // Present but off — the guard must look at `enabled`, not at presence.
      consolidation: { ...CHAINED, enabled: false },
    }),
    new LocalSourceAdapter(source)
  );

  assert.equal(result.filesSucceeded, 1, result.message);
  assert.deepEqual(await fs.readdir(destination), ['ORDER_001.csv']);
});
