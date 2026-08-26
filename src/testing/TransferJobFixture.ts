import { DEFAULT_TENANT_ID } from '../domain/tenants/Tenant.js';
import type { TransferJob } from '../domain/transfer/TransferJob.js';
import type { Dateiwahl } from '../domain/transfer/Konsolidierungsschritt.js';
import type { StageInput } from '../domain/transfer/WorkflowStages.js';

/**
 * Baseline job used by the tests. It mirrors the fully configured example from
 * spec section 3, reduced to a local source so tests need no network.
 *
 * Die vier Pflichtverzeichnisse eines abholenden Durchgangs kommen dabei von
 * selbst dazu — siehe `mitAblage`. Ohne sie fängt kein Lauf an und lässt sich
 * kein Workflow speichern, und jeder Test über irgendetwas anderes müsste sie
 * mit aufzählen.
 */
export function createTransferJob(overrides: Partial<TransferJob> = {}): TransferJob {
  const sourceDirectory = overrides.sourceDirectory ?? 'C:/Import';

  return mitAblage({
    id: 'job-customer-a',
    tenantId: DEFAULT_TENANT_ID,
    name: 'Customer A Orders',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: sourceDirectory },
    sourceDirectory,
    // Mit Stern: Seit ein Muster ohne Stern den vollen Namen meint, ist das die
    // Schreibweise für „Name beginnt so" — und die Dateien der Tests heißen
    // ORDER_001.csv, nicht ORDER_.
    filenamePrefix: 'ORDER_*',
    allowedExtensions: ['csv'],
    ignoredTemporaryExtensions: ['.part', '.tmp'],
    minimumFileAgeSeconds: 0,
    stabilityCheck: {
      enabled: false,
      intervalSeconds: 0,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: true,
    },
    destinationDirectory: 'D:/Data/Incoming/CustomerA',
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    sourceSuccessAction: 'KEEP',
    executionMode: 'MANUAL_AND_AUTOMATIC',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  });
}

/** Die vier Pflichtverzeichnisse, wie die Tests sie benutzen. */
export const TESTABLAGE = {
  archiv: '/archiv',
  arbeit: '/arbeit',
  erledigt: '/erledigt',
  gescheitert: '/gescheitert',
};

/**
 * Füllt die vier Pflichtverzeichnisse eines abholenden Durchgangs auf.
 *
 * Seit sie Pflicht sind, fängt ein Durchgang ohne sie nicht an — und ein Test
 * über Dublettenregeln, der sie einzeln aufzählen müsste, prüfte ab dann vier
 * Verzeichnisse mit. Was ein Test selbst setzt, bleibt stehen; auch ein
 * ausdrückliches `undefined`, denn genau damit prüft man das Fehlen.
 *
 * Nur bei `DIRECTORY`: Ein Durchgang, dem die Dateien gereicht werden, hat kein
 * Abholverzeichnis, aus dem etwas herauszunehmen wäre.
 */
export function mitAblage(job: TransferJob): TransferJob {
  const schritt = job.consolidation;

  if (!schritt) {
    return job;
  }

  return {
    ...job,
    consolidation: {
      ...ergaenze(schritt),
      ...(schritt.weitere ? { weitere: schritt.weitere.map(ergaenze) } : {}),
    },
  };
}

function ergaenze<T extends { input: StageInput; dateien?: Dateiwahl }>(durchgang: T): T {
  if (durchgang.input.from !== 'DIRECTORY') {
    return durchgang;
  }

  return {
    ...durchgang,
    dateien: { ...durchgang.dateien, abholung: { ...TESTABLAGE, ...durchgang.dateien?.abholung } },
  };
}
