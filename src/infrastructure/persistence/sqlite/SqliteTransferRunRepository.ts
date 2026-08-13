import type { DatabaseSync } from 'node:sqlite';
import type { TransferRun } from '../../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../../domain/transfer/TransferRunRepository.js';
import { reviveRun } from '../TransferRecordMapping.js';

interface DocumentRow {
  document: string;
}

export class SqliteTransferRunRepository implements TransferRunRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<TransferRun[]> {
    const rows = this.database
      .prepare('SELECT document FROM transfer_runs ORDER BY started_at DESC')
      .all() as unknown as DocumentRow[];

    return rows.map((row) => reviveRun(JSON.parse(row.document) as Record<string, unknown>));
  }

  async listByJob(jobId: string): Promise<TransferRun[]> {
    const rows = this.database
      .prepare('SELECT document FROM transfer_runs WHERE job_id = ? ORDER BY started_at DESC')
      .all(jobId) as unknown as DocumentRow[];

    return rows.map((row) => reviveRun(JSON.parse(row.document) as Record<string, unknown>));
  }

  async getById(id: string): Promise<TransferRun | undefined> {
    const row = this.database.prepare('SELECT document FROM transfer_runs WHERE id = ?').get(id) as
      | unknown as DocumentRow
      | undefined;

    return row ? reviveRun(JSON.parse(row.document) as Record<string, unknown>) : undefined;
  }

  async save(run: TransferRun): Promise<TransferRun> {
    this.database
      .prepare(
        `INSERT INTO transfer_runs (id, job_id, status, started_at, document)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status   = excluded.status,
           document = excluded.document`
      )
      .run(run.id, run.jobId, run.status, run.startedAt.toISOString(), JSON.stringify(run));

    return run;
  }
}
