import type { DatabaseSync } from 'node:sqlite';

import type {
  Referenzquelle,
  Referenzquellenbestand,
  Referenzstand,
} from '../../../domain/consolidation/Referenzquelle.js';

/**
 * Die verwalteten Referenzquellen in SQLite (SPEC-04, Abschnitt 8).
 *
 * Hier liegt der **Verweis**, nicht der Datenbestand: Name, Verzeichnis, Datei,
 * Version. Die Kundenliste selbst bleibt, wo sie ist — sie hier zu spiegeln
 * hieße, sie zweimal zu haben, und beim nächsten Umzug wüsste niemand, welcher
 * Stand gilt.
 *
 * Was zuletzt darin stand, geht als JSON hinein. Es in Spalten zu zerlegen
 * hieße, die Feldliste ein zweites Mal zu beschreiben — und beim nächsten
 * zusätzlichen Feld wäre eine der beiden Beschreibungen die veraltete.
 */
interface QuelleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  directory: string;
  file: string | null;
  version: string | null;
  seen: string | null;
  created_at: string;
  created_by_name: string | null;
}

export class SqliteReferenzquellenRepository implements Referenzquellenbestand {
  constructor(private readonly database: DatabaseSync) {}

  async list(tenantId?: string): Promise<Referenzquelle[]> {
    const zeilen = (
      tenantId
        ? this.database.prepare('SELECT * FROM reference_sources WHERE tenant_id = ? ORDER BY name').all(tenantId)
        : this.database.prepare('SELECT * FROM reference_sources ORDER BY name').all()
    ) as unknown as QuelleRow[];

    return zeilen.map(alsQuelle);
  }

  async byId(id: string): Promise<Referenzquelle | undefined> {
    const zeile = this.database.prepare('SELECT * FROM reference_sources WHERE id = ?').get(id) as
      | unknown as QuelleRow
      | undefined;

    return zeile ? alsQuelle(zeile) : undefined;
  }

  async save(quelle: Referenzquelle): Promise<void> {
    this.database
      .prepare(
        'INSERT OR REPLACE INTO reference_sources ' +
          '(id, tenant_id, name, description, directory, file, version, seen, created_at, created_by_name) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        quelle.id,
        quelle.tenantId,
        quelle.name,
        quelle.beschreibung ?? null,
        quelle.verzeichnis,
        quelle.datei ?? null,
        quelle.version ?? null,
        quelle.gesehen ? JSON.stringify(quelle.gesehen) : null,
        quelle.angelegt,
        quelle.angelegtVonName ?? null
      );
  }

  async entferne(id: string): Promise<void> {
    this.database.prepare('DELETE FROM reference_sources WHERE id = ?').run(id);
  }
}

function alsQuelle(zeile: QuelleRow): Referenzquelle {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    name: zeile.name,
    beschreibung: zeile.description ?? undefined,
    verzeichnis: zeile.directory,
    datei: zeile.file ?? undefined,
    version: zeile.version ?? undefined,
    gesehen: zeile.seen ? (JSON.parse(zeile.seen) as Referenzstand) : undefined,
    angelegt: zeile.created_at,
    angelegtVonName: zeile.created_by_name ?? undefined,
  };
}
