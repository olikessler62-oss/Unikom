import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferRunService } from './TransferRunService.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';

test('transfer run service creates and reads runs', async () => {
  const repo = new InMemoryTransferRunRepository();
  const service = new TransferRunService(repo);

  const run = {
    id: 'run-1',
    jobId: 'job-1',
    status: 'RUNNING',
    startedAt: new Date(),
    filesFound: 2,
    filesProcessed: 1,
    filesSucceeded: 1,
    filesSkipped: 0,
    filesFailed: 0,
  };

  await service.create(run);
  const stored = await service.getById('run-1');

  assert.ok(stored);
  assert.equal(stored?.jobId, 'job-1');
  assert.equal(stored?.status, 'RUNNING');
});
