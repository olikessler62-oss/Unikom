import type { DatabaseSync } from 'node:sqlite';

import type { Ausleitung, Ausleitungsart, Ausleitungsbestand } from '../../../domain/conflicts/Ausleitung.js';

/**
 * Der Bestand der Ausleitungen in SQLite (SPEC-07, Dateimodell).
 *
 * Er weiß, welche Dateien Unikom geschrieben hat — und ist damit die
 * Voraussetzung dafür, dass die Bereinigung nur eigene Dateien anfasst. Eine
 * Aufräumung, die stattdessen ein Verzeichnis nach Namensmustern durchsucht,
 * räumt eines Tages eine fremde Datei fort.
 *
 * Es gibt kein `delete`: Fortgeräumt wird die Datei, nicht der Eintrag.
 */
interface ExportRow {
  id: string;
  tenant_id: string;
  kind: string;
  run_id: string | null;
  path: string;
  name: string;
  cases: number;
  created_at: string;
  created_by_name: string | null;
  removed_at: string | null;
}

export class SqliteAusleitungsRepository implements Ausleitungsbestand {
  constructor(private readonly database: DatabaseSync) {}

  async list(tenantId?: string): Promise<Ausleitung[]> {
    const zeilen = (
      tenantId
        ? this.database
            .prepare('SELECT * FROM conflict_exports WHERE tenant_id = ? ORDER BY created_at DESC')
            .all(tenantId)
        : this.database.prepare('SELECT * FROM conflict_exports ORDER BY created_at DESC').all()
    ) as unknown as ExportRow[];

    return zeilen.map(alsAusleitung);
  }

  async save(ausleitung: Ausleitung): Promise<void> {
    this.database
      .prepare(
        'INSERT OR REPLACE INTO conflict_exports ' +
          '(id, tenant_id, kind, run_id, path, name, cases, created_at, created_by_name, removed_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        ausleitung.id,
        ausleitung.tenantId,
        ausleitung.art,
        ausleitung.laufId ?? null,
        ausleitung.pfad,
        ausleitung.name,
        ausleitung.faelle,
        ausleitung.erstellt,
        ausleitung.erstelltVonName ?? null,
        ausleitung.entferntAm ?? null
      );
  }
}

function alsAusleitung(zeile: ExportRow): Ausleitung {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    art: zeile.kind as Ausleitungsart,
    laufId: zeile.run_id ?? undefined,
    pfad: zeile.path,
    name: zeile.name,
    faelle: zeile.cases,
    erstellt: zeile.created_at,
    erstelltVonName: zeile.created_by_name ?? undefined,
    entferntAm: zeile.removed_at ?? undefined,
  };
}
