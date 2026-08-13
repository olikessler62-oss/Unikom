import type { LogEntry, Logger } from '../../domain/logging/LogEntry.js';

function formatTimestamp(timestamp: Date): string {
  return timestamp.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Human readable output in the shape of the transfer log from spec section 67.
 */
export function formatLogEntry(entry: LogEntry): string {
  const parts = [formatTimestamp(entry.timestamp), entry.level.padEnd(7)];

  if (entry.filename) {
    parts.push(entry.filename);
  }

  parts.push(entry.message);
  return parts.join('  ');
}

export class ConsoleLogger implements Logger {
  constructor(private readonly output: { log(line: string): void; error(line: string): void } = console) {}

  log(entry: LogEntry): void {
    const line = formatLogEntry(entry);

    if (entry.level === 'ERROR') {
      this.output.error(line);
      return;
    }

    this.output.log(line);
  }
}
