import type { Feature, Job, StageConfig, StageId } from '../../api/types.js';

/**
 * Die Kette, wie die Oberfläche sie liest.
 *
 * Dieselben Ableitungen wie im Server — bewusst noch einmal, statt sie zu
 * importieren: Der Server entscheidet, die Oberfläche stellt nur dar, und ein
 * geteiltes Modul würde die beiden Rollen vermischen. Weicht etwas ab, fällt es
 * an den Fehlermeldungen des Servers auf, nicht an stillen Fehlberechnungen.
 */

/** Die Reihenfolge, in der die Daten durchlaufen. */
export const STAGE_ORDER: StageId[] = ['TRANSFER', 'CONSOLIDATE', 'IMPORT', 'CONVERT'];

/** Der Name trägt die Identität des Moduls — die Nummer nicht. */
export const STAGE_LABELS: Record<StageId, string> = {
  TRANSFER: 'Daten übertragen',
  CONSOLIDATE: 'Daten konsolidieren',
  IMPORT: 'Daten importieren',
  CONVERT: 'Daten konvertieren',
};

export const STAGE_DESCRIPTIONS: Record<StageId, string> = {
  TRANSFER: 'Dateien aus einer Quelle abholen und in einem Zielverzeichnis ablegen.',
  CONSOLIDATE:
    'Mehrere Dateien zusammenführen, Werte korrigieren und anreichern, doppelte Datensätze erkennen.',
  IMPORT: 'Datensätze in Datenbanktabellen übernehmen.',
  CONVERT: 'Die Daten in ein anderes Dateiformat schreiben.',
};

/** Welches Modul ein Glied braucht. Das Übertragen ist das Grundprodukt. */
export const STAGE_FEATURES: Record<StageId, Feature | undefined> = {
  TRANSFER: undefined,
  CONSOLIDATE: 'CONSOLIDATION',
  IMPORT: 'DATA_IMPORT',
  CONVERT: 'CONVERSION',
};

/** Wo die Einstellung eines Gliedes am Job liegt. */
export const STAGE_FIELDS = {
  CONSOLIDATE: 'consolidation',
  IMPORT: 'dataImport',
  CONVERT: 'conversion',
} as const;

export type ConfigurableStage = keyof typeof STAGE_FIELDS;

export function isConfigurable(stage: StageId): stage is ConfigurableStage {
  return stage !== 'TRANSFER';
}

export function stageOf(job: Job, stage: StageId): StageConfig | undefined {
  return isConfigurable(stage) ? job[STAGE_FIELDS[stage]] : undefined;
}

/** Ob übertragen wird. Fehlt die Angabe, wird übertragen — so war es immer. */
export function transfers(job: Job): boolean {
  return job.transfer?.enabled !== false;
}

export function stageIsActive(job: Job, stage: StageId): boolean {
  return stage === 'TRANSFER' ? transfers(job) : stageOf(job, stage)?.enabled === true;
}

export function activeStages(job: Job): StageId[] {
  return STAGE_ORDER.filter((stage) => stageIsActive(job, stage));
}

/**
 * Die Nummern dieses Workflows: 1, 2, 3 … über die Glieder, die er wirklich
 * benutzt. Bei nur einem Glied gibt es keine — eine einsame „1" ließe bloß eine
 * fehlende „2" vermuten.
 */
export function numbersOf(job: Job): Map<StageId, number> {
  const active = activeStages(job);
  const numbers = new Map<StageId, number>();

  if (active.length > 1) {
    active.forEach((stage, index) => numbers.set(stage, index + 1));
  }

  return numbers;
}

/**
 * Welches Glied vor diesem liegt — und was dort herauskommt. `undefined`, wenn
 * keines davor liegt: dann gibt es nichts zu erben und das Glied muss ein
 * Verzeichnis genannt bekommen.
 */
export function precedingOf(job: Job, stage: StageId): { label: string; path: string } | undefined {
  const active = activeStages(job);
  const position = active.indexOf(stage);

  if (position <= 0) {
    return undefined;
  }

  const before = active[position - 1];

  if (before === 'TRANSFER') {
    return { label: STAGE_LABELS.TRANSFER, path: job.destinationDirectory };
  }

  const output = stageOf(job, before)?.output;

  return {
    label: STAGE_LABELS[before],
    path: output?.to === 'DIRECTORY' ? output.directory : '(wird direkt weitergereicht, ohne Zwischenablage)',
  };
}

/** Welches Glied hinter diesem liegt — für die Wahl „reicht weiter an …". */
export function followingOf(job: Job, stage: StageId): string | undefined {
  const active = activeStages(job);
  const position = active.indexOf(stage);
  const after = position >= 0 ? active[position + 1] : undefined;

  return after ? STAGE_LABELS[after] : undefined;
}
