import test from 'node:test';
import assert from 'node:assert/strict';
import { DuplicateDetectionService } from './DuplicateDetectionService.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { FileTransferStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferFile } from '../../domain/transfer/TransferFile.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';

const JOB_ID = 'job-customer-a';
const SOURCE_DIRECTORY = '/exports/orders';
const lastModified = new Date('2026-08-13T06:00:00.000Z');

function sourceFile(overrides: Partial<SourceFile> = {}): SourceFile {
  return {
    name: 'ORDER_001.csv',
    fullPath: `${SOURCE_DIRECTORY}/ORDER_001.csv`,
    size: 183_441,
    lastModified,
    isDirectory: false,
    ...overrides,
  };
}

function transferFile(overrides: Partial<TransferFile> = {}): TransferFile {
  return {
    id: 'transfer-file-1',
    transferRunId: 'TR-1',
    jobId: JOB_ID,
    sourcePath: SOURCE_DIRECTORY,
    sourceFilename: 'ORDER_001.csv',
    sourceSize: 183_441,
    sourceLastModified: lastModified,
    sha256: 'hash-abc',
    status: FileTransferStatus.SUCCESS,
    startedAt: new Date('2026-08-13T06:45:00.000Z'),
    completedAt: new Date('2026-08-13T06:45:12.000Z'),
    ...overrides,
  };
}

async function serviceWith(...files: TransferFile[]): Promise<DuplicateDetectionService> {
  const repository = new InMemoryTransferFileRepository();
  for (const file of files) {
    await repository.save(file);
  }

  return new DuplicateDetectionService(repository);
}

test('an identical file that was already transferred successfully is a duplicate', async () => {
  const service = await serviceWith(transferFile());
  const result = await service.checkSourceFile(JOB_ID, SOURCE_DIRECTORY, sourceFile());

  assert.equal(result.duplicate, true);
  assert.equal(result.reason, 'IDENTICAL_SOURCE_FILE');
});

test('the same filename with different content is not a duplicate', async () => {
  const service = await serviceWith(transferFile());

  const differentSize = await service.checkSourceFile(JOB_ID, SOURCE_DIRECTORY, sourceFile({ size: 200_000 }));
  assert.equal(differentSize.duplicate, false);

  const differentTimestamp = await service.checkSourceFile(
    JOB_ID,
    SOURCE_DIRECTORY,
    sourceFile({ lastModified: new Date(lastModified.getTime() + 60_000) })
  );
  assert.equal(differentTimestamp.duplicate, false);
});

test('a different filename with the same content is a duplicate', async () => {
  const service = await serviceWith(transferFile());
  const result = await service.checkContent(JOB_ID, 'hash-abc');

  assert.equal(result.duplicate, true);
  assert.equal(result.reason, 'IDENTICAL_CONTENT');
  assert.match(result.message, /ORDER_001\.csv/);
});

test('a file already skipped as a duplicate is not fetched again', async () => {
  const service = await serviceWith(
    transferFile({ status: FileTransferStatus.SKIPPED, resolution: 'DUPLICATE' })
  );

  const result = await service.checkSourceFile(JOB_ID, SOURCE_DIRECTORY, sourceFile());

  assert.equal(result.duplicate, true);
  assert.equal(result.reason, 'IDENTICAL_SOURCE_FILE');
});

test('a file skipped because the destination was occupied stays open', async () => {
  // That decision can change as soon as the destination file is removed.
  const service = await serviceWith(transferFile({ status: FileTransferStatus.SKIPPED, resolution: undefined }));

  assert.equal((await service.checkSourceFile(JOB_ID, SOURCE_DIRECTORY, sourceFile())).duplicate, false);
});

test('a duplicate skip does not count as stored content', async () => {
  const service = await serviceWith(
    transferFile({ status: FileTransferStatus.SKIPPED, resolution: 'DUPLICATE' })
  );

  // The content check must only trust a real transfer.
  assert.equal((await service.checkContent(JOB_ID, 'hash-abc')).duplicate, false);
});

test('a failed earlier transfer does not block a new attempt', async () => {
  const service = await serviceWith(transferFile({ status: FileTransferStatus.FAILED }));

  assert.equal((await service.checkSourceFile(JOB_ID, SOURCE_DIRECTORY, sourceFile())).duplicate, false);
  assert.equal((await service.checkContent(JOB_ID, 'hash-abc')).duplicate, false);
});

test('another job with the same file is unaffected', async () => {
  const service = await serviceWith(transferFile());

  assert.equal((await service.checkSourceFile('job-customer-b', SOURCE_DIRECTORY, sourceFile())).duplicate, false);
  assert.equal((await service.checkContent('job-customer-b', 'hash-abc')).duplicate, false);
});

test('the same filename from a different source directory is not a duplicate', async () => {
  const service = await serviceWith(transferFile());
  const result = await service.checkSourceFile(JOB_ID, '/exports/invoices', sourceFile());

  assert.equal(result.duplicate, false);
});
