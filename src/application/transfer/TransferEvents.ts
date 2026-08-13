/**
 * Pipeline hooks from spec section 77. Deliberately kept as a plain listener
 * instead of an event bus: there is no technical reason for more yet, and
 * STEP_1_COMPLETED is the documented hand-over point to step 2 (section 78).
 */
export type TransferEventName =
  | 'TRANSFER_RUN_STARTED'
  | 'FILE_DISCOVERED'
  | 'FILE_SELECTED'
  | 'FILE_STABLE'
  | 'FILE_DOWNLOADED'
  | 'FILE_VALIDATED'
  | 'FILE_ENCRYPTED'
  | 'FILE_STORED'
  | 'FILE_COMPLETED'
  | 'FILE_FAILED'
  | 'STEP_1_COMPLETED'
  | 'TRANSFER_RUN_COMPLETED';

export interface TransferEvent {
  name: TransferEventName;
  runId: string;
  jobId: string;
  filename?: string;
  message: string;
  /** Never put secrets in here; events end up in logs (spec section 51). */
  details?: Record<string, unknown>;
}

export type TransferEventListener = (event: TransferEvent) => void;

export const noopEventListener: TransferEventListener = () => {};
