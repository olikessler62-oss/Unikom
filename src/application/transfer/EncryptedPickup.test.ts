import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';

import { TransferExecutionService } from './TransferExecutionService.js';
import type { TransferEvent } from './TransferEvents.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { SftpSourceAdapter } from '../../infrastructure/sources/sftp/SftpSourceAdapter.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { FtpsSourceAdapter } from '../../infrastructure/sources/ftps/FtpsSourceAdapter.js';
import { FtpsTestServer, readTestCertificate, withFtpsRoot } from '../../testing/FtpsTestServer.js';
import { reviveJob } from '../../infrastructure/persistence/TransferRecordMapping.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { Aes256GcmEncryptionProvider } from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { noModules, type FeatureSet } from '../../domain/licensing/Feature.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { DownloadResult, SourceAdapter } from '../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../domain/files/SourceFile.js';

const CONTENT = 'customer;amount\nMUELLER;42\nSCHMIDT;17\n';
const MARKER = Buffer.from('MUELLER', 'utf8');
const KEY = 'unit-test-encryption-key';
const keyProvider = { async getKey() { return KEY; } };

interface Harness {
  root: string;
  sourceDirectory: string;
  destinationDirectory: string;
  stagingRoot: string;
  repository: InMemoryTransferFileRepository;
  events: TransferEvent[];
  service: TransferExecutionService;
  job: TransferJob;
  adapter: SourceAdapter;
}

async function setup(
  jobOverrides: Partial<TransferJob> = {},
  serviceOverrides: { features?: FeatureSet } = {}
): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-pickup-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'dest');
  const stagingRoot = path.join(root, 'application-data');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), CONTENT, 'utf8');

  const repository = new InMemoryTransferFileRepository();
  const events: TransferEvent[] = [];
  const service = buildService(repository, stagingRoot, serviceOverrides.features, events);

  const job: TransferJob = {
    id: 'job-customer-a',
    tenantId: 'default',
    name: 'Customer A Orders',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: sourceDirectory },
    sourceDirectory,
    includeSubdirectories: false,
    filenamePrefix: 'ORDER_',
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
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', onPickup: true },
    sourceSuccessAction: 'KEEP',
    executionMode: 'MANUAL_AND_AUTOMATIC',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...jobOverrides,
  };

  return {
    root,
    sourceDirectory,
    destinationDirectory,
    stagingRoot,
    repository,
    events,
    service,
    job,
    adapter: new LocalSourceAdapter(sourceDirectory),
  };
}

function buildService(
  repository: InMemoryTransferFileRepository,
  stagingRoot: string,
  features: FeatureSet | undefined,
  events: TransferEvent[]
): TransferExecutionService {
  return new TransferExecutionService({
    transferFileRepository: repository,
    stagingRoot,
    encryptionKeyProvider: keyProvider,
    features,
    events: (event) => events.push(event),
  });
}

/** Every file below a directory, so a search can prove an absence. */
async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;

    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        found.push(full);
      }
    }
  }

  await walk(directory);
  return found;
}

async function assertNoPlaintextUnder(directory: string, note: string): Promise<void> {
  for (const file of await filesUnder(directory)) {
    const content = await fs.readFile(file);
    assert.equal(content.includes(MARKER), false, `${note}: ${file} contains the plaintext`);
  }
}

test('the destination holds only the encrypted file, and it decrypts to the original', async () => {
  const harness = await setup();

  const result = await harness.service.execute(harness.job, harness.adapter);
  assert.equal(result.status, TransferRunStatus.SUCCESS);

  const stored = await fs.readdir(harness.destinationDirectory);
  assert.deepEqual(stored, ['ORDER_001.csv.enc']);

  const encrypted = path.join(harness.destinationDirectory, 'ORDER_001.csv.enc');
  const restored = path.join(harness.root, 'restored.csv');
  await new Aes256GcmEncryptionProvider().decrypt(encrypted, restored, KEY);

  assert.equal(await fs.readFile(restored, 'utf8'), CONTENT);
});

