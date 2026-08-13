import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInMemoryApplication, type UnikomApplication } from '../../runtime/UnikomApplication.js';
import { coreOnly, StaticFeatureSet } from '../../../domain/licensing/Feature.js';
import type { FileProcessingContext } from '../../../domain/processing/FileProcessingContext.js';
import type { ProcessingStage } from '../../../domain/processing/ProcessingStage.js';
import { ProcessingStageRegistry } from '../ProcessingStageRegistry.js';
import { DecryptForProcessingStage } from './DecryptForProcessingStage.js';
import { EncryptResultStage } from './EncryptResultStage.js';
import { createTransferJob } from '../../../testing/TransferJobFixture.js';
import { FileTransferStatus } from '../../../domain/transfer/TransferRun.js';

const ORDER = 'customer;amount\nA;42\n';
const JOB_KEY = 'the-key-of-the-source-job';
const DESTINATION_KEY = 'the-key-of-the-receiving-partner';

/** Serves a different key per credential, the way credentials really behave. */
const keyProvider = {
  getKey: async (credentialId: string | undefined) => {
    if (credentialId === 'job-key') return JOB_KEY;
    if (credentialId === 'destination-key') return DESTINATION_KEY;
    throw new Error(`no key for ${credentialId}`);
  },
};

interface Harness {
  application: UnikomApplication;
  root: string;
  sourceDirectory: string;
  destinationDirectory: string;
  seen: FileProcessingContext[];
  /** What the stage could actually read, captured while staging still exists. */
  readable: string[];
}

async function setup(encrypted = true): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-crypto-stage-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), ORDER);

  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    encryptionKeyProvider: keyProvider,
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'customer-a',
      sourceDirectory,
      destinationDirectory,
      encryptionConfig: encrypted
        ? { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'job-key' }
        : { enabled: false, provider: 'NONE' },
    })
  );

  return { application, root, sourceDirectory, destinationDirectory, seen: [], readable: [] };
}

function observer(harness: Harness): ProcessingStage {
  return {
    name: 'observer',
    requiredFeature: 'STEP_2_CONSOLIDATION',
    process: async (context) => {
      harness.seen.push(context);
      // Reading has to happen here: staging is gone once the run has finished.
      harness.readable.push(await fs.readFile(context.currentFilePath, 'utf8'));
      return context;
    },
  };
}

function decryptStage(harness: Harness): DecryptForProcessingStage {
  return new DecryptForProcessingStage(harness.application.jobRepository, keyProvider);
}

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

test('step 2 receives readable content although the file is stored encrypted', async () => {
  const harness = await setup();
  harness.application.processingStages.register(decryptStage(harness));
  harness.application.processingStages.register(observer(harness));

  await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const [context] = harness.seen;
  assert.equal(context.encrypted, false);
  assert.equal(context.currentFilename, 'ORDER_001.csv');
  assert.equal(harness.readable[0], ORDER);
  // The checksum still identifies the content, so it now matches the file too.
  assert.equal(context.sha256, createHash('sha256').update(ORDER).digest('hex'));
});

test('the destination keeps only the encrypted file, and no plaintext survives the run', async () => {
  const harness = await setup();
  harness.application.processingStages.register(decryptStage(harness));
  harness.application.processingStages.register(observer(harness));

  await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  // What step 1 stored is untouched: still encrypted, still the only file there.
  assert.deepEqual(await fs.readdir(harness.destinationDirectory), ['ORDER_001.csv.enc']);

  // The stage really did read the plaintext during the run...
  assert.equal(harness.readable[0], ORDER);

  // ...and it is gone with the staging area it lived in. This is the promise
  // the encryption module makes: nothing we store lies around in the clear.
  // The customer's own source file is not ours to remove and stays out of it.
  assert.equal(
    await fs.access(harness.seen[0].currentFilePath).then(() => true, () => false),
    false
  );

  for (const file of [...(await walk(harness.destinationDirectory)), ...(await walk(path.join(harness.root, 'application-data')))]) {
    assert.notEqual(await fs.readFile(file, 'utf8').catch(() => ''), ORDER, `${file} still holds the plaintext`);
  }
});

test('an unencrypted file passes the decryption stage untouched', async () => {
  const harness = await setup(false);
  harness.application.processingStages.register(decryptStage(harness));
  harness.application.processingStages.register(observer(harness));

  await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const [context] = harness.seen;
  assert.equal(context.encrypted, false);
  assert.equal(context.currentFilePath, path.join(harness.destinationDirectory, 'ORDER_001.csv'));
});

test('the result is re-encrypted with the destination key, not the job key', async () => {
  const harness = await setup();
  harness.application.processingStages.register(decryptStage(harness));
  harness.application.processingStages.register(observer(harness));
  harness.application.processingStages.register(new EncryptResultStage('destination-key', keyProvider));
  const delivered: FileProcessingContext[] = [];
  harness.application.processingStages.register({
    name: 'delivery',
    requiredFeature: 'STEP_3_FILE_EXPORT',
    process: async (context) => {
      // Copy it out before staging is cleared, standing in for an upload.
      await fs.copyFile(context.currentFilePath, path.join(harness.root, context.currentFilename));
      delivered.push(context);
      return context;
    },
  });

  await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const [context] = delivered;
  assert.equal(context.encrypted, true);
  assert.equal(context.currentFilename, 'ORDER_001.csv.enc');

  const handedOver = path.join(harness.root, 'ORDER_001.csv.enc');
  const provider = new (await import('../../../infrastructure/encryption/Aes256GcmEncryptionProvider.js'))
    .Aes256GcmEncryptionProvider();

  // The recipient can open it with their own key...
  const opened = path.join(harness.root, 'opened.csv');
  await provider.decrypt(handedOver, opened, DESTINATION_KEY);
  assert.equal(await fs.readFile(opened, 'utf8'), ORDER);

  // ...and the source job's key does not open it.
  await assert.rejects(() => provider.decrypt(handedOver, path.join(harness.root, 'wrong.csv'), JOB_KEY));
});

test('a wrong job key is reported instead of yielding unusable content', async () => {
  const harness = await setup();
  harness.application.processingStages.register(
    new DecryptForProcessingStage(harness.application.jobRepository, {
      getKey: async () => 'a-key-that-was-never-used-for-this-file',
    })
  );
  harness.application.processingStages.register(observer(harness));

  const run = await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  assert.equal(harness.seen.length, 0, 'the following stages must not run on content nobody could read');

  // Step 1 stays valid - the file is stored and registered, only the chain
  // behind it could not continue.
  const [record] = await harness.application.transferFileRepository.listByJob('customer-a');
  assert.equal(record.status, FileTransferStatus.SUCCESS);

  const logs = await harness.application.logRepository.list({ runId: run?.id });
  assert.ok(
    logs.some((entry) => entry.level === 'ERROR' && /decrypt-for-processing/.test(entry.message)),
    'a failed decryption has to be visible'
  );
});

test('decryption needs the encryption module', () => {
  const withoutEncryption = new ProcessingStageRegistry(new StaticFeatureSet(['STEP_2_CONSOLIDATION']));
  const application = createInMemoryApplication();

  assert.equal(
    withoutEncryption.register(new DecryptForProcessingStage(application.jobRepository, keyProvider)),
    false
  );
  assert.equal(
    new ProcessingStageRegistry(coreOnly()).register(new EncryptResultStage('destination-key', keyProvider)),
    false
  );
});
