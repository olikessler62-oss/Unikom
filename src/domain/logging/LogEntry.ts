/** Log levels from spec section 68. Production defaults to INFO. */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

const SEVERITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};

export function isAtLeast(level: LogLevel, minimum: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[minimum];
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  jobId?: string;
  runId?: string;
  filename?: string;
  /** Never put secrets in here; log entries are persisted (spec section 51). */
  context?: Record<string, unknown>;
}

/**
 * Writing is synchronous on purpose. A log line that is queued and lost when
 * the process exits is worse than none, and the SQLite driver writes
 * synchronously anyway.
 */
export interface Logger {
  log(entry: LogEntry): void;
}

export interface TransferLogQuery {
  runId?: string;
  jobId?: string;
  minimumLevel?: LogLevel;
  limit?: number;
}

export interface TransferLogRepository {
  list(query: TransferLogQuery): Promise<LogEntry[]>;
  /** Retention: log volume grows with every scheduler run (spec section 82). */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
