import type { DatabaseSync } from 'node:sqlite';

import type { Ergebnispruefung } from '../../../domain/result/Ergebnispruefung.js';
import type { Ergebnisbestand, Ergebnisstand } from '../../../domain/result/Ergebnisstand.js';
import type { Freigabevermerk, Verarbeitungsstatus } from '../../../domain/result/Freigabe.js';
import { nullable } from './SqliteDatabase.js';

/**
 * Ergebnisstaende in SQLite.
 *
 * ## Warum es kein allgemeines UPDATE gibt
 *
 * „Historische Ergebnisstaende und Entscheidungen bleiben unveraendert
 * erhalten" (SPEC-06, Abschnitt 14). Geaendert wird an einem Stand genau
 * einmal etwas — die Freigabe kommt hinzu —, und dafuer gibt es eine eigene
 * Methode. Ein `save`, das auch ueberschreibt, waere die Einladung, einen alten
 * Stand „kurz zu berichtigen".
 *
 * ## Zeilen als JSON
 *
 * Der Ergebnisbestand ist eine Momentaufnahme und keine Tabelle, in der gesucht
 * wird: Wer darin sucht, sucht in der Zieldatei oder im naechsten Lauf. Ihn in
 * Spalten zu zerlegen hiesse, fuer jeden Lauf ein anderes Schema zu brauchen.
 */
interface ErgebnisRow {
  id: string;
  tenant_id: string;
  run_id: string;
  job_id: string;
  from_run: string | null;
  restored_from: string | null;
  fields: string;
  rows_json: string;
  validation: string;
  status: string;
  release_note: string | null;
  created_at: string;
}

const SPALTEN =
  'id, tenant_id, run_id, job_id, from_run, restored_from, fields, rows_json, validation, status, release_note, created_at';

function toStand(row: ErgebnisRow): Ergebnisstand {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    laufId: row.run_id,
    jobId: row.job_id,
    ausLauf: row.from_run ?? undefined,
    wiederhergestelltAus: row.restored_from ?? undefined,
    felder: JSON.parse(row.fields) as string[],
    zeilen: JSON.parse(row.rows_json) as string[][],
    pruefung: JSON.parse(row.validation) as Ergebnispruefung,
    status: row.status as Verarbeitungsstatus,
    freigabe: row.release_note ? (JSON.parse(row.release_note) as Freigabevermerk) : undefined,
    entstanden: row.created_at,
  };
}

export class SqliteResultRepository implements Ergebnisbestand {
  constructor(private readonly database: DatabaseSync) {}

  async list(tenantId: string, laufId?: string): Promise<Ergebnisstand[]> {
    const rows = (
      laufId
        ? this.database
            .prepare(`SELECT ${SPALTEN} FROM results WHERE tenant_id = ? AND run_id = ? ORDER BY created_at`)
            .all(tenantId, laufId)
        : this.database.prepare(`SELECT ${SPALTEN} FROM results WHERE tenant_id = ? ORDER BY created_at`).all(tenantId)
    ) as unknown as ErgebnisRow[];

    return rows.map(toStand);
  }

  async byId(id: string): Promise<Ergebnisstand | undefined> {
    const row = this.database.prepare(`SELECT ${SPALTEN} FROM results WHERE id = ?`).get(id) as unknown as
      | ErgebnisRow
      | undefined;

    return row ? toStand(row) : undefined;
  }

  /** Nur anlegen. Ein zweites `save` mit derselben Kennung scheitert am Schluessel. */
  async save(stand: Ergebnisstand): Promise<void> {
    this.database
      .prepare(`INSERT INTO results (${SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        stand.id,
        stand.tenantId,
        stand.laufId,
        stand.jobId,
        nullable(stand.ausLauf),
        nullable(stand.wiederhergestelltAus),
        JSON.stringify(stand.felder),
        JSON.stringify(stand.zeilen),
        JSON.stringify(stand.pruefung),
        stand.status,
        stand.freigabe ? JSON.stringify(stand.freigabe) : null,
        stand.entstanden
      );
  }

  /**
   * Die Freigabe nachtragen — die einzige Aenderung, die ein Stand erfaehrt.
   *
   * `WHERE release_note IS NULL` sorgt dafuer, dass sie genau einmal geschieht:
   * Zwei gleichzeitige Freigaben koennen sich nicht gegenseitig ueberschreiben,
   * und die zweite bewirkt schlicht nichts.
   */
  async freigabeVermerken(id: string, status: Verarbeitungsstatus, vermerk: Freigabevermerk): Promise<void> {
    this.database
      .prepare('UPDATE results SET status = ?, release_note = ? WHERE id = ? AND release_note IS NULL')
      .run(status, JSON.stringify(vermerk), id);
  }
}
