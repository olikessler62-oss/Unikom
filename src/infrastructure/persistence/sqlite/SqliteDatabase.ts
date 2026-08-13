import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Schema and indices for the Step 1 data model (spec sections 100-101).
 *
 * Each row keeps its full domain object in `document` and lifts exactly those
 * fields into columns that queries filter on. That keeps the mapping small
 * while still letting SQLite answer duplicate and schedule lookups from an
 * index instead of scanning everything.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS transfer_jobs (
  id                 TEXT PRIMARY KEY,
  enabled            INTEGER NOT NULL,
  next_execution_at  TEXT,
  document           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_enabled        ON transfer_jobs(enabled);
CREATE INDEX IF NOT EXISTS ix_jobs_next_execution ON transfer_jobs(next_execution_at);

-- Credentials get explicit columns rather than a document blob, so no code
-- path can dump the whole record and take the secret along with it.
CREATE TABLE IF NOT EXISTS credentials (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL,
  username          TEXT,
  encrypted_secret  TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_runs (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  status      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  document    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_runs_job     ON transfer_runs(job_id);
CREATE INDEX IF NOT EXISTS ix_runs_started ON transfer_runs(started_at);

CREATE TABLE IF NOT EXISTS transfer_files (
  id                    TEXT PRIMARY KEY,
  transfer_run_id       TEXT NOT NULL,
  job_id                TEXT NOT NULL,
  source_path           TEXT NOT NULL,
  source_filename       TEXT NOT NULL,
  sha256                TEXT,
  status                TEXT NOT NULL,
  resolution            TEXT,
  document              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_job      ON transfer_files(job_id);
CREATE INDEX IF NOT EXISTS ix_files_run      ON transfer_files(transfer_run_id);
CREATE INDEX IF NOT EXISTS ix_files_status   ON transfer_files(status);
CREATE INDEX IF NOT EXISTS ix_files_sha256   ON transfer_files(job_id, sha256);
CREATE INDEX IF NOT EXISTS ix_files_identity ON transfer_files(job_id, source_path, source_filename);
`;

export const DATABASE_FILENAME = 'unikom.db';

export function openDatabase(dataDirectory: string): DatabaseSync {
  fs.mkdirSync(dataDirectory, { recursive: true });

  const database = new DatabaseSync(path.join(dataDirectory, DATABASE_FILENAME));

  // Write-ahead logging keeps a crash from truncating the history.
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA synchronous = NORMAL;');
  database.exec(SCHEMA);

  return database;
}

/** SQLite accepts no `undefined`; optional columns have to be explicit nulls. */
export function nullable(value: string | undefined): string | null {
  return value ?? null;
}
