import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { chooseInitials } from '../../../domain/users/Initials.js';
import { assertDataDirectoryIsLocal } from './DataDirectory.js';

/**
 * Schema and indices for the Step 1 data model (spec sections 100-101).
 *
 * Each row keeps its full domain object in `document` and lifts exactly those
 * fields into columns that queries filter on. That keeps the mapping small
 * while still letting SQLite answer duplicate and schedule lookups from an
 * index instead of scanning everything.
 */
const SCHEMA = `
-- The operator's own clients ("Mandant"), not SaaS tenants: Unikom runs on one
-- company's machine, and that company may be a service provider working for
-- several clients whose data must not get mixed up.
CREATE TABLE IF NOT EXISTS tenants (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  name_lower     TEXT NOT NULL UNIQUE,
  description    TEXT,
  root_directory TEXT,
  region         TEXT,
  -- Die Meldewege und die Konsolidierungseinstellungen als JSON. In Spalten
  -- zerlegt waeren es zwei Beschreibungen desselben, und beim naechsten Feld
  -- waere eine davon die veraltete.
  notification   TEXT,
  consolidation  TEXT,
  -- Wie lange Ausleitungen des Konfliktbestands liegen bleiben (SPEC-07 §5).
  -- NULL heisst „keine eigene Angabe" und damit die Voreinstellung; 0 heisst
  -- abgeschaltet.
  exports_days   INTEGER,
  enabled        INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS structure_profiles (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  document          TEXT NOT NULL,
  confirmed_by      TEXT,
  confirmed_by_name TEXT,
  matches           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_structures_tenant ON structure_profiles(tenant_id);

-- Der Konfigurations-Schnappschuss eines Laufs (SPEC-01, Abschnitt 10).
--
-- Er wird geschrieben und danach nur gelesen. Die Werte stehen im Dokument und
-- nicht als Verweis auf Profil und Mandant: Wer am Mandanten die Region
-- aendert, aendert sonst rueckwirkend die Lesart jedes vergangenen Laufs.
CREATE TABLE IF NOT EXISTS configuration_snapshots (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  run_id          TEXT,
  profile_id      TEXT,
  profile_version INTEGER,
  created_at      TEXT NOT NULL,
  document        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_snapshots_run    ON configuration_snapshots(run_id);
CREATE INDEX IF NOT EXISTS ix_snapshots_tenant ON configuration_snapshots(tenant_id);

-- Der Regelbestand der Mappings (SPEC-02, Abschnitt 15 bis 19).
--
-- Eigene Spalten statt eines Dokuments: Nach diesen Angaben wird gesucht und
-- gefiltert (Abschnitt 19), und eine Regel, die nur als JSON-Klumpen vorliegt,
-- laesst sich nicht nach Herkunft oder Bestaetigungszahl durchsehen.
--
-- Zurueckgenommene Regeln bleiben stehen. Wer wissen will, warum ein Lauf vom
-- Maerz etwas zugeordnet hat, das heute niemand mehr zuordnet, findet die
-- Antwort sonst nirgends.
CREATE TABLE IF NOT EXISTS mappings (
  id              TEXT PRIMARY KEY,
  art             TEXT NOT NULL,
  ebene           TEXT NOT NULL,
  tenant_id       TEXT,
  profile_id      TEXT,
  feld            TEXT,
  von             TEXT NOT NULL,
  nach            TEXT NOT NULL,
  herkunft        TEXT NOT NULL,
  confirmed       INTEGER NOT NULL DEFAULT 0,
  confirmations   INTEGER NOT NULL DEFAULT 0,
  applications    INTEGER NOT NULL DEFAULT 0,
  provisional     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  created_by_name TEXT,
  withdrawn_at    TEXT
);

CREATE INDEX IF NOT EXISTS ix_mappings_tenant ON mappings(tenant_id);
CREATE INDEX IF NOT EXISTS ix_mappings_lookup ON mappings(art, von);

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
  -- Die Windows-Freigabe, fuer die dieser Zugang gilt. NULL heisst: fuer keine
  -- bestimmte.
  share_path        TEXT,
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

CREATE TABLE IF NOT EXISTS transfer_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL,
  level      TEXT NOT NULL,
  job_id     TEXT,
  run_id     TEXT,
  filename   TEXT,
  user_id    TEXT,
  username   TEXT,
  message    TEXT NOT NULL,
  context    TEXT
);
CREATE INDEX IF NOT EXISTS ix_logs_run       ON transfer_logs(run_id, id);
CREATE INDEX IF NOT EXISTS ix_logs_job       ON transfer_logs(job_id, timestamp);
CREATE INDEX IF NOT EXISTS ix_logs_timestamp ON transfer_logs(timestamp);

CREATE TABLE IF NOT EXISTS transfer_files (
  id                    TEXT PRIMARY KEY,
  transfer_run_id       TEXT NOT NULL,
  job_id                TEXT NOT NULL,
  source_path           TEXT NOT NULL,
  source_filename       TEXT NOT NULL,
  sha256                TEXT,
  status                TEXT NOT NULL,
  resolution            TEXT,
  started_at            TEXT,
  document              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_job      ON transfer_files(job_id);
CREATE INDEX IF NOT EXISTS ix_files_run      ON transfer_files(transfer_run_id);
CREATE INDEX IF NOT EXISTS ix_files_status   ON transfer_files(status);
CREATE INDEX IF NOT EXISTS ix_files_sha256   ON transfer_files(job_id, sha256);
CREATE INDEX IF NOT EXISTS ix_files_identity ON transfer_files(job_id, source_path, source_filename);

-- Users and sessions get explicit columns rather than a document blob, for the
-- same reason as credentials: no code path can dump the row and take the
-- password hash along by accident.
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  username              TEXT NOT NULL,
  username_lower        TEXT NOT NULL UNIQUE,
  first_name            TEXT NOT NULL DEFAULT '',
  last_name             TEXT NOT NULL DEFAULT '',
  initials              TEXT NOT NULL DEFAULT '',
  display_name          TEXT NOT NULL,
  role                  TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  must_change_password  INTEGER NOT NULL,
  enabled               INTEGER NOT NULL,
  handle_conflicts      INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts INTEGER NOT NULL,
  locked_until          TEXT,
  last_login_at         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);

-- Facts about the installation itself: the licence somebody installed through
-- the interface, and the furthest this installation has ever seen the clock.
CREATE TABLE IF NOT EXISTS installation_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Konfliktfaelle (SPEC-07). Der fuehrende Bestand liegt hier und nicht in einer
-- Datei: Suchen, Filtern, Sperren und ein Bearbeitungsstand ueber Neustarts
-- hinweg traegt nur die Datenbank. Die vier Dateien aus dem Dateimodell sind
-- Ausleitungen daraus und duerfen nach Frist verschwinden, ohne dass hier
-- etwas fehlt.
CREATE TABLE IF NOT EXISTS conflicts (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  run_id            TEXT NOT NULL,
  record            TEXT NOT NULL,
  art               TEXT NOT NULL,
  criticality       TEXT NOT NULL,
  status            TEXT NOT NULL,
  cause             TEXT NOT NULL,
  rule              TEXT,
  expected          TEXT NOT NULL,
  found             TEXT NOT NULL,
  next_steps        TEXT NOT NULL,
  sources           TEXT NOT NULL,
  fields            TEXT NOT NULL,
  result            TEXT,
  created_at        TEXT NOT NULL,
  changed_at        TEXT NOT NULL,
  derived_from      TEXT,
  lock_user         TEXT,
  lock_user_name    TEXT,
  lock_since        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_conflicts_tenant ON conflicts(tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_conflicts_run ON conflicts(run_id);

-- Die Bearbeitungshistorie. Es gibt kein UPDATE darauf und kein DELETE:
-- „Nachtraegliche Korrekturen duerfen fruehere Entscheidungen nicht loeschen
-- oder ueberschreiben" (SPEC-07, Abschnitt 12).
CREATE TABLE IF NOT EXISTS conflict_steps (
  conflict_id   TEXT NOT NULL,
  step          INTEGER NOT NULL,
  art           TEXT NOT NULL,
  at            TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  user_name     TEXT,
  from_status   TEXT,
  to_status     TEXT,
  before_values TEXT,
  after_values  TEXT,
  decision      TEXT,
  rule          TEXT,
  batch         TEXT,
  note          TEXT,
  PRIMARY KEY (conflict_id, step)
);

CREATE INDEX IF NOT EXISTS ix_conflict_steps_batch ON conflict_steps(batch);

-- Wo ein Benutzer zuletzt war (SPEC-07, Abschnitt 10). Je Benutzer und Mandant
-- einer: Zwei Leute arbeiten an verschiedenen Stellen derselben Liste.
CREATE TABLE IF NOT EXISTS conflict_progress (
  tenant_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  last_id    TEXT,
  position   INTEGER,
  filter     TEXT,
  grouping   TEXT,
  sorting    TEXT,
  direction  TEXT,
  saved_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
-- Ergebnisstaende (SPEC-06 Abschnitt 13/14, SPEC-08 Abschnitt 13). Jeder Lauf
-- legt einen eigenen an; keiner wird veraendert. Ein UPDATE gibt es nur fuer die
-- Freigabe, und die kommt genau einmal.
CREATE TABLE IF NOT EXISTS results (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  run_id            TEXT NOT NULL,
  job_id            TEXT NOT NULL DEFAULT '',
  from_run          TEXT,
  restored_from     TEXT,
  fields            TEXT NOT NULL,
  rows_json         TEXT NOT NULL,
  validation        TEXT NOT NULL,
  status            TEXT NOT NULL,
  release_note      TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_results_tenant ON results(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_results_run ON results(run_id);

-- Lebenszeichen der Hintergrundprozesse (SPEC-01, Abschnitt 15). Eine Zeile je
-- Prozess; wer sich ordentlich verabschiedet, raeumt sie fort. Bleibt sie
-- stehen und wird alt, war es kein ordentliches Ende.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  process    TEXT PRIMARY KEY,
  last_seen  TEXT NOT NULL,
  run_id     TEXT,
  host       TEXT,
  pid        INTEGER,
  started_at TEXT NOT NULL
);

-- Benachrichtigungen (SPEC-01, Abschnitt 19 bis 22). Sie duerfen nicht verloren
-- gehen, nur weil jemand ein Popup geschlossen hat — deshalb liegen sie hier
-- und nicht im Arbeitsspeicher der Oberflaeche.
CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  reason         TEXT NOT NULL,
  level          TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  target_kind    TEXT,
  target_id      TEXT,
  created_at     TEXT NOT NULL,
  seen_at        TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS ix_notifications_open ON notifications(tenant_id, acknowledged_at, created_at);

-- Zwischenstaende der blockweisen Konsolidierung (SPEC-06, Abschnitt 15).
--
-- „Zwischenstaende werden separat und eindeutig dem jeweiligen
-- Verarbeitungslauf zugeordnet gespeichert. Sie liegen hier und nicht im
-- Arbeitsspeicher, weil sie genau dann gebraucht werden, wenn der Prozess,
-- der sie hielt, nicht mehr da ist.
--
-- Der zusammengesetzte Schluessel aus Lauf und Block ist die Zusage, dass ein
-- Schritt hoechstens einmal zaehlt: Ein zweimal gespeicherter Block waere ein
-- Ergebnis, in dem seine Datensaetze doppelt stehen.
CREATE TABLE IF NOT EXISTS consolidation_blocks (
  run_id     TEXT NOT NULL,
  block      INTEGER NOT NULL,
  blocks     INTEGER NOT NULL,
  records    INTEGER NOT NULL,
  report     TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  PRIMARY KEY (run_id, block)
);

-- Ausleitungen des Konfliktbestands (SPEC-07, Dateimodell und Abschnitt 5).
--
-- Der Eintrag bleibt stehen, wenn die Datei fortgeraeumt ist; removed_at traegt
-- dann den Zeitpunkt. Wer im Maerz wissen will, warum eine Datei vom Januar
-- nicht mehr da ist, findet hier die Antwort und nicht eine Luecke.
CREATE TABLE IF NOT EXISTS conflict_exports (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  run_id     TEXT,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  cases      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by_name TEXT,
  removed_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_conflict_exports_tenant ON conflict_exports (tenant_id);

-- Verwaltete Referenzquellen (SPEC-04, Abschnitt 8).
--
-- Hier steht der Verweis und nicht der Datenbestand: Die Kundenliste bleibt,
-- wo sie ist. Sie hier zu spiegeln hiesse, sie zweimal zu haben.
CREATE TABLE IF NOT EXISTS reference_sources (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  directory   TEXT NOT NULL,
  file        TEXT,
  version     TEXT,
  seen        TEXT,
  created_at  TEXT NOT NULL,
  created_by_name TEXT
);

CREATE INDEX IF NOT EXISTS ix_reference_sources_tenant ON reference_sources (tenant_id);

-- ix_files_started is created by migrate(), because on an older database the
-- column it indexes only exists after the migration has added it.
`;

