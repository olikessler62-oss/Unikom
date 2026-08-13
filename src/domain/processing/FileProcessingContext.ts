import type { SourceFile } from '../files/SourceFile.js';

/**
 * The hand-over contract from spec section 75, taken over field for field.
 *
 * Step 1 fills it once a file reached STEP_1_COMPLETED (section 78). Every
 * later stage receives it, may change it, and passes it on — which is what
 * makes the stages freely combinable: an export can run directly on Step 1's
 * result, without a consolidation ever having taken place.
 */
export interface FileProcessingContext {
  runId: string;
  jobId: string;
  sourceFile: SourceFile;
  /** The name at the source, unchanged for the whole chain. */
  originalFilename: string;
  /** The name the file carries right now; encryption appends `.enc`. */
  currentFilename: string;
  /**
   * The staging path the file was processed in. After final storage nothing
   * lies there any more — the field documents where the work happened, it is
   * not a location a later stage may read from.
   */
  temporaryPath: string;
  /** Where the file can be read at this moment. This is what stages work on. */
  currentFilePath: string;
  finalDestinationPath?: string;
  /** Size of the file at `currentFilePath`, in bytes. */
  fileSize?: number;
  /**
   * Checksum of the *content* that was taken over, calculated before any
   * encryption. This is the value duplicate detection works with (section 39),
   * and it stays the identity of the content across the whole chain.
   *
   * With `encrypted: true` it is therefore deliberately not the checksum of the
   * bytes lying at `currentFilePath` — it is the checksum of what those bytes
   * decrypt to. A stage that wants to verify the stored file byte for byte has
   * to take that into account.
   */
  sha256?: string;
  /**
   * Whether the file at `currentFilePath` is encrypted. A stage that wants to
   * read the content has to decrypt it first; there is no stage yet that does.
   */
  encrypted: boolean;
  /**
   * Free space for the stages. Step 2 records here what it found, Step 3 reads
   * it. Never put secrets in it: the context ends up in events and logs
   * (section 51).
   */
  metadata: Record<string, unknown>;
}

/** What a stage may change about the file it was handed. */
export type ProcessingStageChanges = Partial<
  Pick<
    FileProcessingContext,
    'currentFilename' | 'currentFilePath' | 'finalDestinationPath' | 'fileSize' | 'sha256' | 'encrypted'
  >
> & { metadata?: Record<string, unknown> };

/**
 * Produces the context for the next stage. Fields that are not mentioned keep
 * their value, and metadata is merged rather than replaced: a stage adds to
 * what the earlier ones found instead of overwriting their findings.
 */
export function advanceContext(
  context: FileProcessingContext,
  changes: ProcessingStageChanges = {}
): FileProcessingContext {
  return {
    ...context,
    currentFilename: changes.currentFilename ?? context.currentFilename,
    currentFilePath: changes.currentFilePath ?? context.currentFilePath,
    finalDestinationPath: changes.finalDestinationPath ?? context.finalDestinationPath,
    fileSize: changes.fileSize ?? context.fileSize,
    sha256: changes.sha256 ?? context.sha256,
    encrypted: changes.encrypted ?? context.encrypted,
    metadata: { ...context.metadata, ...changes.metadata },
  };
}
