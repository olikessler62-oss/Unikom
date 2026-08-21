import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SftpSourceAdapter } from './SftpSourceAdapter.js';
import { SftpTestServer, withSftpRoot } from '../../../testing/SftpTestServer.js';
import { generateSshKeyPair, normalisePrivateKey } from '../../security/SshKeys.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';

const USERNAME = 'unikom';
const PASSWORD = 'SFTP-Passwort-2026';
const ORDER = 'customer;amount\nA;42\n';

interface Fixture {
  server: SftpTestServer;
  root: string;
  config: SourceConfig;
  adapter: SftpSourceAdapter;
  stop(): Promise<void>;
}

async function fixture(
  overrides: Partial<SourceConfig> = {},
  files: Record<string, string> = { 'ORDER_001.csv': ORDER, 'ORDER_002.csv': 'customer;amount\nB;17\n' }
): Promise<Fixture> {
  const root = await withSftpRoot(files);
  const server = await SftpTestServer.start({ root, username: USERNAME, password: PASSWORD });

  const config: SourceConfig = {
    type: 'SFTP',
    directory: '/',
    host: '127.0.0.1',
    port: server.port,
    hostKeyFingerprint: server.hostKeyFingerprint,
    timeoutSeconds: 10,
    ...overrides,
  };

  const adapter = new SftpSourceAdapter(config, { username: USERNAME, password: PASSWORD });

  return {
    server,
    root,
    config,
    adapter,
    stop: async () => {
      await adapter.dispose();
      await server.stop();
    },
  };
}

test('a connection test reports the reachable directory and its file count', async () => {
  const { adapter, stop } = await fixture();

  const result = await adapter.testConnection();

  assert.equal(result.ok, true);
  assert.equal(result.filesFound, 2);
  await stop();
});

test('listing returns files with size and modification time', async () => {
  const { adapter, stop } = await fixture();

  const files = await adapter.listFiles('/');
  const order = files.find((file) => file.name === 'ORDER_001.csv');

  assert.equal(files.filter((file) => !file.isDirectory).length, 2);
  assert.equal(order?.size, Buffer.byteLength(ORDER));
  assert.ok(order?.lastModified instanceof Date);
  assert.ok((order?.lastModified?.getTime() ?? 0) > 0);
  await stop();
});

test('was in einem Unterverzeichnis liegt, wird nicht mitgelesen', async () => {
  // Das Unterverzeichnis selbst steht in der Liste — der Verzeichnisbrowser
  // blättert damit. Sein Inhalt gehört nicht dazu: Ein Verzeichnis ist die
  // Abmachung mit dem Absender, und was er daneben ablegt, geht diesen Workflow
  // nichts an.
  const { adapter, stop } = await fixture({}, { 'ORDER_001.csv': ORDER, 'sub/ORDER_009.csv': ORDER });

  const gelesen = await adapter.listFiles('/');

  assert.deepEqual(
    gelesen.filter((file) => !file.isDirectory).map((file) => file.name),
    ['ORDER_001.csv']
  );
  assert.ok(
    gelesen.some((file) => file.isDirectory && file.name === 'sub'),
    'das Unterverzeichnis selbst bleibt sichtbar'
  );
  await stop();
});

test('a download reproduces the file byte for byte', async () => {
  const { adapter, stop } = await fixture();
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-sftp-dl-')), 'ORDER_001.csv');

  const result = await adapter.downloadFile(
    { name: 'ORDER_001.csv', fullPath: '/ORDER_001.csv', isDirectory: false },
    target
  );

  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(target, 'utf8'), ORDER);
  await stop();
});

test('a larger file survives the transfer intact', async () => {
  const payload = crypto.randomBytes(512 * 1024).toString('base64');
  const { adapter, stop } = await fixture({}, { 'ORDER_BIG.csv': payload });
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-sftp-big-')), 'ORDER_BIG.csv');

  await adapter.downloadFile({ name: 'ORDER_BIG.csv', fullPath: '/ORDER_BIG.csv', isDirectory: false }, target);

  assert.equal(await fs.readFile(target, 'utf8'), payload);
  await stop();
});

test('the source file can be archived and deleted', async () => {
  const { adapter, root, stop } = await fixture();
  const file = { name: 'ORDER_001.csv', fullPath: '/ORDER_001.csv', isDirectory: false };

  await adapter.moveFile(file, '/archive');
  assert.equal(await fs.readFile(path.join(root, 'archive', 'ORDER_001.csv'), 'utf8'), ORDER);

  await adapter.deleteFile({ name: 'ORDER_002.csv', fullPath: '/ORDER_002.csv', isDirectory: false });
  assert.equal(await fs.access(path.join(root, 'ORDER_002.csv')).then(() => true, () => false), false);
  await stop();
});

