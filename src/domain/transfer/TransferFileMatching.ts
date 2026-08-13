import type { ProcessedFileIdentity, TransferFile } from './TransferFile.js';
import { FileTransferStatus } from './TransferRun.js';

function sameOptionalDate(left?: Date, right?: Date): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.getTime() === right.getTime();
}

/**
 * Identity of a source file for duplicate detection (spec section 40): never
 * the filename alone. An unknown size or timestamp on one side counts as a
 * difference, so an unproven match is re-processed rather than silently
 * skipped.
 */
export function matchesIdentity(file: TransferFile, identity: ProcessedFileIdentity): boolean {
  return (
    file.jobId === identity.jobId &&
    file.sourcePath === identity.sourcePath &&
    file.sourceFilename === identity.sourceFilename &&
    file.sourceSize === identity.sourceSize &&
    sameOptionalDate(file.sourceLastModified, identity.sourceLastModified)
  );
}

/**
 * A settled file needs no further work. Transferring it counts, and so does
 * skipping it as a duplicate — otherwise a file whose timestamp changed while
 * its content stayed the same would be downloaded again on every single run.
 *
 * A failed attempt is never settled, so it is always retried (section 108), and
 * neither is a file skipped because the destination was occupied: that decision
 * can change as soon as the destination file is removed.
 */
export function isResolved(file: TransferFile): boolean {
  if (file.status === FileTransferStatus.SUCCESS) {
    return true;
  }

  return file.status === FileTransferStatus.SKIPPED && file.resolution === 'DUPLICATE';
}

/** Only a completed transfer proves the content is present in the destination. */
export function isSuccessful(file: TransferFile): boolean {
  return file.status === FileTransferStatus.SUCCESS;
}
