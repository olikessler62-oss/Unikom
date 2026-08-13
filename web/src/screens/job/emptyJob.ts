import type { Job } from '../../api/types.js';

/**
 * A new job that is already safe rather than already convenient.
 *
 * SKIP over OVERWRITE, KEEP over DELETE, stability check on: the defaults are
 * the ones where a mistake costs nothing. Somebody who wants a file deleted at
 * the source should have to say so.
 */
export function emptyJob(tenantId: string): Job {
  return {
    id: '',
    tenantId,
    name: '',
    enabled: true,

    sourceType: 'LOCAL',
    sourceConfig: { type: 'LOCAL', directory: '' },
    sourceDirectory: '',
    includeSubdirectories: false,

    caseSensitivePrefix: false,
    allowedExtensions: [],
    ignoredTemporaryExtensions: ['.part', '.tmp', '.temp', '.filepart'],
    minimumFileAgeSeconds: 60,
    stabilityCheck: {
      enabled: true,
      intervalSeconds: 5,
      requiredStableChecks: 2,
      compareSize: true,
      compareLastModified: true,
    },

    destinationDirectory: '',
    createDestinationDirectory: true,
    conflictStrategy: 'SKIP',
    encryptionConfig: { enabled: false, provider: 'NONE' },
    sourceSuccessAction: 'KEEP',

    detectContentDuplicates: false,

    executionMode: 'MANUAL_AND_AUTOMATIC',
    schedule: {
      type: 'INTERVAL',
      intervalMinutes: 15,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
      missedRunPolicy: 'SKIP',
    },
  };
}

/** Keeps sourceConfig.directory and sourceDirectory from drifting apart. */
export function withSourceDirectory(job: Job, directory: string): Job {
  return {
    ...job,
    sourceDirectory: directory,
    sourceConfig: { ...job.sourceConfig, directory },
  };
}

export function withSourceType(job: Job, sourceType: Job['sourceType']): Job {
  return {
    ...job,
    sourceType,
    sourceConfig: {
      ...job.sourceConfig,
      type: sourceType,
      port: sourceType === 'SFTP' ? 22 : sourceType === 'FTPS' ? 990 : undefined,
      // Certificates are validated unless somebody turns it off deliberately.
      validateCertificates: sourceType === 'FTPS' ? true : undefined,
    },
    // A local source has no credential; leaving one attached would be a lie.
    credentialId: sourceType === 'LOCAL' ? undefined : job.credentialId,
  };
}

export function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
