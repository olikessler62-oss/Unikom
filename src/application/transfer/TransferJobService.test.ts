import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferJobService } from './TransferJobService.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

const job: TransferJob = {
  id: 'job-1',
  tenantId: 'default',
  name: 'Customer A Orders',
  enabled: true,
  sourceType: 'LOCAL',
  sourceConfig: { type: 'LOCAL', directory: 'C:/Import' },
  sourceDirectory: 'C:/Import',
  includeSubdirectories: false,
  caseSensitivePrefix: false,
  allowedExtensions: ['csv'],
  ignoredTemporaryExtensions: ['.tmp'],
  minimumFileAgeSeconds: 30,
  stabilityCheck: {
    enabled: true,
    intervalSeconds: 5,
    requiredStableChecks: 2,
    compareSize: true,
    compareLastModified: true,
  },
  destinationDirectory: 'D:/Incoming',
  createDestinationDirectory: true,
  conflictStrategy: 'SKIP',
  encryptionConfig: { enabled: false, provider: 'NONE' },
  sourceSuccessAction: 'KEEP',
  executionMode: 'AUTOMATIC',
  createdAt: new Date(),
  updatedAt: new Date(),
};

test('transfer job service stores and retrieves jobs', async () => {
  const repo = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repo);

  await service.create(job);
  const stored = await service.getById('job-1');

  assert.ok(stored);
  assert.equal(stored?.name, 'Customer A Orders');
});

test('transfer job service updates a job', async () => {
  const repo = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repo);

  await service.create(job);
  const updated = await service.update('job-1', { enabled: false, description: 'Disabled temporarily' });

  assert.ok(updated);
  assert.equal(updated?.enabled, false);
  assert.equal(updated?.description, 'Disabled temporarily');
});
