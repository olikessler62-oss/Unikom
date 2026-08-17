import type { Feature } from '../licensing/Feature.js';

/**
 * The links a workflow can be built from.
 *
 * None of them is a foundation the others rest on. They are separate
 * capabilities, bought separately and combined freely: moving files, cleaning up
 * records, writing them out in another format, loading them into tables. A
 * customer may own only consolidation, and their whole job is then "consolidate
 * the file that already lies in directory X" — no transfer, no output, and that
 * is a complete piece of work, not a fragment.
 *
 * That is why every link says for itself where it reads and where it writes,
 * instead of inheriting it from a neighbour that may not exist. And why the only
 * rule about combinations is that at least one link has to be switched on.
 *
 * **Links carry names, not numbers.** A number cannot mean both "which module is
 * this" and "where does it run": somebody who owns consolidation and conversion
 * runs them first and second, whatever position they hold in a full chain. So
 * the name is the identity, and the number is handed out per workflow — see
 * `numberedStages`.
 *
 * Where links do chain, the connection is a reference and not a copied path. A
 * directory filled in from the transfer step is correct until somebody edits
 * that step, and from then on it is quietly wrong — pointing at a place nothing
 * writes to any more, on a schedule nobody watches.
 */

/** Where a stage reads. */
export type StageInput =
  | { from: 'PRECEDING' }
  | { from: 'DIRECTORY'; directory: string };

/** Where a stage writes. */
export type StageOutput =
  | { to: 'FOLLOWING' }
  | { to: 'DIRECTORY'; directory: string };

/**
 * The transfer link. Its source and destination are the job's own fields — they
 * carry hosts, credentials and host key fingerprints and are far too rich to
 * fold into `StageInput`.
 *
 * Absent means switched on. Every job that existed before the link became
 * switchable did exactly this and nothing else.
 */
export interface TransferStageConfig {
  enabled: boolean;
}

/**
 * Every other link. One shape for all of them: they differ in what they do to
 * the records, not in how they are wired into the chain.
 */
export interface StageConfig {
  enabled: boolean;
  input: StageInput;
  /** Absent where the link writes somewhere that is not a directory. */
  output?: StageOutput;
}

export type StageId = 'TRANSFER' | 'CONSOLIDATE' | 'IMPORT' | 'CONVERT';

/** The shape of a workflow: which links it is built from. */
export interface WorkflowShape {
  transfer?: TransferStageConfig;
  consolidation?: StageConfig;
  dataImport?: StageConfig;
  conversion?: StageConfig;
}

/**
 * The order data runs through, and the order the links are shown in. It is
 * fixed — a workflow chooses which links it uses, not in which order they run,
 * because "convert, then consolidate" would mean consolidating a format the
 * consolidation no longer recognises.
 */
export const STAGE_ORDER: StageId[] = ['TRANSFER', 'CONSOLIDATE', 'IMPORT', 'CONVERT'];

/** What each link is called. The name is the identity; the number is not. */
export const STAGE_LABELS: Record<StageId, string> = {
  TRANSFER: 'Daten übertragen',
  CONSOLIDATE: 'Daten konsolidieren',
  IMPORT: 'Daten importieren',
  CONVERT: 'Daten konvertieren',
};

/**
 * Which module a link needs. All four are bought separately — the transfer used
 * to be free, which only held while everything else was an addition to it. Once
 * a customer can buy consolidation alone, handing them the transfer for nothing
 * would give away the module that carries the others.
 */
export const STAGE_FEATURES: Record<StageId, Feature> = {
  TRANSFER: 'TRANSFER',
  CONSOLIDATE: 'CONSOLIDATION',
  IMPORT: 'DATA_IMPORT',
  CONVERT: 'CONVERSION',
};

/** The configuration of one link, whichever it is. */
export function stageConfig(shape: WorkflowShape, stage: StageId): StageConfig | undefined {
  switch (stage) {
    case 'CONSOLIDATE':
      return shape.consolidation;
    case 'IMPORT':
      return shape.dataImport;
    case 'CONVERT':
      return shape.conversion;
    default:
      return undefined;
  }
}

/**
 * Whether the transfer link runs. Absent counts as on, so a job stored before
 * the link became switchable keeps doing what it did.
 */
export function transfers(shape: WorkflowShape): boolean {
  return shape.transfer?.enabled !== false;
}

export function stageIsActive(shape: WorkflowShape, stage: StageId): boolean {
  return stage === 'TRANSFER' ? transfers(shape) : stageConfig(shape, stage)?.enabled === true;
}

/** The links that actually run, in order. Any of them may be missing. */
export function activeStages(shape: WorkflowShape): StageId[] {
  return STAGE_ORDER.filter((stage) => stageIsActive(shape, stage));
}

/**
 * The numbers as this workflow shows them: 1, 2, 3 … over the links it actually
 * uses. A workflow of one link gets no number at all — there is no sequence to
 * mark, and a lone "1" would only suggest a missing "2".
 */
export function numberedStages(shape: WorkflowShape): Map<StageId, number> {
  const active = activeStages(shape);
  const numbers = new Map<StageId, number>();

  if (active.length < 2) {
    return numbers;
  }

  active.forEach((stage, index) => numbers.set(stage, index + 1));

  return numbers;
}

/**
 * Which link a stage reads from when it says "the preceding one" — and
 * `undefined` when there is none, which is the normal case for a workflow that
 * does not start with the transfer. Such a step has to be told a directory
 * instead; there is nothing to inherit.
 *
 * A switched-off link in the middle is closed over rather than broken at.
 */
export function precedingStage(stage: StageId, shape: WorkflowShape): StageId | undefined {
  const active = activeStages(shape);
  const position = active.indexOf(stage);

  return position > 0 ? active[position - 1] : undefined;
}

/** The counterpart: which link picks up what this one hands on. */
export function followingStage(stage: StageId, shape: WorkflowShape): StageId | undefined {
  const active = activeStages(shape);
  const position = active.indexOf(stage);

  return position >= 0 ? active[position + 1] : undefined;
}

/** Where the active links put their results — the directories that are ours. */
export function outputDirectories(shape: WorkflowShape): { stage: StageId; directory: string }[] {
  const directories: { stage: StageId; directory: string }[] = [];

  for (const stage of activeStages(shape)) {
    const output = stageConfig(shape, stage)?.output;

    if (output?.to === 'DIRECTORY') {
      directories.push({ stage, directory: output.directory });
    }
  }

  return directories;
}
