import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TransferExecutionService } from './TransferExecutionService.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

interface Harness {
  root: string;
  sourceDirectory: string;
  destinationDirectory: string;
  repository: InMemoryTransferFileRepository;
  job: TransferJob;
  build(adapter?: SourceAdapter): TransferExecutionService;
}

async function setup(jobOverrides: Partial<TransferJob> = {}): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-concurrency-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'dest');
  await fs.mkdir(sourceDirectory, { recursive: true });

  const repository = new InMemoryTransferFileRepository();

  return {
    root,
    sourceDirectory,
    destinationDirectory,
    repository,
    job: createTransferJob({ sourceDirectory, destinationDirectory, ...jobOverrides }),
    build: () =>
      new TransferExecutionService({
        transferFileRepository: repository,
        stagingRoot: path.join(root, 'application-data'),
        // Retry delays are not waited out in tests.
        retryWait: async () => {},
      }),
  };
}

async function writeFiles(directory: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

/** Wraps the local adapter and records how many downloads overlap. */
function observingAdapter(delayMs = 20): { adapter: SourceAdapter; peak: () => number } {
  const local = new LocalSourceAdapter();
  let active = 0;
  let peak = 0;

  return {
    peak: () => peak,
    adapter: {
      testConnection: () => local.testConnection(),
      listFiles: (directory, recursive) => local.listFiles(directory, recursive),
      async downloadFile(file: SourceFile, targetPath: string) {
        active += 1;
        peak = Math.max(peak, active);

        try {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return await local.downloadFile(file, targetPath);
        } finally {
          active -= 1;
        }
      },
    },
  };
}

test('several files are processed at the same time', async () => {
  const harness = await setup({ maxConcurrentFiles: 3 });
  await writeFiles(harness.sourceDirectory, {
    'ORDER_001.csv': 'a;1\n',
    'ORDER_002.csv': 'b;2\n',
    'ORDER_003.csv': 'c;3\n',
    'ORDER_004.csv': 'd;4\n',
    'ORDER_005.csv': 'e;5\n',
    'ORDER_006.csv': 'f;6\n',
  });

  const observer = observingAdapter();
  const result = await harness.build().execute(harness.job, observer.adapter);

  assert.equal(result.filesSucceeded, 6);
  assert.ok(observer.peak() > 1, 'files should not be processed strictly one after another');
});

test('parallelism never exceeds the configured limit', async () => {
  const harness = await setup({ maxConcurrentFiles: 2 });
  await writeFiles(harness.sourceDirectory, {
    'ORDER_001.csv': 'a;1\n',
    'ORDER_002.csv': 'b;2\n',
    'ORDER_003.csv': 'c;3\n',
    'ORDER_004.csv': 'd;4\n',
    'ORDER_005.csv': 'e;5\n',
  });

  const observer = observingAdapter();
  await harness.build().execute(harness.job, observer.adapter);

  assert.ok(observer.peak() <= 2, `expected at most 2 concurrent downloads, saw ${observer.peak()}`);
});

test('a limit of one processes strictly in sequence', async () => {
  const harness = await setup({ maxConcurrentFiles: 1 });
  await writeFiles(harness.sourceDirectory, { 'ORDER_001.csv': 'a;1\n', 'ORDER_002.csv': 'b;2\n' });

  const observer = observingAdapter();
  await harness.build().execute(harness.job, observer.adapter);

  assert.equal(observer.peak(), 1);
});

test('the outcome order follows the discovery order despite parallelism', async () => {
  const harness = await setup({ maxConcurrentFiles: 4 });
  await writeFiles(harness.sourceDirectory, {
    'ORDER_001.csv': 'a;1\n',
    'ORDER_002.csv': 'b;2\n',
    'ORDER_003.csv': 'c;3\n',
    'ORDER_004.csv': 'd;4\n',
  });

  const result = await harness.build().execute(harness.job, observingAdapter().adapter);

  assert.deepEqual(
    result.outcomes.map((outcome) => outcome.filename),
    ['ORDER_001.csv', 'ORDER_002.csv', 'ORDER_003.csv', 'ORDER_004.csv']
  );
});

test('identical content is stored once even when processed concurrently', async () => {
  const harness = await setup({ maxConcurrentFiles: 4, detectContentDuplicates: true });
  const same = 'customer;amount\nA;42\n';
  await writeFiles(harness.sourceDirectory, {
    'ORDER_001.csv': same,
    'ORDER_002.csv': same,
    'ORDER_003.csv': same,
    'ORDER_004.csv': same,
  });

  const result = await harness.build().execute(harness.job, observingAdapter().adapter);

  assert.equal(result.filesSucceeded, 1, 'the duplicate check must not be defeated by parallelism');
  assert.equal(result.filesSkipped, 3);
  assert.equal((await fs.readdir(harness.destinationDirectory)).length, 1);
});

test('concurrent name conflicts each get their own name', async () => {
  const harness = await setup({
    maxConcurrentFiles: 4,
    conflictStrategy: 'RENAME',
    includeSubdirectories: true,
  });
  // The same filename in two subdirectories maps to one destination name.
  await writeFiles(harness.sourceDirectory, {
    'kunde-a/ORDER_001.csv': 'a;1\n',
    'kunde-b/ORDER_001.csv': 'b;2\n',
  });

  const result = await harness.build().execute(harness.job, observingAdapter().adapter);

  assert.equal(result.filesSucceeded, 2);
  const stored = (await fs.readdir(harness.destinationDirectory)).sort();
  assert.deepEqual(stored, ['ORDER_001.csv', 'ORDER_001_001.csv']);
});

test('a temporary download failure is retried and then succeeds', async () => {
  const harness = await setup();
  await writeFiles(harness.sourceDirectory, { 'ORDER_001.csv': 'a;1\n' });

  const local = new LocalSourceAdapter();
  let attempts = 0;
  const flakyAdapter: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    async downloadFile(file: SourceFile, targetPath: string) {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      }
      return local.downloadFile(file, targetPath);
    },
  };

  const result = await harness.build().execute(harness.job, flakyAdapter);

  assert.equal(attempts, 3);
  assert.equal(result.status, TransferRunStatus.SUCCESS);
  assert.equal(result.filesSucceeded, 1);
});

