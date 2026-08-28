import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase, BUSY_TIMEOUT_MS, DATABASE_FILENAME, openDatabase } from './SqliteDatabase.js';

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

test('eine Datenbank von früher bekommt die Spalte für den Workflow eines Ergebnisses', async () => {
  /*
   * `CREATE TABLE IF NOT EXISTS` überspringt eine vorhandene Tabelle ganz. Eine
   * Spalte, die später ins Schema kam, entsteht damit **nur** in neuen
   * Datenbanken — in allen älteren fehlt sie, ohne dass etwas davon berichtet.
   *
   * Genau das war passiert: Jede Abfrage der Ergebnisse endete auf einer
   * bestehenden Installation mit „no such column: job_id", und die Freigaben
   * waren dort nicht zu öffnen.
   */
  const { directory, db } = await database();

  db.exec('DROP TABLE results');
  db.exec(
    `CREATE TABLE results (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL,
       from_run TEXT, restored_from TEXT, fields TEXT NOT NULL, rows_json TEXT NOT NULL,
       validation TEXT NOT NULL, status TEXT NOT NULL, release_note TEXT,
       created_at TEXT NOT NULL)`
  );
  db.prepare(
    `INSERT INTO results (id, tenant_id, run_id, fields, rows_json, validation, status, created_at)
     VALUES (?, 'default', 'lauf-1', '[]', '[]', '{}', 'WAITING_FOR_RELEASE', '2026-01-15T08:00:00.000Z')`
  ).run('stand-1');
  db.close();

  const migriert = openDatabase(directory);

  // Lesbar — und das ist die eigentliche Zusicherung: vorher warf genau das.
  const zeile = migriert.prepare('SELECT id, job_id FROM results WHERE id = ?').get('stand-1') as {
    id: string;
    job_id: string;
  };

  assert.equal(zeile.id, 'stand-1', 'der Stand von damals ist noch da');
  assert.equal(zeile.job_id, '', 'aus welchem Workflow er kam, steht nirgends — und das gibt er zu');
  migriert.close();
});

