import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { JobRuntimeService } from './JobRuntimeService.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';

test('the runtime transfers a due job end to end', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-runtime-'));
  const sourceDirectory = path.join(tempDir, 'source');
  const destinationDirectory = path.join(tempDir, 'dest');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const jobRepository = new InMemoryTransferJobRepository();
  const runRepository = new InMemoryTransferRunRepository();
  await jobRepository.save(
    createTransferJob({
      sourceDirectory,
      destinationDirectory,
      executionMode: 'AUTOMATIC',
      schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
      nextExecutionAt: new Date('2026-08-13T06:00:00.000Z'),
    })
  );

  const runtime = new JobRuntimeService(jobRepository, {
    runRepository,
    stagingRoot: path.join(tempDir, 'application-data'),
  });

  const tick = await runtime.runOnce(new Date('2026-08-13T06:15:00.000Z'));

  assert.equal(tick.started, 1);
  assert.equal(tick.errors.length, 0);
  assert.equal((await runRepository.list())[0]?.status, TransferRunStatus.SUCCESS);
  assert.equal(
    await fs.access(path.join(destinationDirectory, 'ORDER_001.csv')).then(() => true, () => false),
    true
  );
});

test('a freshly started runtime does not immediately run a scheduled job', async () => {
  const jobRepository = new InMemoryTransferJobRepository();
  await jobRepository.save(
    createTransferJob({
      executionMode: 'AUTOMATIC',
      schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
      nextExecutionAt: undefined,
    })
  );

  const runtime = new JobRuntimeService(jobRepository);
  const tick = await runtime.start(new Date('2026-08-13T06:00:00.000Z'));

  assert.equal(tick.started, 0);
  assert.equal(tick.notDue, 1);
});
