import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { RemoteDirectoryService } from './RemoteDirectoryService.js';
import { FtpsSourceAdapter } from '../../infrastructure/sources/ftps/FtpsSourceAdapter.js';
import { SftpSourceAdapter } from '../../infrastructure/sources/sftp/SftpSourceAdapter.js';
import { FtpsTestServer, readTestCertificate, withFtpsRoot } from '../../testing/FtpsTestServer.js';
import { SftpTestServer, withSftpRoot } from '../../testing/SftpTestServer.js';
import type { SourceConfig } from '../../domain/transfer/TransferJob.js';

/**
 * The spec's acceptance criteria against servers that really answer.
 *
 * The resolver is tested on its own next to it; this file asks the other half
 * of the question: does a path built that way actually find the files, over
 * both protocols, and does the working directory really hold as a boundary.
 *
 * The tree below is the one from the spec.
 */

const USERNAME = 'unikom';
const PASSWORD = 'Remote-Pfade-2026';
const ORDER = 'customer;amount\nA;42\n';

const TREE = {
  'customer123/orders/incoming/ORDER_001.csv': ORDER,
  // The customer number a second time, and a subdirectory that repeats its own
  // name: both come from real servers, and both make an input ambiguous.
  'customer123/customer123/orders/DOUBLED_ROOT.csv': ORDER,
  'customer123/orders/orders/DOUBLED.csv': ORDER,
  'customer123/orders/archive/ORDER_000.csv': ORDER,
  'customer123/invoices/INVOICE_001.csv': ORDER,
  'customer1234/orders/incoming/FOREIGN.csv': 'not ours\n',
};

async function sftp(config: Partial<SourceConfig> = {}) {
  const root = await withSftpRoot(TREE);
  const server = await SftpTestServer.start({ root, username: USERNAME, password: PASSWORD });

  const sourceConfig: SourceConfig = {
    type: 'SFTP',
    directory: '/',
    host: '127.0.0.1',
    port: server.port,
    hostKeyFingerprint: server.hostKeyFingerprint,
    timeoutSeconds: 10,
    ...config,
  };

  const adapter = new SftpSourceAdapter(sourceConfig, { username: USERNAME, password: PASSWORD });

  return {
    root,
    sourceConfig,
    adapter,
    stop: async () => {
      await adapter.dispose?.();
      await server.stop();
    },
  };
}

async function ftps(config: Partial<SourceConfig> = {}) {
  const root = await withFtpsRoot(TREE);
  const server = await FtpsTestServer.start({ root, username: USERNAME, password: PASSWORD });

  const sourceConfig: SourceConfig = {
    type: 'FTPS',
    directory: '/',
    host: '127.0.0.1',
    port: server.port,
    tls: true,
    trustedCertificate: await readTestCertificate(),
    timeoutSeconds: 15,
    ...config,
  };

  const adapter = new FtpsSourceAdapter(sourceConfig, { username: USERNAME, password: PASSWORD });

  return {
    root,
    sourceConfig,
    adapter,
    stop: async () => {
      await adapter.dispose?.();
      await server.stop();
    },
  };
}

/** Both protocols answer the same questions, so both run the same tests. */
const protocols = [
  { label: 'SFTP', open: sftp },
  { label: 'FTPS', open: ftps },
];

