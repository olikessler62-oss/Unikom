import type { DatabaseSync } from 'node:sqlite';

import type { Ebene } from '../../../domain/consolidation/Einstellungen.js';
import type {
  Mappingart,
  MappingRepository,
  Mappingregel,
  Regelherkunft,
} from '../../../domain/mapping/Regelbestand.js';
import { nullable } from './SqliteDatabase.js';

interface MappingRow {
  id: string;
  art: string;
  ebene: string;
  tenant_id: string | null;
  profile_id: string | null;
  feld: string | null;
  von: string;
  nach: string;
  herkunft: string;
  confirmed: number;
  confirmations: number;
  applications: number;
  provisional: number;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  withdrawn_at: string | null;
}

const COLUMNS =
  'id, art, ebene, tenant_id, profile_id, feld, von, nach, herkunft, confirmed, confirmations, ' +
  'applications, provisional, created_at, created_by, created_by_name, withdrawn_at';

function toRegel(row: MappingRow): Mappingregel {
  return {
    id: row.id,
    art: row.art as Mappingart,
    ebene: row.ebene as Ebene,
    tenantId: row.tenant_id ?? undefined,
    profilId: row.profile_id ?? undefined,
    feld: row.feld ?? undefined,
    von: row.von,
    nach: row.nach,
    herkunft: row.herkunft as Regelherkunft,
    bestaetigt: row.confirmed === 1,
    bestaetigungen: Number(row.confirmations),
    anwendungen: Number(row.applications),
    vorlaeufig: row.provisional === 1,
    erstellt: new Date(row.created_at),
    erstelltVon: row.created_by ?? undefined,
    erstelltVonName: row.created_by_name ?? undefined,
    zurueckgenommen: row.withdrawn_at ? new Date(row.withdrawn_at) : undefined,
  };
}

export class SqliteMappingRepository implements MappingRepository {
  constructor(private readonly database: DatabaseSync) {}

  /**
   * Alle Regeln, die für diesen Mandanten in Frage kommen.
   *
   * Das sind seine eigenen **und** die allgemeinen: Ein allgemeines Mapping
   * gilt für jeden, und wer nur die mandantenspezifischen läse, bekäme eine
   * Auskunft, die von der Wirklichkeit abweicht — die Rangfolge in
   * `waehle()` entscheidet danach, welche gewinnt.
   */
  async list(tenantId?: string): Promise<Mappingregel[]> {
    const rows = (
      tenantId
        ? this.database
            .prepare(`SELECT ${COLUMNS} FROM mappings WHERE tenant_id IS NULL OR tenant_id = ? ORDER BY created_at DESC`)
            .all(tenantId)
        : this.database.prepare(`SELECT ${COLUMNS} FROM mappings ORDER BY created_at DESC`).all()
    ) as unknown as MappingRow[];

    return rows.map(toRegel);
  }

  async getById(id: string): Promise<Mappingregel | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM mappings WHERE id = ?`).get(id) as unknown as
      | MappingRow
      | undefined;

    return row ? toRegel(row) : undefined;
  }

  async save(regel: Mappingregel): Promise<Mappingregel> {
    this.database
      .prepare(
        `INSERT INTO mappings
           (id, art, ebene, tenant_id, profile_id, feld, von, nach, herkunft, confirmed, confirmations,
            applications, provisional, created_at, created_by, created_by_name, withdrawn_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           nach          = excluded.nach,
           feld          = excluded.feld,
           confirmed     = excluded.confirmed,
           confirmations = excluded.confirmations,
           applications  = excluded.applications,
           provisional   = excluded.provisional,
           withdrawn_at  = excluded.withdrawn_at`
      )
      .run(
        regel.id,
        regel.art,
        regel.ebene,
        nullable(regel.tenantId),
        nullable(regel.profilId),
        nullable(regel.feld),
        regel.von,
        regel.nach,
        regel.herkunft,
        regel.bestaetigt ? 1 : 0,
        regel.bestaetigungen,
        regel.anwendungen,
        regel.vorlaeufig ? 1 : 0,
        regel.erstellt.toISOString(),
        nullable(regel.erstelltVon),
        nullable(regel.erstelltVonName),
        regel.zurueckgenommen ? regel.zurueckgenommen.toISOString() : null
      );

    return regel;
  }
}