test('a host key that does not match the pinned fingerprint is refused', async () => {
  const { server, config, stop } = await fixture();
  const wrongFingerprint = `SHA256:${crypto.randomBytes(32).toString('base64').replace(/=+$/, '')}`;
  const adapter = new SftpSourceAdapter(
    { ...config, hostKeyFingerprint: wrongFingerprint },
    { username: USERNAME, password: PASSWORD }
  );

  const result = await adapter.testConnection();

  assert.equal(result.ok, false);
  assert.match(result.message, /stimmt nicht mit dem hinterlegten Fingerabdruck/);
  assert.match(result.message, /Verbindung wurde abgelehnt/);
  await adapter.dispose();
  await stop();
  void server;
});

test('without a pinned fingerprint the connection is refused, not silently trusted', async () => {
  const { config, stop } = await fixture();
  const adapter = new SftpSourceAdapter(
    { ...config, hostKeyFingerprint: undefined },
    { username: USERNAME, password: PASSWORD }
  );

  const result = await adapter.testConnection();

  assert.equal(result.ok, false);
  assert.match(result.message, /ist kein SSH-Hostkey-Fingerabdruck hinterlegt/);
  // The message must show the actual fingerprint so it can be pinned.
  assert.match(result.message, /SHA256:/);
  await adapter.dispose();
  await stop();
});

test('host key verification can be waived deliberately', async () => {
  const { config, stop } = await fixture();
  const adapter = new SftpSourceAdapter(
    { ...config, hostKeyFingerprint: undefined, allowUnknownHostKey: true },
    { username: USERNAME, password: PASSWORD }
  );

  assert.equal((await adapter.testConnection()).ok, true);
  await adapter.dispose();
  await stop();
});

test('a wrong password fails without echoing the password', async () => {
  const { config, stop } = await fixture();
  const adapter = new SftpSourceAdapter(config, { username: USERNAME, password: 'falsches-passwort' });

  const result = await adapter.testConnection();

  assert.equal(result.ok, false);
  assert.equal(result.message.includes('falsches-passwort'), false);
  await adapter.dispose();
  await stop();
});

test('authentication with an SSH private key works', async () => {
  // ssh2 reads PKCS#1 ("BEGIN RSA PRIVATE KEY"), not PKCS#8.
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const root = await withSftpRoot({ 'ORDER_001.csv': ORDER });
  const server = await SftpTestServer.start({ root, username: USERNAME, authorizedKey: privateKey });

  const adapter = new SftpSourceAdapter(
    {
      type: 'SFTP',
      directory: '/',
      host: '127.0.0.1',
      port: server.port,
      hostKeyFingerprint: server.hostKeyFingerprint,
      timeoutSeconds: 10,
    },
    { username: USERNAME, privateKey }
  );

  const result = await adapter.testConnection();

  assert.equal(result.ok, true, result.message);
  assert.equal(result.filesFound, 1);
  await adapter.dispose();
  await server.stop();
});

test('a missing host is reported instead of attempted', async () => {
  const adapter = new SftpSourceAdapter({ type: 'SFTP', directory: '/' });

  assert.match((await adapter.testConnection()).message, /kein Server eingetragen/);
});

/*
 * The two roads a key takes into the installation, each proven against a real
 * server rather than against the parser alone. A key that parses but cannot log
 * in would be the worst kind of pass: green here, dark at three in the morning.
 */

test('a key pair generated by Unikom logs in at the source', async () => {
  const pair = await generateSshKeyPair('unikom');

  const root = await withSftpRoot({ 'ORDER_001.csv': ORDER });
  const server = await SftpTestServer.start({ root, username: USERNAME, authorizedKey: pair.privateKey });

  const adapter = new SftpSourceAdapter(
    {
      type: 'SFTP',
      directory: '/',
      host: '127.0.0.1',
      port: server.port,
      hostKeyFingerprint: server.hostKeyFingerprint,
      timeoutSeconds: 10,
    },
    { username: USERNAME, privateKey: pair.privateKey }
  );

  const result = await adapter.testConnection();

  assert.equal(result.ok, true, result.message);
  assert.equal(result.filesFound, 1);
  await adapter.dispose();
  await server.stop();
});

test('a passphrase-protected key logs in once it has been normalised', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'sehr geheim' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  // What the credential service stores: opened once, kept without the passphrase.
  const stored = normalisePrivateKey(privateKey, 'sehr geheim');

  const root = await withSftpRoot({ 'ORDER_001.csv': ORDER });
  const server = await SftpTestServer.start({ root, username: USERNAME, authorizedKey: stored.privateKey });

  const adapter = new SftpSourceAdapter(
    {
      type: 'SFTP',
      directory: '/',
      host: '127.0.0.1',
      port: server.port,
      hostKeyFingerprint: server.hostKeyFingerprint,
      timeoutSeconds: 10,
    },
    { username: USERNAME, privateKey: stored.privateKey }
  );

  const result = await adapter.testConnection();

  assert.equal(result.ok, true, result.message);
  await adapter.dispose();
  await server.stop();
});