/**
 * Changes to the schema that a database created by an earlier version does not
 * have yet. `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a
 * new column has to be added explicitly.
 *
 * Each step has to tolerate having run before: the check is what the database
 * actually looks like, not a stored version number, which cannot drift.
 */
function migrate(database: DatabaseSync, notice: (message: string) => void): void {
  if (!hasColumn(database, 'transfer_files', 'started_at')) {
    database.exec('ALTER TABLE transfer_files ADD COLUMN started_at TEXT');
    // Backfill from the document that has held the value all along, so the
    // retention of an existing installation does not start from zero.
    database.exec(
      `UPDATE transfer_files
       SET started_at = json_extract(document, '$.startedAt')
       WHERE started_at IS NULL`
    );
  }

  // Only now can the index exist: on an older database the column above was
  // missing a moment ago, and creating the index in the schema would have made
  // an existing installation fail to open at all.
  database.exec('CREATE INDEX IF NOT EXISTS ix_files_started ON transfer_files(job_id, started_at)');

  if (!hasColumn(database, 'credentials', 'tenant_id')) {
    // NULL means shared across all tenants, which is what every credential of
    // an installation from before tenants existed effectively was.
    database.exec('ALTER TABLE credentials ADD COLUMN tenant_id TEXT');
  }

  database.exec('CREATE INDEX IF NOT EXISTS ix_credentials_tenant ON credentials(tenant_id)');

  /*
   * Für welche Windows-Freigabe ein Zugang gilt. NULL heißt „für keine
   * bestimmte" — genau das, was jeder Zugang aus der Zeit vor dieser Spalte
   * war.
   */
  if (!hasColumn(database, 'credentials', 'share_path')) {
    database.exec('ALTER TABLE credentials ADD COLUMN share_path TEXT');
  }

  if (!hasColumn(database, 'transfer_logs', 'user_id')) {
    // NULL heißt „ohne Urheber" — der Regelfall, denn die meisten Zeilen
    // schreibt der Zeitplan und nicht ein Mensch.
    database.exec('ALTER TABLE transfer_logs ADD COLUMN user_id TEXT');
    database.exec('ALTER TABLE transfer_logs ADD COLUMN username TEXT');
  }

  migrateUsers(database, notice);

  if (!hasColumn(database, 'tenants', 'region')) {
    // NULL heißt „keine eigene Angabe" und damit die Voreinstellung — genau
    // das, was ein Mandant aus der Zeit vor dieser Spalte hatte.
    database.exec('ALTER TABLE tenants ADD COLUMN region TEXT');
  }

  /*
   * Meldewege und Konsolidierungseinstellungen wurden **nie gespeichert**.
   *
   * Sie standen am Mandanten, wurden über die Schnittstelle entgegengenommen
   * und fielen beim Schreiben heraus: Die Tabelle hatte keine Spalte dafür. Im
   * Arbeitsspeicher überlebten sie, in SQLite nicht — nach jedem Neustart galt
   * wieder die Voreinstellung, und niemand sah es, weil eine Voreinstellung
   * genauso aussieht wie eine Einstellung, die man vergessen hat.
   */
  if (!hasColumn(database, 'tenants', 'notification')) {
    database.exec('ALTER TABLE tenants ADD COLUMN notification TEXT');
  }

  if (!hasColumn(database, 'tenants', 'consolidation')) {
    database.exec('ALTER TABLE tenants ADD COLUMN consolidation TEXT');
  }

  if (!hasColumn(database, 'tenants', 'exports_days')) {
    database.exec('ALTER TABLE tenants ADD COLUMN exports_days INTEGER');
  }
}

