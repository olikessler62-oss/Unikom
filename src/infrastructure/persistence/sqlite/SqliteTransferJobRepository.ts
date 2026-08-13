import type { DatabaseSync } from 'node:sqlite';
import type { TransferJob } from '../../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../../domain/transfer/TransferJobRepository.js';
import { reviveJob } from '../TransferRecordMapping.js';
import { nullable } from './SqliteDatabase.js';

interface DocumentRow {
  document: string;
}

export class SqliteTransferJobRepository implements TransferJobRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<TransferJob[]> {
    const rows = this.database.prepare('SELECT document FROM transfer_jobs').all() as unknown as DocumentRow[];
    return rows.map((row) => reviveJob(JSON.parse(row.document) as Record<string, unknown>));
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    const row = this.database.prepare('SELECT document FROM transfer_jobs WHERE id = ?').get(id) as
      | unknown as DocumentRow
      | undefined;

    return row ? reviveJob(JSON.parse(row.document) as Record<string, unknown>) : undefined;
  }

  async save(job: TransferJob): Promise<TransferJob> {
    const stored: TransferJob = { ...job, updatedAt: new Date() };

    this.database
      .prepare(
        `INSERT INTO transfer_jobs (id, enabled, next_execution_at, document)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           enabled           = excluded.enabled,
           next_execution_at = excluded.next_execution_at,
           document          = excluded.document`
      )
      .run(
        stored.id,
        stored.enabled ? 1 : 0,
        nullable(stored.nextExecutionAt?.toISOString()),
        JSON.stringify(stored)
      );

    return stored;
  }

  async delete(id: string): Promise<void> {
    this.database.prepare('DELETE FROM transfer_jobs WHERE id = ?').run(id);
  }
}
