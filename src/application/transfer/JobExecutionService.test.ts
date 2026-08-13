import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { JobExecutionService } from './JobExecutionService.js';
import { TransferExecutionService } from './TransferExecutionService.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

test('job execution service runs a transfer job from repository config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-jobexec-'));
  const sourceDir = path.join(tempDir, 'source');
  const destinationDir = path.join(tempDir, 'dest');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const repository = new InMemoryTransferJobRepository();
  const service = new JobExecutionService(
    repository,
    new TransferExecutionService({
      transferFileRepository: new InMemoryTransferFileRepository(),
      stagingRoot: path.join(tempDir, 'application-data'),
    })
  );

  const job: TransferJob = {
    id: 'job-1',
    tenantId: 'default',
    name: 'Local CSV Import',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: sourceDir },
    sourceDirectory: sourceDir,
    includeSubdirectories: false,
    filenamePrefix: 'ORDER_',
    caseSensitivePrefix: false,
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.tmp'],
    minimumFileAgeSeconds: 0,
    stabilityCheck: {
      enabled: false,
      intervalSeconds: 0,
      requiredStableChecks: 0,
      compareSize: false,
      compareLastModified: false,
    },
    destinationDirectory: destinationDir,
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: {
      enabled: false,
      provider: 'NONE',
    },
    sourceSuccessAction: 'KEEP',
    executionMode: 'AUTOMATIC',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await repository.save(job);

  const result = await service.executeById('job-1');

  assert.equal(result?.status, TransferRunStatus.SUCCESS);
  assert.equal(result?.filesSucceeded, 1);
  assert.equal(await fs.access(path.join(destinationDir, 'ORDER_001.csv')).then(() => true, () => false), true);
});

test('an unknown job id yields no run', async () => {
  const service = new JobExecutionService(new InMemoryTransferJobRepository());

  assert.equal(await service.executeById('does-not-exist'), undefined);
});
