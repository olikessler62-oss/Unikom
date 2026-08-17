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

test('storing under a new name without a name is refused at save time', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create({ ...job, conflictStrategy: 'NEW_NAME' }),
    /braucht diesen Namen/,
    'a job that promises a name it does not have would fetch its files and have nowhere to put them'
  );
});

test('a chosen name that is a path is refused', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create({ ...job, conflictStrategy: 'NEW_NAME', conflictFilename: '..\\..\\woanders' }),
    /lässt sich nicht als Dateiname verwenden/
  );
});

test('a chosen name survives an update that does not mention it', async () => {
  const repo = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repo);

  await service.create({ ...job, conflictStrategy: 'NEW_NAME', conflictFilename: 'Nachlieferung' });
  const updated = await service.update('job-1', { description: 'Something else entirely' });

  assert.equal(updated?.conflictFilename, 'Nachlieferung');
});
