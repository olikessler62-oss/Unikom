import {
  isAtLeast,
  type LogEntry,
  type Logger,
  type TransferLogQuery,
  type TransferLogRepository,
} from '../../domain/logging/LogEntry.js';

export class InMemoryTransferLogStore implements Logger, TransferLogRepository {
  private readonly entries: LogEntry[] = [];

  log(entry: LogEntry): void {
    this.entries.push({ ...entry });
  }

  async list(query: TransferLogQuery): Promise<LogEntry[]> {
    let result = this.entries.filter(
      (entry) =>
        (query.runId === undefined || entry.runId === query.runId) &&
        (query.jobId === undefined || entry.jobId === query.jobId) &&
        (query.minimumLevel === undefined || isAtLeast(entry.level, query.minimumLevel))
    );

    if (query.limit !== undefined) {
      result = result.slice(0, Math.max(1, Math.floor(query.limit)));
    }

    return result.map((entry) => ({ ...entry }));
  }

  async deleteOlderThan(cutoff: Date, jobId?: string): Promise<number> {
    const before = this.entries.length;

    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];

      if (entry.timestamp.getTime() < cutoff.getTime() && (jobId === undefined || entry.jobId === jobId)) {
        this.entries.splice(index, 1);
      }
    }

    return before - this.entries.length;
  }
}
