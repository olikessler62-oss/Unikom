import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferExecutionService } from './TransferExecutionService.js';
import { FileSelectionService } from './FileSelectionService.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';

const mockSourceAdapter: SourceAdapter = {
  async testConnection() {
    return { ok: true, message: 'ok' };
  },
  async listFiles() {
    const now = Date.now();
    return [
      {
        name: 'ORDER_001.csv',
        fullPath: '/tmp/ORDER_001.csv',
        size: 100,
        lastModified: new Date(now - 90_000),
        isDirectory: false,
      },
      {
        name: 'ORDER_002.csv.tmp',
        fullPath: '/tmp/ORDER_002.csv.tmp',
        size: 10,
        lastModified: new Date(now - 150_000),
        isDirectory: false,
      },
      {
        name: 'INVOICE_001.csv',
        fullPath: '/tmp/INVOICE_001.csv',
        size: 100,
        lastModified: new Date(now - 90_000),
        isDirectory: false,
      },
    ] satisfies SourceFile[];
  },
  async downloadFile(sourceFile: SourceFile) {
    return { ok: true, message: 'downloaded', localPath: sourceFile.fullPath };
  },
};

test('file selection filters by prefix, extension and minimum age', () => {
  const service = new FileSelectionService();
  const file: SourceFile = {
    name: 'Order_001.csv',
    fullPath: '/tmp/Order_001.csv',
    size: 100,
    lastModified: new Date(Date.now() - 90_000),
    isDirectory: false,
  };

  const matches = service.matches(file, {
    filenamePrefix: 'ORDER_',
    allowedExtensions: ['.csv'],
    caseSensitivePrefix: false,
    includeSubdirectories: false,
    minimumFileAgeSeconds: 60,
    requireStableFile: false,
  });

  assert.equal(matches, true);
});

test('transfer execution skips temporary uploads and respects minimum age', async () => {
  const service = new TransferExecutionService(new FileSelectionService(), mockSourceAdapter);
  const result = await service.execute({
    id: 'job-1',
    name: 'Demo job',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: '/tmp' },
    sourceDirectory: '/tmp',
    includeSubdirectories: false,
    filenamePrefix: 'ORDER_',
    caseSensitivePrefix: false,
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.tmp'],
    minimumFileAgeSeconds: 60,
    stabilityCheck: {
      enabled: false,
      intervalSeconds: 5,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: true,
    },
    destinationDirectory: '/dest',
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    sourceSuccessAction: 'KEEP',
    executionMode: 'AUTOMATIC',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.processedFiles.length, 1);
  assert.equal(result.processedFiles[0].name, 'ORDER_001.csv');
});
