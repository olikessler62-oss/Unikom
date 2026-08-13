import test from 'node:test';
import assert from 'node:assert/strict';
import { JobSchedulerService } from './JobSchedulerService.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

test('scheduler computes next execution for daily jobs', () => {
  const now = new Date('2026-08-13T05:00:00+02:00');
  const schedule = {
    type: 'DAILY' as const,
    executionTime: '06:30',
    timezone: 'Europe/Berlin',
    missedRunPolicy: 'SKIP' as const,
  };

  const next = JobSchedulerService.calculateNextExecution(now, schedule);

  assert.ok(next instanceof Date);
  assert.equal(next.toISOString(), '2026-08-13T04:30:00.000Z');
});

test('scheduler skips overlapping runs for the same job', () => {
  const job: TransferJob = {
    id: 'job-1',
    name: 'Demo',
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
    destinationDirectory: 'D:/Inbox',
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    sourceSuccessAction: 'KEEP',
    executionMode: 'AUTOMATIC',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastExecutionAt: new Date('2026-08-13T05:59:30+02:00'),
  };

  const scheduler = new JobSchedulerService();
  const shouldSkip = scheduler.shouldSkipExecution(job, new Date('2026-08-13T06:00:00+02:00'));

  assert.equal(shouldSkip, true);
});
