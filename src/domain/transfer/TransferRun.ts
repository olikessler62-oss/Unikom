export enum TransferRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  SUCCESS_NO_FILES = 'SUCCESS_NO_FILES',
  COMPLETED_WITH_ERRORS = 'COMPLETED_WITH_ERRORS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum FileTransferStatus {
  DISCOVERED = 'DISCOVERED',
  FILTERED_OUT = 'FILTERED_OUT',
  WAITING_FOR_STABILITY = 'WAITING_FOR_STABILITY',
  SKIPPED = 'SKIPPED',
  DOWNLOADING = 'DOWNLOADING',
  DOWNLOADED = 'DOWNLOADED',
  VALIDATING = 'VALIDATING',
  ENCRYPTING = 'ENCRYPTING',
  STORING = 'STORING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface TransferRun {
  id: string;
  jobId: string;
  status: TransferRunStatus;
  startedAt: Date;
  completedAt?: Date;
  filesFound: number;
  filesProcessed: number;
  filesSucceeded: number;
  filesSkipped: number;
  filesFailed: number;
}
