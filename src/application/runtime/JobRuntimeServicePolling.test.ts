import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { JobRuntimeService } from './JobRuntimeService.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';

test('the polling loop can be started and stopped', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-runtime-loop-'));
  const sourceDirectory = path.join(tempDir, 'source');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const jobRepository = new InMemoryTransferJobRepository();
  await jobRepository.save(
    createTransferJob({
      sourceDirectory,
      destinationDirectory: path.join(tempDir, 'dest'),
      executionMode: 'AUTOMATIC',
      schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
      nextExecutionAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  );

  const runtime = new JobRuntimeService(jobRepository, { stagingRoot: path.join(tempDir, 'application-data') });

  const timer = runtime.startPolling(10);
  assert.equal(runtime.startPolling(10), timer, 'starting twice must reuse the running timer');

  // Wait for the effect instead of for a fixed span, otherwise the test turns
  // flaky as soon as the machine is busy.
  const target = path.join(tempDir, 'dest', 'ORDER_001.csv');
  const deadline = Date.now() + 5_000;
  let transferred = false;

  while (!transferred && Date.now() < deadline) {
    transferred = await fs.access(target).then(() => true, () => false);
    if (!transferred) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  runtime.stopPolling();

  assert.equal(transferred, true, 'the polling loop should have executed the due job');
});
