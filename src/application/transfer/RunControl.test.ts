import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RunControl } from '../../domain/transfer/RunControl.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { createInMemoryApplication } from '../runtime/UnikomApplication.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { RunController } from './RunControlRegistry.js';
import { TransferExecutionService } from './TransferExecutionService.js';

/**
 * Written around what must not happen: a cancelled run must not touch another
 * file, a paused one must not quietly continue, and neither may leave a half
 * file in the destination — holding happens between files, never inside one.
 */

async function workspace(files: number): Promise<{ root: string; source: string; destination: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-control-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'incoming');

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination, { recursive: true });

  for (let index = 1; index <= files; index += 1) {
    await fs.writeFile(path.join(source, `ORDER_${String(index).padStart(3, '0')}.csv`), `line ${index}\n`);
  }

  return { root, source, destination };
}

test('a controller answers what it was told, and cancelling is final', async () => {
  const controller = new RunController();

  assert.equal(controller.state(), 'RUNNING');
  assert.equal(await controller.beforeFile(), true);

  controller.pause();
  assert.equal(controller.state(), 'PAUSED');

  controller.resume();
  assert.equal(controller.state(), 'RUNNING');

  controller.cancel();
  assert.equal(await controller.beforeFile(), false, 'no further file after a cancellation');

  controller.resume();
  assert.equal(controller.state(), 'CANCELLED', 'a cancelled run cannot be resumed');
});

test('a paused run waits, and continues where it stopped', async () => {
  const controller = new RunController();
  controller.pause();

  let continued = false;
  const waiting = controller.beforeFile().then((mayRun) => {
    continued = mayRun;
  });

  // Long enough that a run which ignored the pause would have gone on.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(continued, false, 'while paused, nothing continues');

  controller.resume();
  await waiting;

  assert.equal(continued, true);
});

test('cancelling wakes a paused run instead of leaving it hanging', async () => {
  const controller = new RunController();
  controller.pause();

  const waiting = controller.beforeFile();
  controller.cancel();

  assert.equal(await waiting, false);
});

test('the pipeline asks before every file and stops the moment it is refused', async () => {
  const { root, source, destination } = await workspace(5);
  const repository = new InMemoryTransferFileRepository();
  const service = new TransferExecutionService({
    transferFileRepository: repository,
    stagingRoot: path.join(root, 'staging'),
  });

  // Deterministic instead of timed: this control lets exactly two files
  // through and then behaves like a cancellation.
  let asked = 0;
  const control: RunControl = {
    state: () => (asked > 2 ? 'CANCELLED' : 'RUNNING'),
    beforeFile: async () => {
      asked += 1;
      return asked <= 2;
    },
  };

  const result = await service.execute(
    createTransferJob({
      id: 'job-1',
      sourceDirectory: source,
      destinationDirectory: destination,
      maxConcurrentFiles: 1,
    }),
    new LocalSourceAdapter(source),
    { control }
  );

  assert.equal(result.status, TransferRunStatus.CANCELLED);
  assert.equal(result.filesSucceeded, 2, 'exactly the files that were allowed through');
  assert.deepEqual((await fs.readdir(destination)).sort(), ['ORDER_001.csv', 'ORDER_002.csv']);
  assert.equal(result.filesSelected, 5, 'the run still says how much it was meant to do');
});

test('a cancelled run stops at the next file and keeps what it transferred', async () => {
  const { root, source, destination } = await workspace(60);
  const application = createInMemoryApplication({ stagingRoot: path.join(root, 'application-data') });

  await application.jobRepository.save(
    createTransferJob({
      id: 'job-1',
      sourceDirectory: source,
      destinationDirectory: destination,
      // One at a time, so the point of cancellation is unambiguous.
      maxConcurrentFiles: 1,
    })
  );

  // Cancel as soon as the run appears in the registry: from that moment no
  // further file may be started.
  const watching = (async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [active] = application.runControls.active();

      if (active) {
        application.runControls.get(active.runId)?.cancel();
        return active.runId;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return undefined;
  })();

  const run = await application.runtime.orchestrator.runJobNow('job-1', new Date());
  const cancelledRunId = await watching;

  assert.ok(cancelledRunId, 'the run has to be visible while it runs');
  assert.equal(run?.status, TransferRunStatus.CANCELLED);

  const delivered = await fs.readdir(destination);
  assert.ok(delivered.length < 60, `expected an interrupted run, but all ${delivered.length} files arrived`);

  // Whatever did arrive is complete — that is the whole point of stopping
  // between files rather than inside one.
  for (const name of delivered) {
    const content = await fs.readFile(path.join(destination, name), 'utf8');
    assert.match(content, /^line \d+\n$/);
  }

  application.close();
});

test('a finished run disappears from the control room', async () => {
  const { root, source, destination } = await workspace(1);
  const application = createInMemoryApplication({ stagingRoot: path.join(root, 'application-data') });

  await application.jobRepository.save(
    createTransferJob({ id: 'job-1', sourceDirectory: source, destinationDirectory: destination })
  );

  await application.runtime.orchestrator.runJobNow('job-1', new Date());

  assert.deepEqual(application.runControls.active(), [], 'nothing is left to steer once it is done');
  application.close();
});

test('the log can be read in pieces, without repeating a line', async () => {
  const { root, source, destination } = await workspace(3);
  const application = createInMemoryApplication({ stagingRoot: path.join(root, 'application-data') });

  await application.jobRepository.save(
    createTransferJob({ id: 'job-1', sourceDirectory: source, destinationDirectory: destination })
  );

  const run = await application.runtime.orchestrator.runJobNow('job-1', new Date());
  const all = await application.logRepository.list({ runId: run!.id, minimumLevel: 'DEBUG' });

  assert.ok(all.length > 1, 'a run says something about itself');
  assert.ok(
    all.every((entry) => typeof entry.sequence === 'number'),
    'every line has a position'
  );

  const half = all[Math.floor(all.length / 2)].sequence!;
  const rest = await application.logRepository.list({
    runId: run!.id,
    minimumLevel: 'DEBUG',
    afterSequence: half,
  });

  assert.deepEqual(
    rest.map((entry) => entry.sequence),
    all.filter((entry) => (entry.sequence ?? 0) > half).map((entry) => entry.sequence),
    'asking for what is new returns exactly that'
  );

  application.close();
});
