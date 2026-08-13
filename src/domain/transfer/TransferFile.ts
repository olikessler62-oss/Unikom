import type { FileTransferStatus } from './TransferRun.js';

/**
 * How a file was dealt with. This is what makes a later run recognise the file
 * without downloading it again: both a completed transfer and a file skipped as
 * a duplicate are settled, so neither needs to be fetched a second time
 * (spec section 39).
 */
export type TransferResolution = 'TRANSFERRED' | 'DUPLICATE';

/**
 * Persistent record of one file within one transfer run (spec section 71).
 * Settled records double as the processed-file registry that duplicate
 * detection queries (spec sections 39-40).
 */
export interface TransferFile {
  id: string;
  transferRunId: string;
  jobId: string;
  sourcePath: string;
  sourceFilename: string;
  sourceSize?: number;
  sourceLastModified?: Date;
  destinationPath?: string;
  destinationFilename?: string;
  destinationSize?: number;
  sha256?: string;
  status: FileTransferStatus;
  resolution?: TransferResolution;
  errorCode?: string;
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface ProcessedFileIdentity {
  jobId: string;
  sourcePath: string;
  sourceFilename: string;
  sourceSize?: number;
  sourceLastModified?: Date;
}
