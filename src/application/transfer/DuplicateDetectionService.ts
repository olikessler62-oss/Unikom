import type { SourceFile } from '../../domain/files/SourceFile.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';

export type DuplicateReason = 'IDENTICAL_SOURCE_FILE' | 'IDENTICAL_CONTENT';

export interface DuplicateCheckResult {
  duplicate: boolean;
  reason?: DuplicateReason;
  previousTransferFileId?: string;
  message: string;
}

const NO_DUPLICATE: DuplicateCheckResult = { duplicate: false, message: 'No earlier successful transfer found' };

/**
 * Prevents the same file from being transferred again on every scheduler run
 * (spec sections 39-40). Only successful earlier transfers count, so a failed
 * attempt is always retried.
 */
export class DuplicateDetectionService {
  constructor(private readonly repository: TransferFileRepository) {}

  /**
   * Checked before the download: has this very source file already been taken
   * over successfully? Identity covers path, name, size and modification time,
   * never the filename alone.
   */
  async checkSourceFile(jobId: string, sourceDirectory: string, file: SourceFile): Promise<DuplicateCheckResult> {
    const previous = await this.repository.findResolvedByIdentity({
      jobId,
      sourcePath: sourceDirectory,
      sourceFilename: file.name,
      sourceSize: file.size,
      sourceLastModified: file.lastModified,
    });

    if (!previous) {
      return NO_DUPLICATE;
    }

    return {
      duplicate: true,
      reason: 'IDENTICAL_SOURCE_FILE',
      previousTransferFileId: previous.id,
      message: `${file.name} was already settled on ${previous.completedAt?.toISOString() ?? 'an earlier run'}`,
    };
  }

  /**
   * Checked after the download, once the hash is known: the same content may
   * already be present under a different filename (spec section 108).
   */
  async checkContent(jobId: string, sha256: string): Promise<DuplicateCheckResult> {
    const previous = await this.repository.findSuccessfulByHash(jobId, sha256);

    if (!previous) {
      return NO_DUPLICATE;
    }

    return {
      duplicate: true,
      reason: 'IDENTICAL_CONTENT',
      previousTransferFileId: previous.id,
      message: `Identical content was already transferred as ${previous.sourceFilename}`,
    };
  }
}