test('nothing readable is left behind anywhere outside the source', async () => {
  const harness = await setup();

  await harness.service.execute(harness.job, harness.adapter);

  await assertNoPlaintextUnder(harness.destinationDirectory, 'after the run');
  await assertNoPlaintextUnder(harness.stagingRoot, 'after the run');
});

test('no plaintext exists on disk at any moment while the file is being fetched', async () => {
  const harness = await setup();
  const local = new LocalSourceAdapter(harness.sourceDirectory);
  const inspections: number[] = [];

  // Feeding the stream by hand is what makes the claim testable: between two
  // chunks the run is genuinely mid-flight, and that is exactly the moment a
  // plaintext copy would exist if the file were written before being encrypted.
  const watching: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    downloadFile: (file, target) => local.downloadFile(file, target),
    async downloadTo(file: SourceFile, destination: Writable): Promise<DownloadResult> {
      const bytes = await fs.readFile(file.fullPath);

      for (let offset = 0; offset < bytes.length; offset += 8) {
        destination.write(bytes.subarray(offset, offset + 8));
        await new Promise((resolve) => setImmediate(resolve));

        await assertNoPlaintextUnder(harness.stagingRoot, 'mid-transfer');
        await assertNoPlaintextUnder(harness.destinationDirectory, 'mid-transfer');
        inspections.push(offset);
      }

      destination.end();
      return { ok: true, message: 'streamed in pieces' };
    },
  };

  const result = await harness.service.execute(harness.job, watching);

  assert.equal(result.status, TransferRunStatus.SUCCESS);
  // Without this the test could pass by never having looked.
  assert.ok(inspections.length >= 4, `expected several mid-transfer inspections, made ${inspections.length}`);
});

test('the recorded checksum describes the content, not the encrypted container', async () => {
  const harness = await setup();

  await harness.service.execute(harness.job, harness.adapter);

  const [record] = await harness.repository.listByJob(harness.job.id);
  const contentHash = crypto.createHash('sha256').update(CONTENT, 'utf8').digest('hex');

  assert.equal(record.status, FileTransferStatus.SUCCESS);
  assert.equal(
    record.sha256,
    contentHash,
    'the checksum has to survive encryption, or the same file would be fetched again on every run'
  );
});

test('an unchanged file is recognised again on the next run', async () => {
  const harness = await setup();

  await harness.service.execute(harness.job, harness.adapter);
  const second = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(second.outcomes[0].status, FileTransferStatus.SKIPPED);
  assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv.enc']);
});

test('a source that cannot stream is refused instead of being fetched in the clear', async () => {
  const harness = await setup();
  const local = new LocalSourceAdapter(harness.sourceDirectory);

  // An adapter from before streaming existed: it can only write to a path.
  const oldFashioned: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    downloadFile: (file, target) => local.downloadFile(file, target),
  };

  const result = await harness.service.execute(harness.job, oldFashioned);

  assert.equal(result.status, TransferRunStatus.FAILED);
  assert.match(result.outcomes[0].message, /nicht als Strom liefern/);
  assert.deepEqual(await fs.readdir(harness.destinationDirectory).catch(() => []), []);
  await assertNoPlaintextUnder(harness.stagingRoot, 'after the refusal');
});

test('without the encryption module nothing is fetched at all', async () => {
  const harness = await setup({}, { features: noModules() });
  const local = new LocalSourceAdapter(harness.sourceDirectory);
  let fetched = 0;

  const counting: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    downloadFile: (file, target) => {
      fetched += 1;
      return local.downloadFile(file, target);
    },
    downloadTo: (file, destination) => {
      fetched += 1;
      return local.downloadTo(file, destination);
    },
  };

  const result = await harness.service.execute(harness.job, counting);

  assert.equal(result.status, TransferRunStatus.FAILED);
  assert.match(result.outcomes[0].message, /braucht das Modul „Verschlüsselte Ablage“/);
  assert.equal(fetched, 0, 'the licence has to be checked before a single byte moves');
});

