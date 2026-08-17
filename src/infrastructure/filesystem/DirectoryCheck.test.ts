import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { checkDirectory } from './DirectoryCheck.js';

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'unikom-dircheck-'));
}

test('an existing, writable directory passes', async () => {
  const directory = await workspace();

  const result = await checkDirectory(directory);

  assert.equal(result.ok, true);
  assert.equal(result.exists, true);
  assert.equal(result.writable, true);
});

test('the probe file does not stay behind', async () => {
  const directory = await workspace();

  await checkDirectory(directory);

  // A check that litters the destination is worse than no check.
  assert.deepEqual(await fs.readdir(directory), []);
});

test('a missing directory fails unless it may be created', async () => {
  const missing = path.join(await workspace(), 'noch-nicht-da');

  const strict = await checkDirectory(missing);
  assert.equal(strict.ok, false);
  assert.match(strict.message, /gibt es nicht/);

  const lenient = await checkDirectory(missing, { createIfMissing: true });
  assert.equal(lenient.ok, true);
  assert.equal(lenient.wouldBeCreated, true);
});

test('a directory whose parent is missing cannot be created either', async () => {
  const deep = path.join(await workspace(), 'fehlt', 'auch', 'darunter');

  const result = await checkDirectory(deep, { createIfMissing: true });

  assert.equal(result.ok, false);
  assert.match(result.message, /lässt sich nicht anlegen|lässt sich also auch nicht anlegen/);
});

test('a file where a directory belongs is reported as such', async () => {
  const directory = await workspace();
  const file = path.join(directory, 'keine-mappe.txt');
  await fs.writeFile(file, 'x');

  const result = await checkDirectory(file);

  assert.equal(result.ok, false);
  assert.match(result.message, /kein Verzeichnis/);
});

test('an empty path is refused instead of checking the working directory', async () => {
  for (const candidate of ['', '   ']) {
    assert.equal((await checkDirectory(candidate)).ok, false);
  }
});

test('an unreachable share is reported, not treated as missing', async () => {
  // A UNC path to a host that does not exist. Windows answers with something
  // other than ENOENT, and the message has to stay useful either way.
  const result = await checkDirectory('\\\\unikom-gibt-es-nicht\\freigabe\\eingang');

  assert.equal(result.ok, false);
  assert.ok(result.message.length > 0);
});
