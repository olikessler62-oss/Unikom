import { isAtLeast, type LogEntry, type LogLevel, type Logger } from '../../domain/logging/LogEntry.js';

export const DEFAULT_LOG_LEVEL: LogLevel = 'INFO';

/** Drops everything below the configured level (spec section 68). */
export class LevelFilteredLogger implements Logger {
  constructor(
    private readonly delegate: Logger,
    private readonly minimumLevel: LogLevel = DEFAULT_LOG_LEVEL
  ) {}

  log(entry: LogEntry): void {
    if (isAtLeast(entry.level, this.minimumLevel)) {
      this.delegate.log(entry);
    }
  }
}

/**
 * Writes to several targets, typically the console and the database. One
 * failing target must not silence the others or abort a transfer.
 */
export class CompositeLogger implements Logger {
  private readonly targets: Logger[];

  constructor(...targets: Logger[]) {
    this.targets = targets;
  }

  log(entry: LogEntry): void {
    for (const target of this.targets) {
      try {
        target.log(entry);
      } catch {
        // Logging must never break the run it is describing.
      }
    }
  }
}

export const noopLogger: Logger = { log: () => {} };

/** Collects entries in memory; used by tests and by the run preview. */
export class RecordingLogger implements Logger {
  readonly entries: LogEntry[] = [];

  log(entry: LogEntry): void {
    this.entries.push(entry);
  }
}