/**
 * Namen, Kürzel und die zwei Berechtigungsstufen.
 *
 * Beides ändert bestehende Konten, deshalb sagt diese Stelle ins Protokoll, was
 * sie getan hat: Wer aus „Bearbeiter" und „Betrachter" eine gemeinsame Stufe
 * macht, hebt die Rechte der Betrachter an, und eine Rechteänderung, die
 * niemand mitbekommt, ist genau die, nach der später gesucht wird.
 */
function migrateUsers(database: DatabaseSync, notice: (message: string) => void): void {
  if (!hasColumn(database, 'users', 'first_name')) {
    database.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
    database.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
    database.exec("ALTER TABLE users ADD COLUMN initials TEXT NOT NULL DEFAULT ''");
  }

  if (!hasColumn(database, 'users', 'handle_conflicts')) {
    // Voreingestellt auf 0: Das Recht auf Konfliktdaten bekommt niemand
    // nebenbei durch eine Umstellung, auch kein Administrator.
    database.exec('ALTER TABLE users ADD COLUMN handle_conflicts INTEGER NOT NULL DEFAULT 0');
    notice('Das Recht „Konfliktdaten bearbeiten" ist neu und zunächst bei niemandem gesetzt');
  }

  const ohneKuerzel = database
    .prepare("SELECT id, username, display_name FROM users WHERE initials = '' ORDER BY created_at ASC")
    .all() as unknown as { id: string; username: string; display_name: string }[];

  if (ohneKuerzel.length > 0) {
    const vergeben = (
      database.prepare("SELECT initials FROM users WHERE initials <> ''").all() as unknown as {
        initials: string;
      }[]
    ).map((row) => row.initials);

    const setzen = database.prepare(
      'UPDATE users SET first_name = ?, last_name = ?, initials = ? WHERE id = ?'
    );

    for (const row of ohneKuerzel) {
      const name = splitName(row.display_name || row.username);
      const initials = chooseInitials(name, vergeben);

      vergeben.push(initials);
      setzen.run(name.firstName, name.lastName, initials, row.id);
      notice(`Benutzer „${row.display_name}" hat das Kürzel ${initials} bekommen`);
    }
  }

  // Erst jetzt: auf einer älteren Datenbank stand einen Augenblick vorher in
  // jeder Zeile dasselbe leere Kürzel, und ein eindeutiger Index hätte die
  // bestehende Installation nicht mehr aufgehen lassen.
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_initials ON users(initials)');

  const alteStufen = database
    .prepare("SELECT username, role FROM users WHERE role NOT IN ('ADMIN', 'STANDARD')")
    .all() as unknown as { username: string; role: string }[];

  if (alteStufen.length > 0) {
    database.exec("UPDATE users SET role = 'STANDARD' WHERE role NOT IN ('ADMIN', 'STANDARD')");

    for (const row of alteStufen) {
      notice(
        `Benutzer „${row.username}" hatte die Stufe ${row.role}; es gibt nur noch Administrator und Normal, ` +
          'daher steht das Konto jetzt auf Normal' +
          (row.role === 'VIEWER' ? ' — es darf damit Workflows ändern und starten, vorher nur ansehen' : '')
      );
    }
  }
}

