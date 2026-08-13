import type { LogLevel, Logger } from '../../domain/logging/LogEntry.js';
import type { TransferEventListener, TransferEventName } from '../transfer/TransferEvents.js';

/**
 * Severity of each pipeline event (spec sections 67-68).
 *
 * Discovery and per-file bookkeeping are DEBUG because a directory with
 * hundreds of files would otherwise drown the log. What an operator needs to
 * see in production stays at INFO, a retry is a WARNING because the run is
 * still healthy, and only a real failure is an ERROR.
 */
const EVENT_LEVELS: Record<TransferEventName, LogLevel> = {
  TRANSFER_RUN_STARTED: 'INFO',
  FILE_DISCOVERED: 'DEBUG',
  FILE_SELECTED: 'DEBUG',
  FILE_STABLE: 'DEBUG',
  FILE_DOWNLOADED: 'INFO',
  FILE_VALIDATED: 'INFO',
  FILE_ENCRYPTED: 'INFO',
  FILE_STORED: 'INFO',
  FILE_COMPLETED: 'DEBUG',
  FILE_RETRYING: 'WARNING',
  FILE_FAILED: 'ERROR',
  STEP_1_COMPLETED: 'INFO',
  TRANSFER_RUN_COMPLETED: 'INFO',
};

export function levelOf(event: TransferEventName): LogLevel {
  return EVENT_LEVELS[event] ?? 'INFO';
}

/** Turns pipeline events into log entries. */
export function createTransferEventLogger(
  logger: Logger,
  clock: () => Date = () => new Date()
): TransferEventListener {
  return (event) => {
    logger.log({
      timestamp: clock(),
      level: levelOf(event.name),
      message: event.message,
      jobId: event.jobId,
      runId: event.runId,
      filename: event.filename,
      context: event.details,
    });
  };
}

/** Sends each event to several listeners, for example log plus live display. */
export function combineEventListeners(...listeners: (TransferEventListener | undefined)[]): TransferEventListener {
  const active = listeners.filter((listener): listener is TransferEventListener => Boolean(listener));

  return (event) => {
    for (const listener of active) {
      try {
        listener(event);
      } catch {
        // A listener must never break the run it is observing.
      }
    }
  };
}
