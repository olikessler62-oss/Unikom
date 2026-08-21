import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FtpsSourceAdapter } from './FtpsSourceAdapter.js';
import { FtpsTestServer, readTestCertificate, withFtpsRoot } from '../../../testing/FtpsTestServer.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';

const USERNAME = 'unikom';
const PASSWORD = 'FTPS-Passwort-2026';
const ORDER = 'customer;amount\nA;42\n';

interface Fixture {
  server: FtpsTestServer;
  root: string;
  config: SourceConfig;
  adapter: FtpsSourceAdapter;
  stop(): Promise<void>;
}

async function fixture(
  overrides: Partial<SourceConfig> = {},
  files: Record<string, string> = { 'ORDER_001.csv': ORDER, 'ORDER_002.csv': 'customer;amount\nB;17\n' }
): Promise<Fixture> {
  const root = await withFtpsRoot(files);
  const server = await FtpsTestServer.start({ root, username: USERNAME, password: PASSWORD });

  const config: SourceConfig = {
    type: 'FTPS',
    directory: '/',
    host: '127.0.0.1',
    port: server.port,
    tls: true,
    trustedCertificate: await readTestCertificate(),
    timeoutSeconds: 15,
    ...overrides,
  };

  const adapter = new FtpsSourceAdapter(config, { username: USERNAME, password: PASSWORD });

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

test('an explicit FTPS connection is established and the directory is readable', async () => {
  const { adapter, stop } = await fixture();

  const result = await adapter.testConnection();

  assert.equal(result.ok, true, result.message);
  assert.equal(result.filesFound, 2);
  await stop();
});

test('listing returns files with size and modification time', async () => {
  const { adapter, stop } = await fixture();

  const files = await adapter.listFiles('/');
  const order = files.find((file) => file.name === 'ORDER_001.csv');

  assert.equal(order?.size, Buffer.byteLength(ORDER));
  assert.ok(order?.lastModified instanceof Date, 'the minimum age rule needs a timestamp');
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
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ftps-dl-')), 'ORDER_001.csv');

  const result = await adapter.downloadFile(
    { name: 'ORDER_001.csv', fullPath: '/ORDER_001.csv', isDirectory: false },
    target
  );

  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(target, 'utf8'), ORDER);
  await stop();
});

test('the source file can be archived and deleted', async () => {
  const { adapter, root, stop } = await fixture();

  await adapter.moveFile({ name: 'ORDER_001.csv', fullPath: '/ORDER_001.csv', isDirectory: false }, '/archive');
  assert.equal(await fs.readFile(path.join(root, 'archive', 'ORDER_001.csv'), 'utf8'), ORDER);

  await adapter.deleteFile({ name: 'ORDER_002.csv', fullPath: '/ORDER_002.csv', isDirectory: false });
  assert.equal(await fs.access(path.join(root, 'ORDER_002.csv')).then(() => true, () => false), false);
  await stop();
});

test('an untrusted certificate is refused by default', async () => {
  const { config, stop } = await fixture();
  // No trusted certificate configured, so the self-signed one must not pass.
  const adapter = new FtpsSourceAdapter(
    { ...config, trustedCertificate: undefined },
    { username: USERNAME, password: PASSWORD }
  );

  const result = await adapter.testConnection();

  assert.equal(result.ok, false, 'a self-signed certificate must not be accepted silently');
  assert.match(result.message, /certificate|self.signed|SELF_SIGNED/i);
  await adapter.dispose();
  await stop();
});

test('certificate validation can be waived deliberately', async () => {
  const { config, stop } = await fixture();
  const adapter = new FtpsSourceAdapter(
    { ...config, trustedCertificate: undefined, validateCertificates: false },
    { username: USERNAME, password: PASSWORD }
  );

  assert.equal((await adapter.testConnection()).ok, true);
  await adapter.dispose();
  await stop();
});

test('wrong credentials fail without echoing the password', async () => {
  const { config, stop } = await fixture();
  const adapter = new FtpsSourceAdapter(config, { username: USERNAME, password: 'falsches-passwort' });

  const result = await adapter.testConnection();

  assert.equal(result.ok, false);
  assert.equal(result.message.includes('falsches-passwort'), false);
  await adapter.dispose();
  await stop();
});

test('a missing host is reported instead of attempted', async () => {
  const adapter = new FtpsSourceAdapter({ type: 'FTPS', directory: '/' });

  assert.match((await adapter.testConnection()).message, /kein Server eingetragen/);
});
