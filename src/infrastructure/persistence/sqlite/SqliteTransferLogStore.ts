import type { DatabaseSync } from 'node:sqlite';
import {
  isAtLeast,
  type LogEntry,
  type LogLevel,
  type Logger,
  type TransferLogQuery,
  type TransferLogRepository,
} from '../../../domain/logging/LogEntry.js';
import { nullable } from './SqliteDatabase.js';

interface LogRow {
  id: number;
  timestamp: string;
  level: string;
  job_id: string | null;
  run_id: string | null;
  filename: string | null;
  user_id: string | null;
  username: string | null;
  message: string;
  context: string | null;
}

function toEntry(row: LogRow): LogEntry {
  return {
    timestamp: new Date(row.timestamp),
    level: row.level as LogLevel,
    jobId: row.job_id ?? undefined,
    runId: row.run_id ?? undefined,
    filename: row.filename ?? undefined,
    userId: row.user_id ?? undefined,
    username: row.username ?? undefined,
    message: row.message,
    context: row.context ? (JSON.parse(row.context) as Record<string, unknown>) : undefined,
    sequence: Number(row.id),
  };
}

/**
 * Durable transfer log (spec sections 67-70 and 100). Writing is synchronous so
 * a line is on disk before the step it describes continues; reading is async
 * like every other repository.
 */
export class SqliteTransferLogStore implements Logger, TransferLogRepository {
  constructor(private readonly database: DatabaseSync) {}

  log(entry: LogEntry): void {
    this.database
      .prepare(
        `INSERT INTO transfer_logs (timestamp, level, job_id, run_id, filename, user_id, username, message, context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.timestamp.toISOString(),
        entry.level,
        nullable(entry.jobId),
        nullable(entry.runId),
        nullable(entry.filename),
        nullable(entry.userId),
        nullable(entry.username),
        entry.message,
        entry.context ? JSON.stringify(entry.context) : null
      );
  }

  async list(query: TransferLogQuery): Promise<LogEntry[]> {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];

    if (query.runId) {
      conditions.push('run_id = ?');
      parameters.push(query.runId);
    }

    if (query.jobId) {
      conditions.push('job_id = ?');
      parameters.push(query.jobId);
    }

    if (query.afterSequence !== undefined) {
      conditions.push('id > ?');
      parameters.push(Math.floor(query.afterSequence));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? `LIMIT ${Math.max(1, Math.floor(query.limit))}` : '';

    const rows = this.database
      .prepare(
        `SELECT id, timestamp, level, job_id, run_id, filename, user_id, username, message, context
         FROM transfer_logs ${where} ORDER BY id ASC ${limit}`
      )
      .all(...parameters) as unknown as LogRow[];

    const entries = rows.map(toEntry);
    const minimum = query.minimumLevel;

    return minimum ? entries.filter((entry) => isAtLeast(entry.level, minimum)) : entries;
  }

  async deleteOlderThan(cutoff: Date, jobId?: string): Promise<number> {
    const result = jobId
      ? this.database
          .prepare('DELETE FROM transfer_logs WHERE timestamp < ? AND job_id = ?')
          .run(cutoff.toISOString(), jobId)
      : this.database.prepare('DELETE FROM transfer_logs WHERE timestamp < ?').run(cutoff.toISOString());

    return Number(result.changes);
  }
}