test('a download that breaks halfway leaves no fragment behind', async () => {
  const harness = await setup();
  const local = new LocalSourceAdapter(harness.sourceDirectory);

  const breaking: SourceAdapter = {
    testConnection: () => local.testConnection(),
    listFiles: (directory, recursive) => local.listFiles(directory, recursive),
    downloadFile: (file, target) => local.downloadFile(file, target),
    async downloadTo(_file: SourceFile, destination: Writable): Promise<DownloadResult> {
      destination.write(Buffer.from('customer;amo', 'utf8'));
      throw new Error('the connection dropped');
    },
  };

  const result = await harness.service.execute(harness.job, breaking);

  assert.equal(result.status, TransferRunStatus.FAILED);
  assert.deepEqual(await fs.readdir(harness.destinationDirectory).catch(() => []), []);

  // A half-written encrypted file would be indistinguishable from a complete
  // one by its name alone, and the next step would happily hand it on.
  const leftovers = await filesUnder(harness.stagingRoot);
  assert.deepEqual(leftovers, [], `staging still holds ${leftovers.join(', ')}`);
});

test('the default timing still encrypts after fetching, exactly as before', async () => {
  const harness = await setup({
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM' },
  });

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.status, TransferRunStatus.SUCCESS);
  assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv.enc']);
  await assertNoPlaintextUnder(harness.destinationDirectory, 'default timing');
});

/**
 * The same promise over a real connection.
 *
 * The claim "no plaintext on this machine" is worth as much as the weakest
 * source it holds for, and a remote source is the one that could quietly fall
 * back to writing a file first: `fastGet` opens the target itself. So this test
 * runs against a real SFTP server rather than a stand-in, and looks for the
 * plaintext in every file the run leaves behind.
 */
test('a file fetched over SFTP is encrypted on the way in as well', async () => {
  const remoteRoot = await withSftpRoot({ 'exports/ORDER_001.csv': CONTENT });
  const server = await SftpTestServer.start({ root: remoteRoot, username: 'unikom', password: 'SFTP-2026' });
  const harness = await setup({ sourceDirectory: '/exports' });

  const adapter = new SftpSourceAdapter(
    {
      type: 'SFTP',
      directory: '/exports',
      host: '127.0.0.1',
      port: server.port,
      hostKeyFingerprint: server.hostKeyFingerprint,
      timeoutSeconds: 10,
    },
    { username: 'unikom', password: 'SFTP-2026' }
  );

  try {
    const result = await harness.service.execute(harness.job, adapter);

    assert.equal(result.status, TransferRunStatus.SUCCESS, result.message);
    assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv.enc']);
    await assertNoPlaintextUnder(harness.destinationDirectory, 'after the SFTP run');
    await assertNoPlaintextUnder(harness.stagingRoot, 'after the SFTP run');

    const restored = path.join(harness.root, 'restored-from-sftp.csv');
    await new Aes256GcmEncryptionProvider().decrypt(
      path.join(harness.destinationDirectory, 'ORDER_001.csv.enc'),
      restored,
      KEY
    );
    assert.equal(await fs.readFile(restored, 'utf8'), CONTENT);
  } finally {
    await adapter.dispose?.();
    await server.stop();
  }
});

