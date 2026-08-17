import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TransferExecutionService } from './TransferExecutionService.js';
import type { TransferEvent } from './TransferEvents.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';

const CONTENT = 'customer;amount\nA;42\n';
const keyProvider = { async getKey() { return 'unit-test-encryption-key'; } };

interface Harness {
  root: string;
  sourceDirectory: string;
  destinationDirectory: string;
  repository: InMemoryTransferFileRepository;
  events: TransferEvent[];
  service: TransferExecutionService;
  job: TransferJob;
  adapter: SourceAdapter;
}

async function setup(jobOverrides: Partial<TransferJob> = {}): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-pipeline-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'dest');
  await fs.mkdir(sourceDirectory, { recursive: true });

  const repository = new InMemoryTransferFileRepository();
  const events: TransferEvent[] = [];

  const service = new TransferExecutionService({
    transferFileRepository: repository,
    stagingRoot: path.join(root, 'application-data'),
    encryptionKeyProvider: keyProvider,
    events: (event) => events.push(event),
  });

  const job: TransferJob = {
    id: 'job-customer-a',
    tenantId: 'default',
    name: 'Customer A Orders',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: sourceDirectory },
    sourceDirectory,
    includeSubdirectories: false,
    filenamePrefix: 'ORDER_*',
    caseSensitivePrefix: false,
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.part', '.tmp'],
    minimumFileAgeSeconds: 0,
    stabilityCheck: {
      enabled: false,
      intervalSeconds: 0,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: true,
    },
    destinationDirectory,
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    sourceSuccessAction: 'KEEP',
    executionMode: 'MANUAL_AND_AUTOMATIC',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...jobOverrides,
  };

  return { root, sourceDirectory, destinationDirectory, repository, events, service, job, adapter: new LocalSourceAdapter(sourceDirectory) };
}

async function writeSourceFile(harness: Harness, name: string, content = CONTENT): Promise<void> {
  await fs.writeFile(path.join(harness.sourceDirectory, name), content);
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

test('a matching file is transferred and reported as STEP_1_COMPLETED', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.status, TransferRunStatus.SUCCESS);
  assert.equal(result.filesSucceeded, 1);
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_001.csv')), true);
  assert.ok(harness.events.some((event) => event.name === 'STEP_1_COMPLETED'));
});

test('a completed transfer is registered with hash and destination', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);
  const [persisted] = await harness.repository.listByRun(result.runId);

  assert.equal(persisted.status, FileTransferStatus.SUCCESS);
  assert.equal(persisted.destinationFilename, 'ORDER_001.csv');
  assert.equal(persisted.sha256?.length, 64);
  assert.equal(persisted.destinationSize, CONTENT.length);
});

test('a run without matching files is not an error', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'INVOICE_001.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.status, TransferRunStatus.SUCCESS_NO_FILES);
  assert.equal(result.filesFound, 1);
  assert.equal(result.filesSelected, 0);
});

test('an unfinished upload is ignored until it is renamed', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv.part');

  const firstRun = await harness.service.execute(harness.job, harness.adapter);
  assert.equal(firstRun.status, TransferRunStatus.SUCCESS_NO_FILES);

  await fs.rename(
    path.join(harness.sourceDirectory, 'ORDER_001.csv.part'),
    path.join(harness.sourceDirectory, 'ORDER_001.csv')
  );

  const secondRun = await harness.service.execute(harness.job, harness.adapter);
  assert.equal(secondRun.filesSucceeded, 1);
});

// The repeat protection, and it runs here with detectContentDuplicates off:
// recognising the same source file again is what makes a scheduled run
// repeatable at all, so it is not a setting. Without it every run would fetch
// the whole source directory anew.
test('the same file is not transferred twice', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');

  await harness.service.execute(harness.job, harness.adapter);
  const secondRun = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(secondRun.filesSucceeded, 0);
  assert.equal(secondRun.filesSkipped, 1);
  assert.equal(secondRun.outcomes[0].status, FileTransferStatus.SKIPPED);
});

