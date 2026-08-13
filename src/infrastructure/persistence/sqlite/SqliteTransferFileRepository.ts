import type { DatabaseSync } from 'node:sqlite';
import type { ProcessedFileIdentity, TransferFile } from '../../../domain/transfer/TransferFile.js';
import type { TransferFileRepository } from '../../../domain/transfer/TransferFileRepository.js';
import { matchesIdentity } from '../../../domain/transfer/TransferFileMatching.js';
import { FileTransferStatus } from '../../../domain/transfer/TransferRun.js';
import { reviveTransferFile } from '../TransferRecordMapping.js';
import { nullable } from './SqliteDatabase.js';

interface DocumentRow {
  document: string;
}

/**
 * SQL counterpart of `isResolved`: a settled file is either transferred or
 * recognised as a duplicate. Kept next to the query it belongs to, while the
 * fine-grained identity comparison stays in the domain rule.
 */
const RESOLVED_CONDITION = `(status = '${FileTransferStatus.SUCCESS}' OR (status = '${FileTransferStatus.SKIPPED}' AND resolution = 'DUPLICATE'))`;

export class SqliteTransferFileRepository implements TransferFileRepository {
  constructor(private readonly database: DatabaseSync) {}

  async save(file: TransferFile): Promise<TransferFile> {
    this.database
      .prepare(
        `INSERT INTO transfer_files
           (id, transfer_run_id, job_id, source_path, source_filename, sha256, status, resolution, document)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sha256     = excluded.sha256,
           status     = excluded.status,
           resolution = excluded.resolution,
           document   = excluded.document`
      )
      .run(
        file.id,
        file.transferRunId,
        file.jobId,
        file.sourcePath,
        file.sourceFilename,
        nullable(file.sha256),
        file.status,
        nullable(file.resolution),
        JSON.stringify(file)
      );

    return file;
  }

  async listByRun(transferRunId: string): Promise<TransferFile[]> {
    return this.query('SELECT document FROM transfer_files WHERE transfer_run_id = ?', transferRunId);
  }

  async listByJob(jobId: string): Promise<TransferFile[]> {
    return this.query('SELECT document FROM transfer_files WHERE job_id = ?', jobId);
  }

  async findResolvedByIdentity(identity: ProcessedFileIdentity): Promise<TransferFile | undefined> {
    // The index narrows this to the few records for this exact name; size and
    // modification time are then compared by the domain rule so that the
    // definition of "same file" lives in exactly one place.
    const candidates = await this.query(
      `SELECT document FROM transfer_files
       WHERE job_id = ? AND source_path = ? AND source_filename = ? AND ${RESOLVED_CONDITION}`,
      identity.jobId,
      identity.sourcePath,
      identity.sourceFilename
    );

    return candidates.find((candidate) => matchesIdentity(candidate, identity));
  }

  async findSuccessfulByHash(jobId: string, sha256: string): Promise<TransferFile | undefined> {
    const [found] = await this.query(
      `SELECT document FROM transfer_files
       WHERE job_id = ? AND sha256 = ? AND status = ? LIMIT 1`,
      jobId,
      sha256,
      FileTransferStatus.SUCCESS
    );

    return found;
  }

  private async query(sql: string, ...parameters: string[]): Promise<TransferFile[]> {
    const rows = this.database.prepare(sql).all(...parameters) as unknown as DocumentRow[];
    return rows.map((row) => reviveTransferFile(JSON.parse(row.document) as Record<string, unknown>));
  }
}
