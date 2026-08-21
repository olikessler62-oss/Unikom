import type { TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';
import type { StageConfig } from '../../domain/transfer/WorkflowStages.js';

/**
 * Turns stored records back into domain objects. Dates are the reason this
 * exists: JSON only knows strings, and a schedule calculated on a string
 * silently produces wrong results instead of failing.
 */

export function optionalDate(value: unknown): Date | undefined {
  return typeof value === 'string' ? new Date(value) : undefined;
}

export function requiredDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new Error(`Stored record is missing the required date field "${field}"`);
  }

  return new Date(value);
}

export function reviveJob(raw: Record<string, unknown>): TransferJob {
  return {
    ...(raw as unknown as TransferJob),
    delivery: reviveDelivery(raw),
    encryptionConfig: reviveEncryption(raw.encryptionConfig),
    lastExecutionAt: optionalDate(raw.lastExecutionAt),
    nextExecutionAt: optionalDate(raw.nextExecutionAt),
    createdAt: requiredDate(raw.createdAt, 'createdAt'),
    updatedAt: requiredDate(raw.updatedAt, 'updatedAt'),
  };
}

/**
 * Liest einen Workflow, der noch zwei Glieder für das Ausliefern hatte.
 *
 * „Daten importieren" und „Daten konvertieren" standen einmal als zwei
 * Kettenglieder nebeneinander. Das war falsch: Wer in eine Datenbank
 * importiert, konvertiert davor keine Datei, und das Konvertieren las in dieser
 * Kette aus dem Import — der Tabellen füllt und keine Datei hinterlässt.
 *
 * Aus zweien wird deshalb eines mit einer Verzweigung. War beides eingeschaltet,
 * **gewinnt der Datenbankimport**: Er ist der Zweig, der ein fremdes System
 * berührt, und ein stiller Wechsel auf die Datei wäre die gefährlichere
 * Auslegung. Der Fall ist theoretisch — die Kette konnte so nie sinnvoll
 * laufen —, aber er darf nicht unentschieden bleiben.
 *
 * Übersetzt beim Lesen und nicht in einer Migration: Ein gespeicherter Workflow
 * wird weit öfter gelesen als geschrieben, und einer, der nie wieder gespeichert
 * wird, behielte sonst für immer seine alte Schreibweise.
 */
function reviveDelivery(raw: Record<string, unknown>): TransferJob['delivery'] {
  const bereits = raw.delivery as TransferJob['delivery'];

  if (bereits) {
    return bereits;
  }

  const alterImport = raw.dataImport as StageConfig | undefined;
  const alteKonvertierung = raw.conversion as StageConfig | undefined;

  if (alterImport?.enabled) {
    return { ...alterImport, ziel: 'DATENBANK' };
  }

  if (alteKonvertierung?.enabled) {
    return { ...alteKonvertierung, ziel: 'DATEI', konvertieren: { format: 'CSV' } };
  }

  return undefined;
}

/**
 * Reads a job written before encryption became two settings.
 *
 * Back then one `timing` said when to encrypt, and it only meant anything
 * while encryption was switched on at all — the editor showed it nowhere else.
 * So `ON_PICKUP` together with `enabled` becomes `onPickup`, and a `timing`
 * left behind by a checkbox somebody unticked becomes nothing, which is what
 * it did then too.
 *
 * Translated on the way in rather than in a migration: a stored job is read
 * far more often than it is written, and a job that never gets saved again
 * would keep its old spelling forever.
 */
function reviveEncryption(raw: unknown): TransferJob['encryptionConfig'] {
  const stored = raw as (TransferJob['encryptionConfig'] & { timing?: string }) | undefined;

  if (!stored || stored.onPickup !== undefined || stored.timing === undefined) {
    return stored as TransferJob['encryptionConfig'];
  }

  const { timing, ...rest } = stored;

  return { ...rest, onPickup: timing === 'ON_PICKUP' && stored.enabled === true };
}

export function reviveRun(raw: Record<string, unknown>): TransferRun {
  return {
    ...(raw as unknown as TransferRun),
    startedAt: requiredDate(raw.startedAt, 'startedAt'),
    completedAt: optionalDate(raw.completedAt),
  };
}

export function reviveTransferFile(raw: Record<string, unknown>): TransferFile {
  return {
    ...(raw as unknown as TransferFile),
    sourceLastModified: optionalDate(raw.sourceLastModified),
    startedAt: requiredDate(raw.startedAt, 'startedAt'),
    completedAt: optionalDate(raw.completedAt),
  };
}