test('identical content under a different name is transferred by default', async () => {
  // Which files a source provides is its own decision. Two names, two files -
  // withholding one the customer sent is the riskier assumption.
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');
  await writeSourceFile(harness, 'ORDER_002.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 2);
  assert.equal(result.filesSkipped, 0);
  assert.deepEqual((await fs.readdir(harness.destinationDirectory)).sort(), ['ORDER_001.csv', 'ORDER_002.csv']);
});

test('identical content under a different name is skipped once the job asks for it', async () => {
  const harness = await setup({ detectContentDuplicates: true });
  await writeSourceFile(harness, 'ORDER_001.csv');
  await writeSourceFile(harness, 'ORDER_002.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 1);
  assert.equal(result.filesSkipped, 1);
  // Which of the two wins depends on scheduling, so assert on the pair.
  const skipped = result.outcomes.find((outcome) => outcome.status === FileTransferStatus.SKIPPED);
  assert.match(skipped?.message ?? '', /[Dd]erselbe Inhalt/);
});

test('the same filename in two subdirectories is two different files', async () => {
  const harness = await setup({ includeSubdirectories: true, conflictStrategy: 'RENAME', maxConcurrentFiles: 1 });
  await fs.mkdir(path.join(harness.sourceDirectory, 'kunde-a'), { recursive: true });
  await fs.mkdir(path.join(harness.sourceDirectory, 'kunde-b'), { recursive: true });
  await fs.writeFile(path.join(harness.sourceDirectory, 'kunde-a', 'ORDER_001.csv'), 'customer;amount\nA;1\n');
  await fs.writeFile(path.join(harness.sourceDirectory, 'kunde-b', 'ORDER_001.csv'), 'customer;amount\nB;2\n');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 2, 'the second file must not count as a duplicate of the first');
  // Both carry the same stamp — they came in one run — so the counter decides
  // between them.
  const stored = (await fs.readdir(harness.destinationDirectory)).sort();
  assert.equal(stored.length, 2);
  assert.equal(stored[0], 'ORDER_001.csv');
  assert.match(stored[1], /^ORDER_001_\d{8}_\d{6}\.csv$/);
});

test('an existing destination file is skipped by default', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');
  await fs.mkdir(harness.destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'older content');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSkipped, 1);
  assert.equal(await fs.readFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'utf8'), 'older content');
});

test('conflict strategy OVERWRITE replaces the existing file', async () => {
  const harness = await setup({ conflictStrategy: 'OVERWRITE' });
  await writeSourceFile(harness, 'ORDER_001.csv');
  await fs.mkdir(harness.destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'older content');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 1);
  assert.equal(await fs.readFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'utf8'), CONTENT);
});

test('conflict strategy RENAME keeps both files and stamps the new one', async () => {
  const harness = await setup({ conflictStrategy: 'RENAME' });
  await writeSourceFile(harness, 'ORDER_001.csv');
  await fs.mkdir(harness.destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'older content');

  // A fixed moment, so the name is the one thing under test here. It lies
  // ahead of the source file's own time, which no age rule minds: a file is
  // older than the run that fetches it, which is the normal case.
  const result = await harness.service.execute(harness.job, harness.adapter, {
    now: new Date('2027-03-04T08:09:10'),
  });

  assert.equal(result.filesSucceeded, 1);
  assert.equal(path.basename(result.outcomes[0].destinationPath ?? ''), 'ORDER_001_04032027_080910.csv');
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_001.csv')), true);
  assert.equal(
    await fs.readFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'utf8'),
    'older content',
    'the file that was already there must stay untouched'
  );
});

test('an American job writes the month before the day', async () => {
  // Same moment, same job, one setting apart: 04032027 there, 03042027 here.
  // A date of digits alone belongs to whoever reads it.
  const harness = await setup({ conflictStrategy: 'RENAME', timestampNotation: 'MONTH_FIRST' });
  await writeSourceFile(harness, 'ORDER_001.csv');
  await fs.mkdir(harness.destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'older content');

  const result = await harness.service.execute(harness.job, harness.adapter, {
    now: new Date('2027-03-04T08:09:10'),
  });

  assert.equal(path.basename(result.outcomes[0].destinationPath ?? ''), 'ORDER_001_03042027_080910.csv');
});

test('conflict strategy NEW_NAME stores under the chosen name and keeps the extension', async () => {
  const harness = await setup({ conflictStrategy: 'NEW_NAME', conflictFilename: 'Nachlieferung' });
  await writeSourceFile(harness, 'ORDER_001.csv');
  await fs.mkdir(harness.destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'older content');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 1);
  assert.deepEqual((await fs.readdir(harness.destinationDirectory)).sort(), [
    'Nachlieferung.csv',
    'ORDER_001.csv',
  ]);
  assert.equal(await fs.readFile(path.join(harness.destinationDirectory, 'Nachlieferung.csv'), 'utf8'), CONTENT);
});

