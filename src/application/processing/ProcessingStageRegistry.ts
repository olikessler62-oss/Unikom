import type { FeatureSet } from '../../domain/licensing/Feature.js';
import type { FileProcessingContext } from '../../domain/processing/FileProcessingContext.js';
import { ProcessingStageError, type ProcessingStage } from '../../domain/processing/ProcessingStage.js';

export type StageObserver = (stage: string, context: FileProcessingContext) => void;

/**
 * Holds the stages that run behind STEP_1_COMPLETED, in the order they were
 * registered. A stage whose module is missing never gets registered, so an
 * unlicensed capability does not exist at runtime — it is not merely hidden.
 */
export class ProcessingStageRegistry {
  private readonly registered: ProcessingStage[] = [];

  constructor(private readonly features: FeatureSet) {}

  /** Returns whether the stage was taken; false means the module is missing. */
  register(stage: ProcessingStage): boolean {
    if (!this.features.isEnabled(stage.requiredFeature)) {
      return false;
    }

    this.registered.push(stage);
    return true;
  }

  get stages(): readonly ProcessingStage[] {
    return this.registered;
  }

  get isEmpty(): boolean {
    return this.registered.length === 0;
  }

  /**
   * Runs the chain. A failing stage stops the remaining ones for this file —
   * their input would be missing — but it does not undo Step 1: the file is
   * stored and registered by then, and the source file has already been dealt
   * with. The caller reports the failure, it does not repair it.
   */
  async run(context: FileProcessingContext, onStageCompleted?: StageObserver): Promise<FileProcessingContext> {
    let current = context;

    for (const stage of this.registered) {
      const before = current;

      try {
        current = await stage.process(before);
      } catch (error) {
        throw new ProcessingStageError(stage.name, error);
      }

      assertFileAndHashAgree(stage.name, before, current);
      onStageCompleted?.(stage.name, current);
    }

    return current;
  }
}

/**
 * A stage that writes a new file has to supply the new hash and size with it.
 * Otherwise the context would carry a checksum belonging to the previous file,
 * and every later stage — and the export at the end of the chain — would
 * confirm an integrity that nobody ever checked.
 *
 * Encrypting and decrypting are the exception, and a deliberate one: they
 * change how the content is represented, not the content itself. The checksum
 * is the identity of the content (see FileProcessingContext.sha256), so it has
 * to survive both. A stage says so by flipping `encrypted`.
 */
function assertFileAndHashAgree(
  stage: string,
  before: FileProcessingContext,
  after: FileProcessingContext
): void {
  if (after.currentFilePath === before.currentFilePath || after.encrypted !== before.encrypted) {
    return;
  }

  if (after.sha256 !== undefined && after.sha256 === before.sha256) {
    throw new ProcessingStageError(
      stage,
      new Error(
        `it replaced the file with "${after.currentFilePath}" but kept the previous SHA-256; ` +
          'a stage that rewrites the file must supply the hash of the new one'
      )
    );
  }
}
