import { DEFAULT_TENANT_ID } from '../domain/tenants/Tenant.js';
import type { TransferJob } from '../domain/transfer/TransferJob.js';

/**
 * Baseline job used by the tests. It mirrors the fully configured example from
 * spec section 3, reduced to a local source so tests need no network.
 */
export function createTransferJob(overrides: Partial<TransferJob> = {}): TransferJob {
  const sourceDirectory = overrides.sourceDirectory ?? 'C:/Import';

  return {
    id: 'job-customer-a',
    tenantId: DEFAULT_TENANT_ID,
    name: 'Customer A Orders',
    enabled: true,
    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: sourceDirectory },
    sourceDirectory,
    includeSubdirectories: false,
    // Mit Stern: Seit ein Muster ohne Stern den vollen Namen meint, ist das die
    // Schreibweise für „Name beginnt so" — und die Dateien der Tests heißen
    // ORDER_001.csv, nicht ORDER_.
    filenamePrefix: 'ORDER_*',
    caseSensitivePrefix: false,
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
  };
}