test('a chosen name that is taken as well gets counted up rather than lost', async () => {
  // One name for every conflict this job ever has, so the second one meets
  // itself. Nothing may be dropped over that.
  const harness = await setup({ conflictStrategy: 'NEW_NAME', conflictFilename: 'Nachlieferung' });
  await writeSourceFile(harness, 'ORDER_001.csv');
  await writeSourceFile(harness, 'ORDER_002.csv', 'customer;amount\nB;7\n');
  await fs.mkdir(harness.destinationDirectory, { recursive: true });
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'older content');
  await fs.writeFile(path.join(harness.destinationDirectory, 'ORDER_002.csv'), 'older content');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 2);
  assert.deepEqual((await fs.readdir(harness.destinationDirectory)).sort(), [
    'Nachlieferung.csv',
    'Nachlieferung_001.csv',
    'ORDER_001.csv',
    'ORDER_002.csv',
  ]);
});

test('the source file is kept by default', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');

  await harness.service.execute(harness.job, harness.adapter);

  assert.equal(await exists(path.join(harness.sourceDirectory, 'ORDER_001.csv')), true);
});

test('the source file is deleted only after a complete success', async () => {
  const harness = await setup({ sourceSuccessAction: 'DELETE' });
  await writeSourceFile(harness, 'ORDER_001.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 1);
  assert.equal(await exists(path.join(harness.sourceDirectory, 'ORDER_001.csv')), false);
});

test('the source file is moved to the archive directory', async () => {
  const harness = await setup({ sourceSuccessAction: 'MOVE' });
  harness.job.sourceArchiveDirectory = path.join(harness.root, 'archive');
  await writeSourceFile(harness, 'ORDER_001.csv');

  await harness.service.execute(harness.job, harness.adapter);

  assert.equal(await exists(path.join(harness.sourceDirectory, 'ORDER_001.csv')), false);
  assert.equal(await exists(path.join(harness.root, 'archive', 'ORDER_001.csv')), true);
});

test('a failing encryption prevents storage, deletion and STEP_1_COMPLETED', async () => {
  const harness = await setup({
    sourceSuccessAction: 'DELETE',
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'missing-credential' },
  });
  // No key provider is wired here, so resolving the credential must fail.
  const service = new TransferExecutionService({
    transferFileRepository: harness.repository,
    stagingRoot: path.join(harness.root, 'application-data'),
    events: (event) => harness.events.push(event),
  });
  await writeSourceFile(harness, 'ORDER_001.csv');

  const result = await service.execute(harness.job, harness.adapter);

  assert.equal(result.status, TransferRunStatus.FAILED);
  assert.equal(result.filesFailed, 1);
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_001.csv')), false);
  assert.equal(await exists(path.join(harness.sourceDirectory, 'ORDER_001.csv')), true);
  assert.equal(harness.events.some((event) => event.name === 'STEP_1_COMPLETED'), false);
});

test('an encrypted transfer stores only the encrypted file', async () => {
  const harness = await setup({
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'customer-a-key' },
  });
  await writeSourceFile(harness, 'ORDER_001.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.filesSucceeded, 1);
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_001.csv')), false);

  const encryptedPath = path.join(harness.destinationDirectory, 'ORDER_001.csv.enc');
  assert.equal(await exists(encryptedPath), true);
  assert.notEqual(await fs.readFile(encryptedPath, 'utf8'), CONTENT);
});

test('one failing file does not stop the remaining files', async () => {
  const harness = await setup();
  // Distinct content, otherwise the content duplicate check would legitimately
  // skip the later files.
  await writeSourceFile(harness, 'ORDER_001.csv', 'customer;amount\nA;1\n');
  await writeSourceFile(harness, 'ORDER_002.csv', 'customer;amount\nB;2\n');
  await writeSourceFile(harness, 'ORDER_003.csv', 'customer;amount\nC;3\n');

  const local = new LocalSourceAdapter(harness.sourceDirectory);
  const failingAdapter: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    async downloadFile(sourceFile: SourceFile, targetPath: string) {
      if (sourceFile.name === 'ORDER_002.csv') {
        throw new Error('Simulated network failure');
      }
      return local.downloadFile(sourceFile, targetPath);
    },
  };

  const result = await harness.service.execute(harness.job, failingAdapter);

  assert.equal(result.status, TransferRunStatus.COMPLETED_WITH_ERRORS);
  assert.equal(result.filesSucceeded, 2);
  assert.equal(result.filesFailed, 1);
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_001.csv')), true);
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_003.csv')), true);
});

