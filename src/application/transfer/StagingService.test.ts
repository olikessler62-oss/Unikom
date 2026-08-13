import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StagingService } from './StagingService.js';
import { UnsafeFilenameError } from '../../infrastructure/filesystem/SafePath.js';

const service = new StagingService();

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'unikom-staging-'));
}

test('the staging directory is created per run below the staging root', async () => {
  const root = await tempRoot();
  const stagingDirectory = await service.prepareStagingDirectory(root, 'TR-007');

  assert.equal(stagingDirectory, path.join(root, 'staging', 'TR-007'));
  assert.equal((await fs.stat(stagingDirectory)).isDirectory(), true);
});

test('downloads are staged under a .part name', async () => {
  const root = await tempRoot();
  const stagingDirectory = await service.prepareStagingDirectory(root, 'TR-008');
  const stagedPath = service.stagedPathFor(stagingDirectory, 'ORDER_001.csv', 'file-1');

  assert.equal(stagedPath, path.join(stagingDirectory, 'file-1-ORDER_001.csv.part'));
});

test('equally named files from different directories do not collide', async () => {
  const root = await tempRoot();
  const stagingDirectory = await service.prepareStagingDirectory(root, 'TR-008b');

  const first = service.stagedPathFor(stagingDirectory, 'ORDER_001.csv', 'file-1');
  const second = service.stagedPathFor(stagingDirectory, 'ORDER_001.csv', 'file-2');

  assert.notEqual(first, second, 'two staged files must never share a path');
});

test('a remote name cannot stage outside the staging directory', async () => {
  const root = await tempRoot();
  const stagingDirectory = await service.prepareStagingDirectory(root, 'TR-009');

  assert.throws(() => service.stagedPathFor(stagingDirectory, '../../escaped.csv', 'file-1'), UnsafeFilenameError);
  assert.throws(() => service.stagedPathFor(stagingDirectory, 'sub\\escaped.csv', 'file-1'), UnsafeFilenameError);
});

test('a staged file is moved to its final path', async () => {
  const root = await tempRoot();
  const stagingDirectory = await service.prepareStagingDirectory(root, 'TR-010');
  const stagedPath = service.stagedPathFor(stagingDirectory, 'ORDER_001.csv', 'file-1');
  const finalPath = path.join(root, 'dest', 'ORDER_001.csv');

  await fs.writeFile(stagedPath, 'customer;amount\nA;42\n');
  await service.moveToFinalPath(stagedPath, finalPath);

  assert.equal((await fs.stat(finalPath)).size > 0, true);
  assert.equal(await fs.access(stagedPath).then(() => true, () => false), false);
});

test('cleanup removes the whole staging directory', async () => {
  const root = await tempRoot();
  const stagingDirectory = await service.prepareStagingDirectory(root, 'TR-011');
  await fs.writeFile(path.join(stagingDirectory, 'leftover.part'), 'x');

  await service.cleanup(stagingDirectory);

  assert.equal(await fs.access(stagingDirectory).then(() => true, () => false), false);
});
