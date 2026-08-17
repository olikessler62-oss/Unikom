import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LocalSourceAdapter } from './LocalSourceAdapter.js';
import { SourceAdapterFactory } from '../SourceAdapterFactory.js';

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'unikom-local-'));
}

test('a readable directory is reported with the number of files in it', async () => {
  const directory = await workspace();
  await fs.writeFile(path.join(directory, 'ORDER_001.csv'), 'a');
  await fs.writeFile(path.join(directory, 'ORDER_002.csv'), 'b');
  await fs.mkdir(path.join(directory, 'unterordner'));

  const result = await new LocalSourceAdapter(directory).testConnection();

  assert.equal(result.ok, true);
  // Directories are not files; the count is what could be picked up.
  assert.equal(result.filesFound, 2);
});

test('a directory that does not exist is reported as a failure', async () => {
  const missing = path.join(await workspace(), 'gibtsnicht');

  const result = await new LocalSourceAdapter(missing).testConnection();

  // This used to answer "successful" without looking, which is the worst
  // possible answer for a button labelled "test connection".
  assert.equal(result.ok, false);
  assert.match(result.message, /gibt es nicht/);
});

test('a file instead of a directory is reported as a failure', async () => {
  const directory = await workspace();
  const file = path.join(directory, 'keine-mappe.txt');
  await fs.writeFile(file, 'x');

  const result = await new LocalSourceAdapter(file).testConnection();

  assert.equal(result.ok, false);
  assert.match(result.message, /kein Verzeichnis/);
});

test('without a configured directory the test says so instead of passing', async () => {
  const result = await new LocalSourceAdapter().testConnection();

  assert.equal(result.ok, false);
});

test('the factory hands the directory to the adapter', async () => {
  const missing = path.join(await workspace(), 'auch-nicht-da');
  const adapter = SourceAdapterFactory.create({ type: 'LOCAL', directory: missing });

  assert.equal((await adapter.testConnection()).ok, false);
});
