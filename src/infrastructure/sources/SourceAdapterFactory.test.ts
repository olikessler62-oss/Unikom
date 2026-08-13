import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceAdapterFactory } from './SourceAdapterFactory.js';
import { LocalSourceAdapter } from './local/LocalSourceAdapter.js';
import { SftpSourceAdapter } from './sftp/SftpSourceAdapter.js';
import { FtpsSourceAdapter } from './ftps/FtpsSourceAdapter.js';

test('factory returns the matching adapter for each supported source type', () => {
  const local = SourceAdapterFactory.create({ type: 'LOCAL', directory: 'C:/Import' });
  const sftp = SourceAdapterFactory.create({ type: 'SFTP', directory: '/exports/orders', host: 'example.com', port: 22, username: 'demo' });
  const ftps = SourceAdapterFactory.create({ type: 'FTPS', directory: '/exports/orders', host: 'example.com', port: 990, username: 'demo', tls: true, validateCertificates: true });

  assert.ok(local instanceof LocalSourceAdapter);
  assert.ok(sftp instanceof SftpSourceAdapter);
  assert.ok(ftps instanceof FtpsSourceAdapter);
});
