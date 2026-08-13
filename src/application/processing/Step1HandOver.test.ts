import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInMemoryApplication, type UnikomApplication } from '../runtime/UnikomApplication.js';
import type { FileProcessingContext } from '../../domain/processing/FileProcessingContext.js';
import type { ProcessingStage } from '../../domain/processing/ProcessingStage.js';
import type { TransferEvent } from '../transfer/TransferEvents.js';
import { FileTransferStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';

const ORDER = 'customer;amount\nA;42\n';

interface Harness {
  application: UnikomApplication;
  sourceDirectory: string;
  destinationDirectory: string;
  events: TransferEvent[];
  handedOver: FileProcessingContext[];
}

async function setup(jobOverrides = {}): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-handover-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), ORDER);

  const events: TransferEvent[] = [];
  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    events: (event) => events.push(event),
    encryptionKeyProvider: { getKey: async () => 'a-passphrase-for-the-test' },
  });

  await application.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory, ...jobOverrides })
  );

  return { application, sourceDirectory, destinationDirectory, events, handedOver: [] };
}

function recordingStage(harness: Harness): ProcessingStage {
  return {
    name: 'recording',
    requiredFeature: 'STEP_2_CONSOLIDATION',
    process: async (context) => {
      harness.handedOver.push(context);
      return context;
    },
  };
}

async function sha256Of(target: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(target)).digest('hex');
}

test('step 1 hands over a context that describes the file it actually stored', async () => {
  const harness = await setup();
  harness.application.processingStages.register(recordingStage(harness));

  await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  assert.equal(harness.handedOver.length, 1);
  const context = harness.handedOver[0];

  assert.equal(context.jobId, 'customer-a');
  assert.ok(context.runId.startsWith('TR-'));
  assert.equal(context.originalFilename, 'ORDER_001.csv');
  assert.equal(context.currentFilename, 'ORDER_001.csv');
  assert.equal(context.encrypted, false);
  assert.deepEqual(context.metadata, {});

  // The point of the contract: the next stage can open the file it was told
  // about, and the hash and size it was given belong to that very file.
  assert.equal(context.currentFilePath, path.join(harness.destinationDirectory, 'ORDER_001.csv'));
  assert.equal(context.finalDestinationPath, context.currentFilePath);
  assert.equal(await fs.readFile(context.currentFilePath, 'utf8'), ORDER);
  assert.equal(context.sha256, await sha256Of(context.currentFilePath));
  assert.equal(context.fileSize, (await fs.stat(context.currentFilePath)).size);
});

test('an encrypted file is handed over as encrypted, under its stored name', async () => {
  const harness = await setup({
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'key-1' },
  });
  harness.application.processingStages.register(recordingStage(harness));

  await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());
  const context = harness.handedOver[0];

  assert.equal(context.encrypted, true);
  assert.equal(context.currentFilename, 'ORDER_001.csv.enc');
  assert.equal(context.originalFilename, 'ORDER_001.csv');

  // The checksum identifies the content, not the stored bytes: it is the hash
  // of the plaintext, which is what duplicate detection compares against.
  assert.equal(context.sha256, createHash('sha256').update(ORDER).digest('hex'));
  assert.notEqual(context.sha256, await sha256Of(context.currentFilePath));

  // The staging path is documentation, not a location to read from.
  assert.equal(await fs.access(context.temporaryPath).then(() => true, () => false), false);
});

test('nothing is handed over for a file that failed step 1', async () => {
  const harness = await setup({ encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'x' } });
  harness.application.processingStages.register(recordingStage(harness));

  // No key provider that can serve "x" - encryption fails, so does the file.
  const broken = createInMemoryApplication({
    stagingRoot: path.join(harness.destinationDirectory, '..', 'application-data'),
    encryptionKeyProvider: {
      getKey: async () => {
        throw new Error('key unavailable');
      },
    },
  });
  broken.processingStages.register(recordingStage(harness));
  await broken.jobRepository.save((await harness.application.jobRepository.getById('customer-a'))!);

  await broken.runtime.orchestrator.runJobNow('customer-a', new Date());

  assert.equal(harness.handedOver.length, 0);
});

test('a failing stage is reported but leaves step 1 intact', async () => {
  const harness = await setup({ sourceSuccessAction: 'DELETE' });
  harness.application.processingStages.register({
    name: 'consolidation',
    requiredFeature: 'STEP_2_CONSOLIDATION',
    process: async () => {
      throw new Error('column "amount" is missing');
    },
  });

  const run = await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  // Step 1 succeeded and stays succeeded: the file is stored, registered, and
  // the source file is already gone. Failing the run would invite a retry of a
  // transfer that went perfectly well.
  const [record] = await harness.application.transferFileRepository.listByJob('customer-a');
  assert.equal(record.status, FileTransferStatus.SUCCESS);
  assert.equal(run?.filesSucceeded, 1);
  assert.equal(await fs.readFile(path.join(harness.destinationDirectory, 'ORDER_001.csv'), 'utf8'), ORDER);
  assert.equal(
    await fs.access(path.join(harness.sourceDirectory, 'ORDER_001.csv')).then(() => true, () => false),
    false
  );

  // But it must not disappear either.
  const failure = harness.events.find((event) => event.name === 'PROCESSING_STAGE_FAILED');
  assert.ok(failure, 'a failed stage has to be visible');
  assert.equal(failure?.details?.stage, 'consolidation');
  assert.match(failure?.message ?? '', /column "amount" is missing/);

  const logs = await harness.application.logRepository.list({ runId: run?.id });
  assert.ok(logs.some((entry) => entry.level === 'ERROR' && /consolidation/.test(entry.message)));
});

test('without registered stages the base product behaves exactly as before', async () => {
  const harness = await setup();

  const run = await harness.application.runtime.orchestrator.runJobNow('customer-a', new Date());

  assert.equal(run?.filesSucceeded, 1);
  assert.equal(harness.application.processingStages.isEmpty, true);
  assert.equal(
    harness.events.some((event) => event.name.startsWith('PROCESSING_STAGE_')),
    false
  );
});