/**
 * Aus einem alten, einteiligen Namensfeld Vor- und Nachname machen. Bei einem
 * einzigen Wort wird es der Nachname: „Administrator" ist keiner, der einen
 * Nachnamen hätte, und ein erfundener Vorname wäre schlechter als ein leeres
 * Feld, das beim nächsten Bearbeiten auffällt.
 */
function splitName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  return parts.length > 1
    ? { firstName: parts[0], lastName: parts.slice(1).join(' ') }
    : { firstName: '', lastName: parts[0] ?? '' };
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  return columns.some((entry) => entry.name === column);
}

export const DATABASE_FILENAME = 'unikom.db';

/**
 * `notice` bekommt jede Umstellung, die bestehende Daten verändert hat. Der
 * Aufrufer schreibt sie ins Protokoll — hier gibt es noch keines, die
 * Protokollierung wohnt selbst in dieser Datenbank.
 */
export function openDatabase(dataDirectory: string, notice: (message: string) => void = () => {}): DatabaseSync {
  // Vor dem Anlegen: eine Datenbank auf einer Freigabe wird nicht sofort
  // falsch, sondern irgendwann kaputt. Siehe DataDirectory.ts.
  assertDataDirectoryIsLocal(dataDirectory);

  fs.mkdirSync(dataDirectory, { recursive: true });

  const database = new DatabaseSync(path.join(dataDirectory, DATABASE_FILENAME));

  // Write-ahead logging keeps a crash from truncating the history.
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA synchronous = NORMAL;');
  /*
   * Wartezeit, wenn ein anderer Zugang gerade schreibt.
   *
   * SQLite lässt beliebig viele Leser zu, aber nur einen Schreiber. Ohne diese
   * Angabe bekommt der zweite Zugang sofort ein SQLITE_BUSY um die Ohren,
   * statt einen Augenblick zu warten — und ein Schreibvorgang dauert hier
   * Millisekunden. Wichtig wird das mit dem eigenständigen Worker-Prozess
   * (SPEC-01, Abschnitt 13); der Sicherungslauf greift schon heute von außen
   * auf dieselbe Datei zu.
   */
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  database.exec(SCHEMA);
  migrate(database, notice);

  return database;
}

/** Lange genug für jeden Schreibvorgang hier, kurz genug, um nicht zu hängen. */
export const BUSY_TIMEOUT_MS = 5_000;

/**
 * Eine vollständige Sicherung in eine einzige Datei — im laufenden Betrieb.
 *
 * `VACUUM INTO` schreibt einen in sich stimmigen Stand, ohne die laufende
 * Verarbeitung anzuhalten. Das ist der Grund, es nicht mit einem Dateikopieren
 * zu versuchen: Die Datenbank besteht aus drei Dateien, und der jüngste Stand
 * steht meist im Write-ahead-Log, nicht in der .db. Wer nur die .db kopiert,
 * sichert den älteren Teil und merkt es erst, wenn er die Sicherung braucht.
 */
export function backupDatabase(database: DatabaseSync, targetFile: string): void {
  if (fs.existsSync(targetFile)) {
    throw new Error(`Die Datei „${targetFile}“ gibt es schon; eine Sicherung überschreibt keine bestehende`);
  }

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  database.prepare('VACUUM INTO ?').run(targetFile);
}

/** SQLite accepts no `undefined`; optional columns have to be explicit nulls. */
export function nullable(value: string | undefined): string | null {
  return value ?? null;
}
