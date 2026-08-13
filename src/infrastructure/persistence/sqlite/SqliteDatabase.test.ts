import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATABASE_FILENAME, openDatabase } from './SqliteDatabase.js';

async function database() {
  const directory = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-sqlite-')), 'application-data');
  return { directory, db: openDatabase(directory) };
}

function queryPlan(db: ReturnType<typeof openDatabase>, sql: string, ...parameters: string[]): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as unknown as { detail: string }[];
  return rows.map((row) => row.detail).join(' | ');
}

test('the database file is created inside the data directory', async () => {
  const { directory, db } = await database();

  assert.equal(await fs.access(path.join(directory, DATABASE_FILENAME)).then(() => true, () => false), true);
  db.close();
});

test('opening an existing database keeps its contents', async () => {
  const { directory, db } = await database();
  db.prepare('INSERT INTO transfer_jobs (id, enabled, next_execution_at, document) VALUES (?, ?, ?, ?)').run(
    'job-1',
    1,
    null,
    '{}'
  );
  db.close();

  const reopened = openDatabase(directory);
  const row = reopened.prepare('SELECT id FROM transfer_jobs').get() as unknown as { id: string };

  assert.equal(row.id, 'job-1');
  reopened.close();
});

test('a database from an earlier version gains the retention column', async () => {
  const { directory, db } = await database();

  // Recreate the old shape: no started_at, the date only inside the document.
  db.exec('DROP TABLE transfer_files');
  db.exec(
    `CREATE TABLE transfer_files (
       id TEXT PRIMARY KEY, transfer_run_id TEXT NOT NULL, job_id TEXT NOT NULL,
       source_path TEXT NOT NULL, source_filename TEXT NOT NULL, sha256 TEXT,
       status TEXT NOT NULL, resolution TEXT, document TEXT NOT NULL)`
  );
  db.prepare(
    `INSERT INTO transfer_files
       (id, transfer_run_id, job_id, source_path, source_filename, sha256, status, resolution, document)
     VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', 'TRANSFERRED', ?)`
  ).run(
    'file-1',
    'TR-1',
    'job-1',
    '/exports/orders',
    'ORDER_001.csv',
    'hash-1',
    JSON.stringify({ id: 'file-1', startedAt: '2026-01-15T08:00:00.000Z' })
  );
  db.close();

  const migrated = openDatabase(directory);
  const row = migrated.prepare('SELECT id, started_at FROM transfer_files').get() as unknown as {
    id: string;
    started_at: string | null;
  };

  // The record survives, and its date is lifted out of the document, so
  // retention on an existing installation does not start from scratch.
  assert.equal(row.id, 'file-1');
  assert.equal(row.started_at, '2026-01-15T08:00:00.000Z');

  // Opening it a second time must not try the migration again.
  migrated.close();
  const reopened = openDatabase(directory);
  assert.equal((reopened.prepare('SELECT COUNT(*) AS n FROM transfer_files').get() as unknown as { n: number }).n, 1);
  reopened.close();
});

test('the retention delete uses an index instead of scanning', async () => {
  const { db } = await database();

  const plan = queryPlan(
    db,
    'DELETE FROM transfer_files WHERE job_id = ? AND started_at < ?',
    'job-1',
    '2026-01-01T00:00:00.000Z'
  );

  assert.match(plan, /USING INDEX ix_files_started/);
  db.close();
});

test('the duplicate lookup uses an index instead of scanning', async () => {
  const { db } = await database();

  const plan = queryPlan(
    db,
    `SELECT document FROM transfer_files
     WHERE job_id = ? AND source_path = ? AND source_filename = ?`,
    'job-1',
    '/exports/orders',
    'ORDER_001.csv'
  );

  assert.match(plan, /USING INDEX ix_files_identity/);
  assert.doesNotMatch(plan, /SCAN transfer_files/);
  db.close();
});

test('the content hash lookup uses an index instead of scanning', async () => {
  const { db } = await database();

  const plan = queryPlan(db, 'SELECT document FROM transfer_files WHERE job_id = ? AND sha256 = ?', 'job-1', 'abc');

  assert.match(plan, /USING INDEX ix_files_sha256/);
  db.close();
});

test('the run history per job uses an index instead of scanning', async () => {
  const { db } = await database();

  const plan = queryPlan(db, 'SELECT document FROM transfer_runs WHERE job_id = ?', 'job-1');

  assert.match(plan, /USING INDEX ix_runs_job/);
  db.close();
});

test('a growing history does not slow the duplicate lookup down', async () => {
  const { db } = await database();

  const insert = db.prepare(
    `INSERT INTO transfer_files
       (id, transfer_run_id, job_id, source_path, source_filename, sha256, status, resolution, document)
     VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', 'TRANSFERRED', '{}')`
  );

  // One transaction instead of 20k implicit ones, otherwise the setup alone
  // dominates the test runtime.
  db.exec('BEGIN');
  for (let index = 0; index < 20_000; index += 1) {
    insert.run(`file-${index}`, 'TR-1', 'job-1', '/exports/orders', `ORDER_${index}.csv`, `hash-${index}`);
  }
  db.exec('COMMIT');

  const lookup = db.prepare(
    'SELECT id FROM transfer_files WHERE job_id = ? AND source_path = ? AND source_filename = ?'
  );

  const startedAt = process.hrtime.bigint();
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    lookup.get('job-1', '/exports/orders', 'ORDER_19999.csv');
  }
  const microsecondsPerLookup = Number(process.hrtime.bigint() - startedAt) / 1_000 / 1_000;

  // A full scan over 20k rows would be orders of magnitude slower than this.
  assert.ok(
    microsecondsPerLookup < 100,
    `expected an indexed lookup, but each one took ${microsecondsPerLookup.toFixed(1)} microseconds`
  );
  db.close();
});
