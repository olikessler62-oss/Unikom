import type { LogLevel } from '../../domain/logging/LogEntry.js';

/**
 * Pipeline hooks from spec section 77. Deliberately kept as a plain listener
 * instead of an event bus: there is no technical reason for more yet, and
 * STEP_1_COMPLETED is the documented hand-over point to step 2 (section 78).
 */
export type TransferEventName =
  | 'TRANSFER_RUN_STARTED'
  /**
   * What the source itself is doing: resolving a path, connecting, checking the
   * host key, authenticating, listing, moving.
   *
   * Reported by the adapter, not guessed from outside. A connection that hangs
   * is diagnosed by the last line that was written, and "connecting" written
   * before the attempt is worth more than "connected" written after it.
   */
  | 'SOURCE_STEP'
  /**
   * Dasselbe für die Zielseite: Verzeichnis anlegen, verbinden, hochladen,
   * umbenennen. Getrennt vom Quellschritt, weil bei einem Lauf von Server zu
   * Server sonst nicht zu erkennen wäre, welche der beiden Seiten klemmt.
   */
  | 'DESTINATION_STEP'
  /** Ein Schritt des Laufs selbst: Arbeitsbereich, Zielverzeichnis, Aufräumen. */
  | 'RUN_STEP'
  /** Der Lauf wurde von Hand angehalten und beendet. */
  | 'RUN_CANCELLED'
  /** Ob diese Datei schon einmal übernommen wurde — auch wenn nicht. */
  | 'FILE_CHECKED'
  /** Der Name im Ziel weicht ab, weil dort schon eine Datei so heißt. */
  | 'FILE_RENAMED'
  | 'FILE_DISCOVERED'
  | 'FILE_SELECTED'
  | 'FILE_STABLE'
  /*
   * Each step of a file is announced before it happens and reported after it.
   * A step that only reports its success leaves nothing behind when it hangs,
   * and "which file was it stuck on" is the first question in every support
   * call about a run that never finished.
   */
  | 'FILE_DOWNLOADING'
  | 'FILE_DOWNLOADED'
  | 'FILE_VALIDATING'
  | 'FILE_VALIDATED'
  /** The source delivered it locked and it is being opened in staging. */
  | 'FILE_DECRYPTING'
  | 'FILE_DECRYPTED'
  | 'FILE_ENCRYPTING'
  | 'FILE_ENCRYPTED'
  | 'FILE_STORING'
  | 'FILE_STORED'
  /** Moving or deleting the source file, after everything else succeeded. */
  | 'SOURCE_FILE_SETTLED'
  | 'FILE_COMPLETED'
  /** A temporary fault is about to be retried; not a failure yet (section 65). */
  | 'FILE_RETRYING'
  | 'FILE_FAILED'
  | 'STEP_1_COMPLETED'
  /** A stage behind Step 1 finished or failed; Step 1 itself stays valid. */
  | 'PROCESSING_STAGE_COMPLETED'
  | 'PROCESSING_STAGE_FAILED'
  | 'TRANSFER_RUN_COMPLETED';

export interface TransferEvent {
  name: TransferEventName;
  runId: string;
  jobId: string;
  filename?: string;
  message: string;
  /** Never put secrets in here; events end up in logs (spec section 51). */
  details?: Record<string, unknown>;
  /**
   * How much detail this job asked for. Set centrally by the run, honoured by
   * the logger — see `LogEntry.jobLevel`.
   */
  jobLevel?: LogLevel;
}

export type TransferEventListener = (event: TransferEvent) => void;

export const noopEventListener: TransferEventListener = () => {};
