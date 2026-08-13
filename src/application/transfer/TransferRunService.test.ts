import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferRunService } from './TransferRunService.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';

function run(overrides: Partial<TransferRun> = {}): TransferRun {
  return {
    id: 'TR-20260813-064500',
    jobId: 'job-customer-a',
    status: TransferRunStatus.RUNNING,
    startedAt: new Date('2026-08-13T06:45:00.000Z'),
    filesFound: 5,
    filesProcessed: 3,
    filesSucceeded: 3,
    filesSkipped: 2,
    filesFailed: 0,
    ...overrides,
  };
}

test('transfer run service creates and reads runs', async () => {
  const service = new TransferRunService(new InMemoryTransferRunRepository());

  await service.create(run());
  const stored = await service.getById('TR-20260813-064500');

  assert.equal(stored?.jobId, 'job-customer-a');
  assert.equal(stored?.status, TransferRunStatus.RUNNING);
  assert.equal(stored?.filesSkipped, 2);
});

test('a run can be updated to its final status', async () => {
  const repository = new InMemoryTransferRunRepository();
  const service = new TransferRunService(repository);

  await service.create(run());
  await service.create(run({ status: TransferRunStatus.COMPLETED_WITH_ERRORS, completedAt: new Date(), filesFailed: 1 }));

  const stored = await service.getById('TR-20260813-064500');

  assert.equal(stored?.status, TransferRunStatus.COMPLETED_WITH_ERRORS);
  assert.equal((await service.list()).length, 1);
});

test('runs can be listed per job, newest first', async () => {
  const repository = new InMemoryTransferRunRepository();
  const service = new TransferRunService(repository);

  await service.create(run({ id: 'TR-1', startedAt: new Date('2026-08-13T06:00:00.000Z') }));
  await service.create(run({ id: 'TR-2', startedAt: new Date('2026-08-13T06:45:00.000Z') }));
  await service.create(run({ id: 'TR-3', jobId: 'other-job' }));

  const runs = await repository.listByJob('job-customer-a');

  assert.deepEqual(runs.map((entry) => entry.id), ['TR-2', 'TR-1']);
});