test('a remote filename cannot escape the destination directory', async () => {
  const harness = await setup({ filenamePrefix: undefined });
  const hostileAdapter: SourceAdapter = {
    async testConnection() {
      return { ok: true, message: 'connected' };
    },
    async listFiles() {
      return [
        {
          name: '../../escaped.csv',
          fullPath: '/exports/orders/../../escaped.csv',
          size: CONTENT.length,
          lastModified: new Date(),
          isDirectory: false,
        },
      ];
    },
    async downloadFile(_file, targetPath) {
      await fs.writeFile(targetPath, CONTENT);
      return { ok: true, message: 'downloaded', localPath: targetPath };
    },
  };

  const result = await harness.service.execute(harness.job, hostileAdapter);

  assert.equal(result.filesFailed, 1);
  assert.match(result.outcomes[0].message, /unsafe filename/i);
  assert.equal(await exists(path.join(harness.root, 'escaped.csv')), false);
});

test('an unstable file waits for the next scheduler run', async () => {
  const harness = await setup({
    stabilityCheck: {
      enabled: true,
      intervalSeconds: 0,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: false,
    },
  });
  await writeSourceFile(harness, 'ORDER_001.csv');

  const local = new LocalSourceAdapter(harness.sourceDirectory);
  let listings = 0;
  const growingAdapter: SourceAdapter = {
    testConnection: () => local.testConnection(),
    async listFiles(directory: string, recursive: boolean) {
      const files = await local.listFiles(directory, recursive);
      listings += 1;
      // The second listing reports a larger file, as if it were still uploading.
      return files.map((file) => (listings > 1 ? { ...file, size: (file.size ?? 0) + 5_000 } : file));
    },
    downloadFile: (file, targetPath) => local.downloadFile(file, targetPath),
  };

  const result = await harness.service.execute(harness.job, growingAdapter);

  assert.equal(result.filesSucceeded, 0);
  assert.equal(result.outcomes[0].status, FileTransferStatus.WAITING_FOR_STABILITY);
  assert.equal(await exists(path.join(harness.destinationDirectory, 'ORDER_001.csv')), false);
});

test('the staging directory is removed after the run', async () => {
  const harness = await setup();
  await writeSourceFile(harness, 'ORDER_001.csv');

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(await exists(path.join(harness.root, 'application-data', 'staging', result.runId)), false);
});

/**
 * Why the editor warns about an archive below the source directory.
 *
 * A file is recognised again by where it sat, what it was called, how big it
 * was and when it was last written — and the move changes the first of those.
 * So the archived file is a new file to the next run, which fetches it again
 * and, unless the conflict strategy refuses it, stores it a second time.
 *
 * The test states the behaviour rather than fixing it: the archive belongs
 * next to the source, not inside it, and no rule the engine could invent would
 * be as clear as saying so where the directory is typed.
 */
test('an archive below the source comes back on the next run', async () => {
  const harness = await setup({
    includeSubdirectories: true,
    sourceSuccessAction: 'MOVE',
    conflictStrategy: 'RENAME',
  });
  harness.job.sourceArchiveDirectory = path.join(harness.sourceDirectory, 'archiv');
  await writeSourceFile(harness, 'ORDER_001.csv');

  const first = await harness.service.execute(harness.job, harness.adapter);
  assert.equal(first.filesSucceeded, 1);
  assert.equal(await exists(path.join(harness.sourceDirectory, 'archiv', 'ORDER_001.csv')), true);

  const second = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(second.filesSucceeded, 1, 'the archived file counts as new because it sits somewhere else now');
  assert.equal((await fs.readdir(harness.destinationDirectory)).length, 2, 'and so it lands a second time');
});

test('an archive beside the source is left alone', async () => {
  const harness = await setup({
    includeSubdirectories: true,
    sourceSuccessAction: 'MOVE',
    conflictStrategy: 'RENAME',
  });
  harness.job.sourceArchiveDirectory = path.join(harness.root, 'archiv');
  await writeSourceFile(harness, 'ORDER_001.csv');

  await harness.service.execute(harness.job, harness.adapter);
  const second = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(second.filesSelected, 0, 'nothing is left in the source to find');
  assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv']);
});