/** And over FTPS, the third source. Same claim, same way of checking it. */
test('a file fetched over FTPS is encrypted on the way in as well', async () => {
  const remoteRoot = await withFtpsRoot({ 'ORDER_001.csv': CONTENT });
  const server = await FtpsTestServer.start({ root: remoteRoot, username: 'unikom', password: 'FTPS-2026' });
  const harness = await setup({ sourceDirectory: '/' });

  const adapter = new FtpsSourceAdapter(
    {
      type: 'FTPS',
      directory: '/',
      host: '127.0.0.1',
      port: server.port,
      tls: true,
      trustedCertificate: await readTestCertificate(),
      timeoutSeconds: 15,
    },
    { username: 'unikom', password: 'FTPS-2026' }
  );

  try {
    const result = await harness.service.execute(harness.job, adapter);

    assert.equal(result.status, TransferRunStatus.SUCCESS, result.message);
    assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv.enc']);
    await assertNoPlaintextUnder(harness.destinationDirectory, 'after the FTPS run');
    await assertNoPlaintextUnder(harness.stagingRoot, 'after the FTPS run');
  } finally {
    await adapter.dispose?.();
    await server.stop();
  }
});

/**
 * The fourth combination: encrypted on the way, readable at rest.
 *
 * This is what a following step needs — consolidating or converting works on
 * records, and an envelope has none — and what somebody needs whose own tools
 * read the destination directory.
 */
test('a file fetched encrypted can be stored readable again', async () => {
  const harness = await setup({
    encryptionConfig: { enabled: false, provider: 'AES_256_GCM', onPickup: true },
  });

  const result = await harness.service.execute(harness.job, harness.adapter);

  assert.equal(result.status, TransferRunStatus.SUCCESS);
  assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv']);
  assert.equal(await fs.readFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'utf8'), CONTENT);
  // The staging area is what the readable copy passed through, and it has to
  // be empty afterwards — the promise is bounded by the destination, not lost.
  await assertNoPlaintextUnder(harness.stagingRoot, 'after opening it again');
});

test('opening it again is refused when the key is wrong, and nothing is stored', async () => {
  const harness = await setup(
    { encryptionConfig: { enabled: false, provider: 'AES_256_GCM', onPickup: true, keyCredentialId: 'other' } }
  );

  // The service fetches with one key and is handed another to open with.
  let handedOut = 0;
  const service = new TransferExecutionService({
    transferFileRepository: harness.repository,
    stagingRoot: harness.stagingRoot,
    encryptionKeyProvider: {
      async getKey() {
        handedOut += 1;
        return handedOut === 1 ? KEY : 'a-completely-different-key';
      },
    },
  });

  const result = await service.execute(harness.job, harness.adapter);

  assert.equal(result.filesFailed, 1);
  assert.deepEqual(await fs.readdir(harness.destinationDirectory), []);
  assert.match(result.outcomes[0].message, /konnte nach dem Abholen nicht wieder geöffnet werden/);
});

test('a job written before encryption became two settings still means what it meant', async () => {
  // The old spelling: one `timing`, only meaningful while encryption was on.
  const stored = {
    ...harnessJobShape(),
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', timing: 'ON_PICKUP' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const revived = reviveJob(stored as unknown as Record<string, unknown>);

  assert.equal(revived.encryptionConfig.onPickup, true);
  assert.equal(revived.encryptionConfig.enabled, true);
  assert.equal('timing' in revived.encryptionConfig, false, 'the old spelling must not travel on');
});

test('a timing left behind by an unticked checkbox stays switched off', async () => {
  const stored = {
    ...harnessJobShape(),
    // What the editor used to leave behind: the timing was never cleared when
    // encryption was switched off, and it meant nothing while `enabled` was
    // false. Reading it as "encrypt on pickup" would start encrypting files
    // for a job that asked for none.
    encryptionConfig: { enabled: false, provider: 'NONE', timing: 'ON_PICKUP' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const revived = reviveJob(stored as unknown as Record<string, unknown>);

  assert.equal(revived.encryptionConfig.onPickup, false);
});

/** A stored job shape, minus the dates, which the revival parses itself. */
function harnessJobShape(): Record<string, unknown> {
  const { createdAt, updatedAt, ...rest } = createTransferJob();
  return rest as unknown as Record<string, unknown>;
}
