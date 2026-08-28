import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistentApplication } from '../runtime/UnikomApplication.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferEvent } from './TransferEvents.js';

const USERNAME = 'unikom';
const PASSWORD = 'SFTP-Passwort-2026';
const ORDER = 'customer;amount\nA;42\n';

async function scenario(files: Record<string, string> = { 'exports/orders/ORDER_001.csv': ORDER }) {
  const root = await withSftpRoot(files);
  const server = await SftpTestServer.start({ root, username: USERNAME, password: PASSWORD });

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-remote-'));
  const dataDirectory = path.join(workspace, 'application-data');
  const destinationDirectory = path.join(workspace, 'incoming');

  const events: TransferEvent[] = [];
  const application = createPersistentApplication(dataDirectory, {
    masterKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
    events: (event) => events.push(event),
  });

  const credential = await application.credentialService.create({
    name: 'Customer A Production SFTP',
    type: 'USERNAME_PASSWORD',
    username: USERNAME,
    secret: PASSWORD,
  });

  await application.jobRepository.save(
    createTransferJob({
      id: 'customer-a',
      name: 'Kunde A - Bestellungen',
      sourceType: 'SFTP',
      sourceConfig: {
        type: 'SFTP',
        directory: '/exports/orders',
        host: '127.0.0.1',
        port: server.port,
        hostKeyFingerprint: server.hostKeyFingerprint,
        timeoutSeconds: 10,
      },
      credentialId: credential.id,
      sourceDirectory: '/exports/orders',
      destinationDirectory,
    })
  );

  return {
    root,
    server,
    application,
    events,
    destinationDirectory,
    stop: async () => {
      application.close();
      await server.stop();
    },
  };
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

test('a file is taken over from a real SFTP server end to end', async () => {
  const { application, events, destinationDirectory, stop } = await scenario();

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  assert.equal(run?.status, TransferRunStatus.SUCCESS, JSON.stringify(events.slice(-3)));
  assert.equal(run?.filesSucceeded, 1);
  assert.equal(await fs.readFile(path.join(destinationDirectory, 'ORDER_001.csv'), 'utf8'), ORDER);
  assert.ok(events.some((event) => event.name === 'STEP_1_COMPLETED'));
  await stop();
});

test('the transfer is registered with its hash and survives a restart', async () => {
  const { application, destinationDirectory, stop } = await scenario();
  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const [registered] = await application.transferFileRepository.listByRun(run?.id ?? '');
  assert.equal(registered.sha256?.length, 64);
  assert.equal(registered.destinationFilename, 'ORDER_001.csv');

  // Second run of a fresh process: the file must not be fetched twice.
  const second = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T07:00:00.000Z'));
  assert.equal(second?.filesSucceeded, 0);
  assert.equal(second?.filesSkipped, 1);
  assert.equal((await fs.readdir(destinationDirectory)).length, 1);
  await stop();
});

test('the remote source file is archived only after a complete success', async () => {
  const { application, root, stop } = await scenario();

  const job = await application.jobRepository.getById('customer-a');
  await application.jobRepository.save({
    ...job!,
    sourceSuccessAction: 'MOVE',
    sourceArchiveDirectory: '/exports/archive',
  });

  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  assert.equal(await exists(path.join(root, 'exports', 'orders', 'ORDER_001.csv')), false);
  assert.equal(await fs.readFile(path.join(root, 'exports', 'archive', 'ORDER_001.csv'), 'utf8'), ORDER);
  await stop();
});

test('filters apply to a remote source exactly as they do locally', async () => {
  const { application, destinationDirectory, stop } = await scenario({
    'exports/orders/ORDER_001.csv': ORDER,
    'exports/orders/ORDER_002.csv': 'customer;amount\nB;17\n',
    'exports/orders/INVOICE_001.csv': 'wrong prefix',
    'exports/orders/ORDER_003.csv.part': 'still uploading',
    'exports/orders/ORDER_004.xlsx': 'wrong extension',
  });

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  assert.equal(run?.filesFound, 5);
  assert.equal(run?.filesSucceeded, 2);
  assert.deepEqual((await fs.readdir(destinationDirectory)).sort(), ['ORDER_001.csv', 'ORDER_002.csv']);
  await stop();
});

test('a wrong credential fails the run without leaking the password', async () => {
  const { application, stop } = await scenario();

  const credentials = await application.credentialService.list();
  await application.credentialService.replaceSecret(credentials[0].id, 'falsches-passwort');

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  assert.equal(run?.status, TransferRunStatus.FAILED);
  const history = await application.runRepository.listByJob('customer-a');
  assert.equal(JSON.stringify(history).includes('falsches-passwort'), false);
  await stop();
});

test('a job whose credential was deleted fails with a clear message', async () => {
  const { application, stop } = await scenario();

  const credentials = await application.credentialService.list();
  await application.credentialService.delete(credentials[0].id);

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  assert.equal(run?.status, TransferRunStatus.FAILED);
  await stop();
});