for (const { label, open } of protocols) {
  test(`${label}: every spelling finds the same file on the server`, async () => {
    const spellings = ['orders/incoming', '/orders/incoming', '\\orders\\incoming', '/orders/incoming/', 'orders//incoming'];

    for (const spelling of spellings) {
      const { adapter, stop } = await open({ remoteWorkingDirectory: '/customer123' });

      try {
        const files = await adapter.listFiles(spelling, false);

        assert.deepEqual(
          files.filter((file) => !file.isDirectory).map((file) => file.name),
          ['ORDER_001.csv'],
          `${label} with ${JSON.stringify(spelling)}`
        );
      } finally {
        await stop();
      }
    }
  });

  test(`${label}: a relative path is read from the remote working directory`, async () => {
    // The operator never names /customer123 — it belongs to the connection.
    const { adapter, stop } = await open({ remoteWorkingDirectory: '/customer123' });

    try {
      const files = await adapter.listFiles('orders/incoming', false);

      assert.equal(files[0]?.fullPath, '/customer123/orders/incoming/ORDER_001.csv');
    } finally {
      await stop();
    }
  });

  test(`${label}: a path that leads out of the working directory is refused`, async () => {
    const { adapter, stop } = await open({ remoteWorkingDirectory: '/customer123' });

    try {
      await assert.rejects(
        () => adapter.listFiles('../customer1234/orders/incoming', false),
        /nicht verlassen/,
        'the other customer must stay unreachable'
      );
    } finally {
      await stop();
    }
  });

  test(`${label}: a directory whose name merely starts the same is not inside`, async () => {
    // /customer1234 exists on this server and holds a foreign file. A text
    // comparison would let it pass as a subdirectory of /customer123.
    const { adapter, stop } = await open({ remoteWorkingDirectory: '/customer123' });

    try {
      const files = await adapter.listFiles('/customer1234/orders/incoming', false);

      // Read as relative — so it lands inside the customer's own area, where
      // there is no such directory, rather than in the neighbour's.
      assert.deepEqual(files, [], 'nothing of the neighbour may be listed');
    } catch (error) {
      assert.match(String(error), /no such file|not found|ENOENT|550|nicht/i);
    } finally {
      await stop();
    }
  });

  test(`${label}: the browser lists the directories the server names`, async () => {
    const { adapter, sourceConfig, stop } = await open({ remoteWorkingDirectory: '/customer123' });
    const service = new RemoteDirectoryService({ forSource: async () => adapter });

    try {
      const result = await service.browse({
        name: 'Test',
        tenantId: 'default',
        sourceType: sourceConfig.type,
        sourceConfig,
        directory: '',
      });

      assert.equal(result.ok, true, result.message);
      assert.equal(result.path, '/customer123');
      assert.deepEqual(
        result.entries.map((entry) => entry.name),
        ['customer123', 'invoices', 'orders']
      );
      // What goes back into the input field is the relative spelling.
      assert.deepEqual(
        result.entries.map((entry) => entry.relativePath),
        ['customer123', 'invoices', 'orders']
      );
    } finally {
      await stop();
    }
  });

  test(`${label}: a directory that is not there is reported, not thrown`, async () => {
    const { adapter, sourceConfig, stop } = await open({ remoteWorkingDirectory: '/customer123' });
    const service = new RemoteDirectoryService({ forSource: async () => adapter });

    try {
      const result = await service.browse({
        name: 'Test',
        tenantId: 'default',
        sourceType: sourceConfig.type,
        sourceConfig,
        directory: 'orders/eingang',
      });

      assert.equal(result.ok, false);
      assert.match(result.message, /nicht gefunden/);
      // The resolved path travels with the failure, so the editor can show
      // what was actually looked for.
      assert.equal(result.path, '/customer123/orders/eingang');
    } finally {
      await stop();
    }
  });

  test(`${label}: browsing out of the allowed area is refused before a connection is opened`, async () => {
    const { adapter, sourceConfig, stop } = await open({ remoteWorkingDirectory: '/customer123' });
    const service = new RemoteDirectoryService({ forSource: async () => adapter });

    try {
      const result = await service.browse({
        name: 'Test',
        tenantId: 'default',
        sourceType: sourceConfig.type,
        sourceConfig,
        directory: '../customer1234',
      });

      assert.equal(result.ok, false);
      assert.match(result.message, /nicht verlassen/);
      assert.deepEqual(result.entries, []);
    } finally {
      await stop();
    }
  });

  test(`${label}: without a working directory the whole tree is open`, async () => {
    const { adapter, stop } = await open();

    try {
      const files = await adapter.listFiles('/customer123/orders/incoming', false);

      assert.deepEqual(
        files.map((file) => file.name),
        ['ORDER_001.csv']
      );
    } finally {
      await stop();
    }
  });
}

test('SFTP: the archive directory is resolved the same way as the source', async () => {
  const { adapter, root, stop } = await sftp({ remoteWorkingDirectory: '/customer123' });

  try {
    const [file] = await adapter.listFiles('orders/incoming', false);
    // Typed as a Windows operator would, with backslashes and no leading slash.
    await adapter.moveFile?.(file, '\\orders\\archive\\');

    assert.deepEqual((await fs.readdir(`${root}/customer123/orders/archive`)).sort(), [
      'ORDER_000.csv',
      'ORDER_001.csv',
    ]);
  } finally {
    await stop();
  }
});

/*
 * Doubled directories, the case that decides whether this is trustworthy.
 *
 * A server that carries the customer number twice — /customer123/customer123 —
 * makes "/customer123/orders" mean two directories that both exist. Choosing
 * one of them quietly would eventually move a customer's files into another
 * customer's folder, and nobody would see it happen.
 */
for (const { label, open } of protocols) {
  test(`${label}: an input that fits two existing directories is not decided alone`, async () => {
    const { adapter, sourceConfig, stop } = await open({ remoteWorkingDirectory: '/customer123' });
    const service = new RemoteDirectoryService({ forSource: async () => adapter });

    try {
      const result = await service.browse({
        name: 'Test',
        tenantId: 'default',
        sourceType: sourceConfig.type,
        sourceConfig,
        directory: '/customer123/orders',
      });

      assert.equal(result.ok, false, 'a choice that is not ours to make');
      assert.deepEqual(result.ambiguous, ['/customer123/orders', '/customer123/customer123/orders']);
      assert.match(result.message, /beide gibt/);
    } finally {
      await stop();
    }
  });

  test(`${label}: with only one of the two readings on the server, that one is the answer`, async () => {
    // Nothing doubled here: /customer123/customer123 does not exist, so the
    // second reading falls away and the first is unambiguous.
    const { adapter, sourceConfig, stop } = await open({ remoteWorkingDirectory: '/customer123' });
    const service = new RemoteDirectoryService({ forSource: async () => adapter });

    try {
      const result = await service.browse({
        name: 'Test',
        tenantId: 'default',
        sourceType: sourceConfig.type,
        sourceConfig,
        directory: '/customer123/invoices',
      });

      assert.equal(result.ok, true, result.message);
      assert.equal(result.path, '/customer123/invoices');
      assert.deepEqual(result.tried, ['/customer123/invoices', '/customer123/customer123/invoices']);
    } finally {
      await stop();
    }
  });

  test(`${label}: a doubled subdirectory is found where it really is`, async () => {
    const { adapter, stop } = await open({ remoteWorkingDirectory: '/customer123' });

    try {
      const files = await adapter.listFiles('orders/orders', false);

      assert.deepEqual(
        files.filter((file) => !file.isDirectory).map((file) => file.name),
        ['DOUBLED.csv']
      );
    } finally {
      await stop();
    }
  });
}
