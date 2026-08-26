import type { DatabaseSync } from 'node:sqlite';

import type { Archivpaket, Paketbestand } from '../../../domain/transfer/Archivpaket.js';

/**
 * Der Bestand der Archivpakete in SQLite (SPEC-07, Abschnitt 13).
 *
 * Er weiß, welches Paket zu welchem Lauf gehört — und ist damit der Griff, an
 * dem der Korrekturlauf die ursprüngliche Lieferung wiederfindet.
 *
 * Es gibt kein `delete`: Fortgeräumt wird die Datei, nicht der Eintrag.
 */
interface PaketRow {
  id: string;
  tenant_id: string;
  job_id: string;
  run_id: string;
  path: string;
  name: string;
  files: number;
  created_at: string;
  removed_at: string | null;
}

export class SqlitePaketRepository implements Paketbestand {
  constructor(private readonly database: DatabaseSync) {}

  async list(tenantId?: string): Promise<Archivpaket[]> {
    const zeilen = (
      tenantId
        ? this.database
            .prepare('SELECT * FROM archive_packages WHERE tenant_id = ? ORDER BY created_at DESC')
            .all(tenantId)
        : this.database.prepare('SELECT * FROM archive_packages ORDER BY created_at DESC').all()
    ) as unknown as PaketRow[];

    return zeilen.map(alsPaket);
  }

  /**
   * Das jüngste Paket dieses Laufs.
   *
   * Jüngste und nicht „das eine": Ein Workflow mit mehreren Durchgängen legt je
   * abholendem Durchgang eines ab, alle unter derselben Laufkennung. Der
   * Korrekturlauf meint den, aus dem der Konflikt stammt — und das ist bei
   * einer Kette der letzte, der gerechnet hat.
   */
  async zuLauf(laufId: string): Promise<Archivpaket | undefined> {
    const zeile = this.database
      .prepare('SELECT * FROM archive_packages WHERE run_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(laufId) as unknown as PaketRow | undefined;

    return zeile ? alsPaket(zeile) : undefined;
  }

  async save(paket: Archivpaket): Promise<void> {
    this.database
      .prepare(
        'INSERT OR REPLACE INTO archive_packages ' +
          '(id, tenant_id, job_id, run_id, path, name, files, created_at, removed_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        paket.id,
        paket.tenantId,
        paket.jobId,
        paket.laufId,
        paket.pfad,
        paket.name,
        paket.dateien,
        paket.erstellt,
        paket.entferntAm ?? null
      );
  }
}

function alsPaket(zeile: PaketRow): Archivpaket {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    jobId: zeile.job_id,
    laufId: zeile.run_id,
    pfad: zeile.path,
    name: zeile.name,
    dateien: zeile.files,
    erstellt: zeile.created_at,
    entferntAm: zeile.removed_at ?? undefined,
  };
}
