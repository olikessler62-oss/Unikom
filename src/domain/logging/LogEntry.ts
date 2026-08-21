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
  /**
   * Wer die Handlung ausgelöst hat — die dauerhafte Kennung des Benutzers.
   *
   * Fehlt bei allem, was der Zeitplan von selbst tut: Ein nächtlicher Lauf hat
   * keinen Urheber, und einen zu erfinden wäre schlimmer als keiner.
   */
  userId?: string;
  /**
   * Sein Anmeldename **zum Zeitpunkt der Handlung**, mitgeschrieben und nicht
   * nachgeschlagen.
   *
   * Die Kennung ist eindeutig und dauerhaft, aber niemand liest sie: In einem
   * Protokoll, das ein Kunde per Mail schickt, sagt `9f2c…` nichts. Der Name
   * sagt es — und er steht so da, wie er damals war. Wer ihn später ändert oder
   * das Konto löscht, ändert nichts an dem, was geschehen ist. Beides zusammen
   * beantwortet auch die Frage, die eines Tages kommt: zwei Namen, eine Person,
   * oder ein Name, zwei Personen?
   */
  username?: string;
  /**
   * The detail this entry's job asked for, where it differs from what the
   * installation asked for.
   *
   * It travels on the entry rather than being looked up by the filter: the run
   * knows its job, the filter does not, and a lookup would mean a repository
   * read per line. This is what lets one job be turned up to DEBUG while the
   * rest of the installation stays at INFO — the case an operator actually has,
   * which is one workflow behaving oddly and a support call about it.
   */
  jobLevel?: LogLevel;
  /**
   * Set by the store when reading, never by whoever writes: the position of
   * this entry in the log. A live view asks for everything after the highest
   * number it has, which timestamps cannot answer — several entries share a
   * millisecond, and one of them would be read twice or not at all.
   */
  sequence?: number;
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
  /** Only entries beyond this position — how a live view stays live cheaply. */
  afterSequence?: number;
}

export interface TransferLogRepository {
  list(query: TransferLogQuery): Promise<LogEntry[]>;
  /**
   * Retention: log volume grows with every scheduler run (spec section 82).
   * Limited to one job when a retention period is configured per job; without
   * `jobId` it covers the whole log.
   */
  deleteOlderThan(cutoff: Date, jobId?: string): Promise<number>;
}
