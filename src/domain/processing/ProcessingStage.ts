import type { Feature } from '../licensing/Feature.js';
import type { FileProcessingContext } from './FileProcessingContext.js';

/**
 * One step behind Step 1. Every stage takes a context and returns one, so the
 * chain is a configuration rather than an assumption in the code (spec section
 * 76 asks for exactly that: do not hard-code the pipeline).
 *
 * Because input and output have the same shape, stages can be left out
 * individually — an export runs on Step 1's result just as well as on the
 * output of a consolidation.
 */
export interface ProcessingStage {
  /** Appears in the log and in the run detail; keep it stable. */
  readonly name: string;
  /** The module a customer must own for this stage to exist at all. */
  readonly requiredFeature: Feature;
  process(context: FileProcessingContext): Promise<FileProcessingContext>;
}

/** A stage failed. Step 1 is finished at this point and stays valid. */
export class ProcessingStageError extends Error {
  constructor(
    readonly stage: string,
    readonly cause: unknown
  ) {
    super(`Stage "${stage}" failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ProcessingStageError';
  }
}
