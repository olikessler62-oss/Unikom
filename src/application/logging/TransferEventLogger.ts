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
  // Announcements are DEBUG, completions INFO: at INFO the log reads as what
  // happened, at DEBUG as what was being attempted at every moment. Both are
  // wanted, by different readers, at different times.
  SOURCE_STEP: 'DEBUG',
  DESTINATION_STEP: 'DEBUG',
  RUN_STEP: 'DEBUG',
  // Ein Abbruch ist kein Fehler, aber auch nichts, was im Kleingedruckten
  // stehen darf: Jemand hat eingegriffen, und das erklärt den Rest des Laufs.
  RUN_CANCELLED: 'WARNING',
  FILE_CHECKED: 'DEBUG',
  FILE_RENAMED: 'INFO',
  FILE_DISCOVERED: 'DEBUG',
  FILE_SELECTED: 'DEBUG',
  FILE_STABLE: 'DEBUG',
  FILE_DOWNLOADING: 'DEBUG',
  FILE_DOWNLOADED: 'INFO',
  FILE_VALIDATING: 'DEBUG',
  FILE_VALIDATED: 'INFO',
  FILE_DECRYPTING: 'DEBUG',
  FILE_DECRYPTED: 'INFO',
  FILE_ENCRYPTING: 'DEBUG',
  FILE_ENCRYPTED: 'INFO',
  FILE_STORING: 'DEBUG',
  FILE_STORED: 'INFO',
  SOURCE_FILE_SETTLED: 'INFO',
  FILE_COMPLETED: 'DEBUG',
  FILE_RETRYING: 'WARNING',
  FILE_FAILED: 'ERROR',
  STEP_1_COMPLETED: 'INFO',
  PROCESSING_STAGE_COMPLETED: 'INFO',
  PROCESSING_STAGE_FAILED: 'ERROR',
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
      jobLevel: event.jobLevel,
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
