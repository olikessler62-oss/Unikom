import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { Aes256GcmEncryptionProvider } from '../../infrastructure/encryption/Aes256GcmEncryptionProvider.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferEvent } from '../transfer/TransferEvents.js';

/** Distinctive markers so a leak cannot hide in ordinary looking text. */
const SECRETS = {
  password: 'PW-MARKER-a1b2c3-NIEMALS-IM-LOG',
  privateKey: 'SSHKEY-MARKER-d4e5f6-NIEMALS-IM-LOG',
  encryptionKey: 'ENCKEY-MARKER-g7h8i9-NIEMALS-IM-LOG',
};

const CONTENT = 'customer;amount\nA;42\n';

async function scenario() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-secrets-'));
  const dataDirectory = path.join(root, 'application-data');
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');

  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), CONTENT);

  const events: TransferEvent[] = [];
  const application = createPersistentApplication(dataDirectory, {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
    events: (event) => events.push(event),
  });

  await application.credentialService.create({
    name: 'Customer A Production SFTP',
    type: 'USERNAME_PASSWORD',
    username: 'orders',
    secret: SECRETS.password,
  });
  await application.credentialService.create({
    name: 'Customer A SSH',
    type: 'SSH_PRIVATE_KEY',
    secret: SECRETS.privateKey,
  });
  const encryptionKey = await application.credentialService.create({
    name: 'Customer A Encryption Key',
    type: 'ENCRYPTION_KEY',
    secret: SECRETS.encryptionKey,
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'customer-a',
      sourceDirectory,
      destinationDirectory,
      encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: encryptionKey.id },
    })
  );

  return { root, dataDirectory, destinationDirectory, application, events, encryptionKeyId: encryptionKey.id };
}

function assertNoSecretIn(haystack: string, where: string): void {
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.equal(haystack.includes(secret), false, `the ${name} secret leaked into ${where}`);
  }
}

test('no secret reaches the event log of a transfer run', async () => {
  const { application, events } = await scenario();

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));
  assert.equal(run?.status, TransferRunStatus.SUCCESS);

  assertNoSecretIn(JSON.stringify(events), 'the event log');
  application.close();
});

test('no secret reaches the database file on disk', async () => {
  const { application, dataDirectory } = await scenario();
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  // Closing checkpoints the write-ahead log into the database file.
  application.close();

  for (const entry of await fs.readdir(dataDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const bytes = await fs.readFile(path.join(dataDirectory, entry.name));
    assertNoSecretIn(bytes.toString('binary'), entry.name);
  }
});

test('no secret reaches the persisted job, run or file records', async () => {
  const { application } = await scenario();
  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const job = await application.jobRepository.getById('customer-a');
  const files = await application.transferFileRepository.listByRun(run?.id ?? '');
  const runs = await application.runRepository.listByJob('customer-a');

  assertNoSecretIn(JSON.stringify({ job, files, runs }), 'the persisted records');
  application.close();
});

test('a failure message names the credential but not its content', async () => {
  const { application } = await scenario();

  const job = await application.jobRepository.getById('customer-a');
  await application.jobRepository.save({
    ...job!,
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'missing-credential' },
  });

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));
  assert.equal(run?.status, TransferRunStatus.FAILED);

  const [failed] = await application.transferFileRepository.listByRun(run?.id ?? '');
  assert.match(failed.errorMessage ?? '', /missing-credential/);
  assertNoSecretIn(failed.errorMessage ?? '', 'the error message');
  application.close();
});

test('the stored file is really encrypted with the credential key', async () => {
  const { root, application, destinationDirectory, encryptionKeyId } = await scenario();
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const encryptedPath = path.join(destinationDirectory, 'ORDER_001.csv.enc');
  const encrypted = await fs.readFile(encryptedPath);

  assert.equal(encrypted.includes(Buffer.from(CONTENT)), false, 'the destination must not hold readable content');
  assert.equal(await fs.access(path.join(destinationDirectory, 'ORDER_001.csv')).then(() => true, () => false), false);

  // Resolving the credential must give back exactly the key that opens it.
  const key = await application.credentialService.resolveSecret(encryptionKeyId);
  const decryptedPath = path.join(root, 'decrypted.csv');
  await new Aes256GcmEncryptionProvider().decrypt(encryptedPath, decryptedPath, key);

  assert.equal(await fs.readFile(decryptedPath, 'utf8'), CONTENT);
  application.close();
});
