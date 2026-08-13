import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonFileStore, optionalDate, requiredDate } from './JsonFileStore.js';

interface Entry {
  id: string;
  createdAt: Date;
  seenAt?: Date;
}

function revive(raw: Record<string, unknown>): Entry {
  return {
    id: String(raw.id),
    createdAt: requiredDate(raw.createdAt, 'createdAt'),
    seenAt: optionalDate(raw.seenAt),
  };
}

async function storeIn(directory?: string): Promise<{ store: JsonFileStore<Entry>; filePath: string }> {
  const root = directory ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-store-')));
  const filePath = path.join(root, 'nested', 'entries.json');
  return { store: new JsonFileStore(filePath, revive), filePath };
}

test('a missing file reads as an empty collection', async () => {
  const { store } = await storeIn();

  assert.deepEqual(await store.readAll(), []);
});

test('written entries are read back with real Date objects', async () => {
  const { store } = await storeIn();
  const createdAt = new Date('2026-08-13T06:45:00.000Z');

  await store.mutate(() => [{ id: 'a', createdAt, seenAt: undefined }]);
  const [entry] = await store.readAll();

  assert.equal(entry.id, 'a');
  assert.ok(entry.createdAt instanceof Date);
  assert.equal(entry.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(entry.seenAt, undefined);
});

test('a second store instance on the same file sees the data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-store-'));
  const first = await storeIn(root);
  await first.store.mutate(() => [{ id: 'persisted', createdAt: new Date('2026-08-13T06:00:00.000Z') }]);

  const second = await storeIn(root);

  assert.equal((await second.store.readAll())[0]?.id, 'persisted');
});

test('concurrent updates do not lose each other', async () => {
  const { store } = await storeIn();

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.mutate((entries) => [...entries, { id: `entry-${index}`, createdAt: new Date() }])
    )
  );

  assert.equal((await store.readAll()).length, 20);
});

test('no temporary files are left behind', async () => {
  const { store, filePath } = await storeIn();
  await store.mutate(() => [{ id: 'a', createdAt: new Date() }]);

  const files = await fs.readdir(path.dirname(filePath));

  assert.deepEqual(files, ['entries.json']);
});

test('a corrupt file is reported instead of silently discarded', async () => {
  const { store, filePath } = await storeIn();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{ this is not json');

  await assert.rejects(() => store.readAll(), /not valid JSON/);
  // The original content must still be there for manual recovery.
  assert.equal(await fs.readFile(filePath, 'utf8'), '{ this is not json');
});
