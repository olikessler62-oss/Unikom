import type { TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';

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
    lastExecutionAt: optionalDate(raw.lastExecutionAt),
    nextExecutionAt: optionalDate(raw.nextExecutionAt),
    createdAt: requiredDate(raw.createdAt, 'createdAt'),
    updatedAt: requiredDate(raw.updatedAt, 'updatedAt'),
  };
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