test('kein Schema-Feld fehlt in einer Datenbank, die schon bestand', async () => {
  /*
   * Die Wache über der Klasse von Fehlern, nicht über dem einen.
   *
   * Verglichen wird, was das Schema in der Quelle verspricht, mit dem, was in
   * einer geöffneten Datenbank steht. Wer eine Spalte ins `CREATE TABLE`
   * schreibt und die Wanderung dazu vergisst, bekommt es hier gesagt — und
   * nicht ein halbes Jahr später aus einem Protokoll beim Kunden.
   */
  const { directory, db } = await database();
  db.close();

  const quelle = await fs.readFile(
    new URL('./SqliteDatabase.ts', import.meta.url),
    'utf8'
  );

  const geöffnet = openDatabase(directory);
  const fehlend: string[] = [];

  /*
   * Das Muster wird zusammengesetzt statt hingeschrieben: Ein Zeilenumbruch in
   * einem Regex-Literal ist keiner, sondern das Ende des Literals.
   */
  const UMBRUCH = String.fromCharCode(10);
  const tabellen = new RegExp('CREATE TABLE IF NOT EXISTS (\\w+) \\(([^;]*?)' + UMBRUCH + '\\)', 'g');

  for (const treffer of quelle.matchAll(tabellen)) {
    const tabelle = treffer[1];
    const versprochen = treffer[2]
      .split(String.fromCharCode(10))
      .map((zeile) => zeile.trim())
      .filter((zeile) => zeile !== '' && !zeile.startsWith('--'))
      .map((zeile) => zeile.split(/\s+/)[0].replace(/,$/, ''))
      .filter((name) => /^[a-z_]+$/.test(name));

    const vorhanden = (
      geöffnet.prepare(`PRAGMA table_info(${tabelle})`).all() as { name: string }[]
    ).map((spalte) => spalte.name);

    if (vorhanden.length === 0) {
      continue;
    }

    fehlend.push(...versprochen.filter((name) => !vorhanden.includes(name)).map((name) => `${tabelle}.${name}`));
  }

  geöffnet.close();

  assert.deepEqual(fehlend, [], 'diese Spalten stehen im Schema, aber in keiner Wanderung');
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

test('eine Datenbank von früher bekommt Namen, Kürzel und die neuen Stufen', async () => {
  const { directory, db } = await database();

  // Die alte Gestalt: ein einziges Namensfeld, drei Rollen, kein Kürzel.
  db.exec('DROP TABLE users');
  db.exec(
    `CREATE TABLE users (
       id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE,
       display_name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL,
       must_change_password INTEGER NOT NULL, enabled INTEGER NOT NULL,
       failed_login_attempts INTEGER NOT NULL, locked_until TEXT, last_login_at TEXT,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  );

  const anlegen = db.prepare(
    `INSERT INTO users (id, username, username_lower, display_name, role, password_hash,
                        must_change_password, enabled, failed_login_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'x', 0, 1, 0, ?, ?)`
  );

  anlegen.run('1', 'anna', 'anna', 'Anna Berger', 'ADMIN', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  anlegen.run('2', 'chris', 'chris', 'Chris Conrad', 'OPERATOR', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  // Zwei Namen, die nach der Regel dasselbe Kürzel ergäben.
  anlegen.run('3', 'anne', 'anne', 'Anne Bauer', 'VIEWER', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
  anlegen.run('4', 'admin', 'admin', 'Administrator', 'ADMIN', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z');
  db.close();

  const meldungen: string[] = [];
  const reopened = openDatabase(directory, (message) => meldungen.push(message));
  const rows = reopened
    .prepare('SELECT username, first_name, last_name, initials, role FROM users ORDER BY created_at')
    .all() as unknown as { username: string; first_name: string; last_name: string; initials: string; role: string }[];

  assert.deepEqual(
    rows.map((row) => [row.username, row.first_name, row.last_name, row.initials, row.role]),
    [
      ['anna', 'Anna', 'Berger', 'ABR', 'ADMIN'],
      ['chris', 'Chris', 'Conrad', 'CCD', 'STANDARD'],
      // Anne Bauer bekäme ebenfalls ABR; die dritte Stelle wandert weiter.
      ['anne', 'Anne', 'Bauer', 'ABN', 'STANDARD'],
      // Ein einziges Wort wird der Nachname, der Vorname bleibt offen.
      ['admin', '', 'Administrator', 'AAR', 'ADMIN'],
    ]
  );

  // Aus Betrachter wird Normal — das sind mehr Rechte als vorher, und genau
  // das muss jemand später nachlesen können.
  assert.ok(
    meldungen.some((message) => /anne/.test(message) && /VIEWER/.test(message) && /ändern und starten/.test(message)),
    `keine Meldung über die angehobenen Rechte: ${meldungen.join(' / ')}`
  );

  reopened.close();
});

test('zwei Benutzer können nicht dasselbe Kürzel tragen', async () => {
  const { db } = await database();

  const anlegen = db.prepare(
    `INSERT INTO users (id, username, username_lower, first_name, last_name, initials, display_name, role,
                        password_hash, must_change_password, enabled, failed_login_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ADMIN', 'x', 0, 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );

  anlegen.run('1', 'anna', 'anna', 'Anna', 'Berger', 'ABR', 'Anna Berger');

  // Nicht nur der Dienst wacht darüber: die Datenbank selbst lässt es nicht zu.
  assert.throws(() => anlegen.run('2', 'arno', 'arno', 'Arno', 'Bauer', 'ABR', 'Arno Bauer'), /UNIQUE/);
  db.close();
});

test('ein zweiter Zugang wartet, statt sofort abzubrechen', async () => {
  const { db } = await database();

  const gesetzt = db.prepare('PRAGMA busy_timeout').get() as unknown as { timeout: number };

  // Ohne diese Wartezeit bekommt der Sicherungslauf oder der spätere
  // Worker-Prozess ein SQLITE_BUSY, sobald der Server gerade schreibt.
  assert.equal(Number(gesetzt.timeout), BUSY_TIMEOUT_MS);
  db.close();
});

test('eine Sicherung enthält auch das, was noch im Write-ahead-Log steht', async () => {
  const { directory, db } = await database();

  db.prepare('INSERT INTO transfer_jobs (id, enabled, next_execution_at, document) VALUES (?, ?, ?, ?)').run(
    'job-sicherung',
    1,
    null,
    '{"name":"Nachtlauf"}'
  );

  // Nicht schließen: Die Sicherung muss im laufenden Betrieb gelingen, und
  // genau dann steht der jüngste Stand noch nicht in der .db-Datei.
  const ziel = path.join(directory, 'backups', 'sicherung.db');
  backupDatabase(db, ziel);

  const kopie = new DatabaseSync(ziel);
  const row = kopie.prepare('SELECT document FROM transfer_jobs WHERE id = ?').get('job-sicherung') as unknown as {
    document: string;
  };

  assert.equal(row.document, '{"name":"Nachtlauf"}');

  // Eine einzige Datei, kein -wal daneben: so lässt sie sich fortgeben.
  assert.equal(await fs.access(`${ziel}-wal`).then(() => true, () => false), false);

  kopie.close();
  db.close();
});

test('eine Sicherung überschreibt keine bestehende Datei', async () => {
  const { directory, db } = await database();
  const ziel = path.join(directory, 'backups', 'zweimal.db');

  backupDatabase(db, ziel);

  assert.throws(() => backupDatabase(db, ziel), /gibt es schon/);
  db.close();
});

test('eine Datenbank auf einer Freigabe wird gar nicht erst geöffnet', () => {
  // Der Pfad wird geprüft, bevor irgendetwas angelegt wird — sonst stünde
  // nach dem Fehlschlag ein halbes Datenverzeichnis auf der Freigabe.
  assert.throws(() => openDatabase('\\\\FILESERVER\\unikom-daten'), /lokalen Platte/);
});
