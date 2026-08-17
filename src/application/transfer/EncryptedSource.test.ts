import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { noModules } from '../../domain/licensing/Feature.js';
import { FileTransferStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { Aes256GcmEncryptionProvider } from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { TransferExecutionService } from './TransferExecutionService.js';
import { TransferJobService } from './TransferJobService.js';

/**
 * The source delivers ciphertext. Written around what must not happen: a file
 * that cannot be opened must not reach the destination, a file that was meant
 * to be encrypted and is not must not slip through unnoticed, and a re-locked
 * file must not still open with the sender's key.
 */

const CONTENT = 'customer;amount\nMUELLER;42\nSCHMIDT;17\n';
const MARKER = 'MUELLER';

/** Two keys, because sender and recipient are two parties. */
const SENDER_KEY = 'the-key-the-customer-locked-it-with';
const OWN_KEY = 'the-key-our-destination-opens-with';

const keys: Record<string, string> = {
  'cred-sender': SENDER_KEY,
  'cred-own': OWN_KEY,
};

const keyProvider = {
  async getKey(credentialId?: string) {
    const key = credentialId ? keys[credentialId] : undefined;

    if (!key) {
      throw new Error(`No key for ${credentialId ?? '(none)'}`);
    }

    return key;
  },
};

const cipher = new Aes256GcmEncryptionProvider();

interface Harness {
  root: string;
  source: string;
  destination: string;
  repository: InMemoryTransferFileRepository;
  service: TransferExecutionService;
  adapter: LocalSourceAdapter;
}

async function setup(): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-encrypted-source-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'dest');

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination, { recursive: true });

  const repository = new InMemoryTransferFileRepository();

  return {
    root,
    source,
    destination,
    repository,
    service: new TransferExecutionService({
      transferFileRepository: repository,
      stagingRoot: path.join(root, 'application-data'),
      encryptionKeyProvider: keyProvider,
    }),
    adapter: new LocalSourceAdapter(source),
  };
}

/** A file as the customer delivers it: locked with their key. */
async function deliverEncrypted(harness: Harness, name = 'ORDER_001.csv.enc'): Promise<void> {
  const plain = path.join(harness.root, 'plain.csv');
  await fs.writeFile(plain, CONTENT, 'utf8');

  const result = await cipher.encrypt(plain, path.join(harness.source, name), SENDER_KEY);
  assert.ok(result.ok, result.message);
  await fs.rm(plain);
}

function jobFor(harness: Harness, overrides: Partial<TransferJob> = {}): TransferJob {
  return createTransferJob({
    id: 'job-1',
    sourceDirectory: harness.source,
    destinationDirectory: harness.destination,
    allowedExtensions: ['enc', 'csv'],
    sourceEncryption: { enabled: true, keyCredentialId: 'cred-sender' },
    ...overrides,
  });
}

test('an encrypted source is opened, and the destination holds the content', async () => {
  const harness = await setup();
  await deliverEncrypted(harness);

  const result = await harness.service.execute(jobFor(harness), harness.adapter);

  assert.equal(result.filesSucceeded, 1, result.message);
  // The envelope extension is gone with the envelope.
  assert.deepEqual(await fs.readdir(harness.destination), ['ORDER_001.csv']);
  assert.equal(await fs.readFile(path.join(harness.destination, 'ORDER_001.csv'), 'utf8'), CONTENT);
});

test('re-locking uses the destination key, and the sender key no longer opens it', async () => {
  const harness = await setup();
  await deliverEncrypted(harness);

  const result = await harness.service.execute(
    jobFor(harness, {
      encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'cred-own' },
    }),
    harness.adapter
  );

  assert.equal(result.filesSucceeded, 1, result.message);

  const [delivered] = await fs.readdir(harness.destination);
  const deliveredPath = path.join(harness.destination, delivered);

  // Nothing readable lies in the destination.
  assert.doesNotMatch(await fs.readFile(deliveredPath, 'latin1'), new RegExp(MARKER));

  const openedWithOwn = path.join(harness.root, 'with-own.csv');
  assert.ok((await cipher.decrypt(deliveredPath, openedWithOwn, OWN_KEY)).ok);
  assert.equal(await fs.readFile(openedWithOwn, 'utf8'), CONTENT);

  // A wrong key does not answer "no", it fails — the authentication tag of
  // AES-GCM does not match, and that is the point of using it.
  await assert.rejects(
    () => cipher.decrypt(deliveredPath, path.join(harness.root, 'with-sender.csv'), SENDER_KEY),
    /verändert, oder es wurde der falsche/,
    'the sender must not be able to open what was locked for the recipient'
  );

  // The envelope extension appears once, not once per hop.
  assert.equal(delivered, 'ORDER_001.csv.enc');
});