test('a permanent download failure is not retried', async () => {
  const harness = await setup();
  await writeFiles(harness.sourceDirectory, { 'ORDER_001.csv': 'a;1\n' });

  const local = new LocalSourceAdapter();
  let attempts = 0;
  const rejectingAdapter: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    async downloadFile() {
      attempts += 1;
      throw new Error('Permission denied');
    },
  };

  const result = await harness.build().execute(harness.job, rejectingAdapter);

  assert.equal(attempts, 1);
  assert.equal(result.filesFailed, 1);
  assert.equal(result.outcomes[0].status, FileTransferStatus.FAILED);
});

test('a retry reconnects instead of reusing the broken connection', async () => {
  const harness = await setup();
  await writeFiles(harness.sourceDirectory, { 'ORDER_001.csv': 'a;1\n' });

  const local = new LocalSourceAdapter();
  let attempts = 0;
  let disposals = 0;
  const flakyAdapter: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    async downloadFile(file: SourceFile, targetPath: string) {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      }
      return local.downloadFile(file, targetPath);
    },
    async dispose() {
      disposals += 1;
    },
  };

  await harness.build().execute(harness.job, flakyAdapter);

  assert.equal(disposals, 1, 'the dead connection must be dropped before retrying');
});

test('a job without an explicit limit uses the system default of three', async () => {
  const harness = await setup();
  await writeFiles(harness.sourceDirectory, {
    'ORDER_001.csv': 'a;1\n',
    'ORDER_002.csv': 'b;2\n',
    'ORDER_003.csv': 'c;3\n',
    'ORDER_004.csv': 'd;4\n',
    'ORDER_005.csv': 'e;5\n',
  });

  const observer = observingAdapter();
  await harness.build().execute(harness.job, observer.adapter);

  assert.ok(observer.peak() <= 3, `expected at most 3 concurrent downloads, saw ${observer.peak()}`);
});
