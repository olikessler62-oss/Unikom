import type { DatabaseSync } from 'node:sqlite';

import { einfrieren } from '../../../domain/consolidation/Profil.js';
import type { Schnappschuss, SchnappschussRepository } from '../../../domain/consolidation/Snapshot.js';
import { nullable } from './SqliteDatabase.js';

interface SnapshotRow {
  id: string;
  tenant_id: string;
  run_id: string | null;
  profile_id: string | null;
  profile_version: number | null;
  created_at: string;
  document: string;
}

const COLUMNS = 'id, tenant_id, run_id, profile_id, profile_version, created_at, document';

/**
 * Der Schnappschuss gehört zu dem, **was passiert ist**, und liegt deshalb in
 * SQLite (SPEC-01, Abschnitt 11.2) — auch wenn sein Inhalt eine Konfiguration
 * beschreibt. Er ist kein Einstellungsdokument, sondern die Feststellung „so
 * lief es".
 *
 * Er wird geschrieben und danach nur noch gelesen. Ein `UPDATE` gibt es hier
 * bewusst nicht: Ein Schnappschuss, den man ändern kann, ist keiner.
 */
function toSchnappschuss(row: SnapshotRow): Schnappschuss {
  const dokument = JSON.parse(row.document) as Omit<Schnappschuss, 'id' | 'tenantId' | 'runId' | 'erstellt'>;

  return einfrieren({
    ...dokument,
    id: row.id,
    tenantId: row.tenant_id,
    runId: row.run_id ?? undefined,
    erstellt: new Date(row.created_at),
  });
}

export class SqliteSnapshotRepository implements SchnappschussRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(schnappschuss: Schnappschuss): Promise<Schnappschuss> {
    const { id, tenantId, runId, erstellt, ...dokument } = schnappschuss;

    this.database
      .prepare(
        `INSERT INTO configuration_snapshots
           (id, tenant_id, run_id, profile_id, profile_version, created_at, document)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        nullable(runId),
        nullable(schnappschuss.profilId),
        schnappschuss.profilVersion ?? null,
        erstellt.toISOString(),
        JSON.stringify(dokument)
      );

    return schnappschuss;
  }

  async getById(id: string): Promise<Schnappschuss | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM configuration_snapshots WHERE id = ?`).get(id) as unknown as
      | SnapshotRow
      | undefined;

    return row ? toSchnappschuss(row) : undefined;
  }

  async findByRun(runId: string): Promise<Schnappschuss | undefined> {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM configuration_snapshots WHERE run_id = ? ORDER BY created_at DESC`)
      .get(runId) as unknown as SnapshotRow | undefined;

    return row ? toSchnappschuss(row) : undefined;
  }
}