test('the checksum describes the content, not the envelope', async () => {
  const harness = await setup();
  await deliverEncrypted(harness);

  await harness.service.execute(jobFor(harness), harness.adapter);

  const [record] = await harness.repository.listByJob('job-1');
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update(CONTENT, 'utf8').digest('hex');

  // Two runs encrypt the same file to different bytes; only the content hash
  // lets duplicate detection recognise it again.
  assert.equal(record.sha256, expected);
});

test('a plaintext file in an encrypted source is refused', async () => {
  const harness = await setup();
  await fs.writeFile(path.join(harness.source, 'ORDER_002.csv'), CONTENT, 'utf8');

  const result = await harness.service.execute(jobFor(harness), harness.adapter);

  assert.equal(result.filesFailed, 1);
  assert.deepEqual(await fs.readdir(harness.destination), [], 'nothing may have been delivered');

  const [record] = await harness.repository.listByJob('job-1');
  assert.equal(record.status, FileTransferStatus.FAILED);
  assert.match(record.errorMessage ?? '', /trägt keine Verschlüsselung/);
});

test('a source that mixes may say so, and then plaintext passes', async () => {
  const harness = await setup();
  await fs.writeFile(path.join(harness.source, 'ORDER_002.csv'), CONTENT, 'utf8');

  const result = await harness.service.execute(
    jobFor(harness, {
      sourceEncryption: { enabled: true, keyCredentialId: 'cred-sender', acceptPlaintext: true },
    }),
    harness.adapter
  );

  assert.equal(result.filesSucceeded, 1, result.message);
  assert.equal(await fs.readFile(path.join(harness.destination, 'ORDER_002.csv'), 'utf8'), CONTENT);
});

test('the wrong key delivers nothing rather than something unreadable', async () => {
  const harness = await setup();
  await deliverEncrypted(harness);

  const result = await harness.service.execute(
    jobFor(harness, { sourceEncryption: { enabled: true, keyCredentialId: 'cred-own' } }),
    harness.adapter
  );

  assert.equal(result.filesFailed, 1);
  assert.deepEqual(await fs.readdir(harness.destination), []);
});

test('without the module nothing is opened', async () => {
  const harness = await setup();
  await deliverEncrypted(harness);

  const service = new TransferExecutionService({
    transferFileRepository: harness.repository,
    stagingRoot: path.join(harness.root, 'application-data'),
    encryptionKeyProvider: keyProvider,
    features: noModules(),
  });

  const result = await service.execute(jobFor(harness), harness.adapter);

  assert.equal(result.filesFailed, 1);
  assert.deepEqual(await fs.readdir(harness.destination), []);

  const [record] = await harness.repository.listByJob('job-1');
  assert.match(record.errorMessage ?? '', /Verschlüsselte Ablage/);
});

test('staging keeps nothing once the run is over', async () => {
  const harness = await setup();
  await deliverEncrypted(harness);

  await harness.service.execute(
    jobFor(harness, {
      encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'cred-own' },
    }),
    harness.adapter
  );

  const staging = path.join(harness.root, 'application-data', 'staging');
  const left = await fs.readdir(staging).catch(() => []);

  assert.deepEqual(left, [], 'the opened file must not outlive the run');
});

test('an encrypted source cannot also be encrypted while fetching', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({
          sourceEncryption: { enabled: true, keyCredentialId: 'cred-sender' },
          encryptionConfig: {
            enabled: true,
            provider: 'AES_256_GCM',
            keyCredentialId: 'cred-own',
            onPickup: true,
          },
        })
      ),
    /zweite Hülle/
  );
});

test('an encrypted source without a key is refused when it is saved', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create(createTransferJob({ sourceEncryption: { enabled: true } })),
    /braucht den Schlüssel/
  );
});
