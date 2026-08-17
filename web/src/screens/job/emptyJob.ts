import type { Job } from '../../api/types.js';
import type { Language } from '../../settings/preferences.js';

/**
 * Die Schreibweise, in der ein Zeitstempel im Dateinamen landet.
 *
 * Sie wird beim Anlegen festgehalten und danach nicht mehr angefasst. Der Name
 * entsteht nachts im Lauf, wo niemand zusieht — die Sprache des Betrachters
 * kann dort nicht gelten, und ein Workflow, dessen Dateien im Januar anders
 * heißen als im Juni, wäre für jede Weiterverarbeitung ein Problem.
 */
export function notationOf(language: Language): Job['timestampNotation'] {
  return language === 'en' ? 'MONTH_FIRST' : 'DAY_FIRST';
}

/**
 * A new job that is already safe rather than already convenient.
 *
 * SKIP over OVERWRITE, KEEP over DELETE, stability check on: the defaults are
 * the ones where a mistake costs nothing. Somebody who wants a file deleted at
 * the source should have to say so.
 */
export function emptyJob(tenantId: string, language: Language): Job {
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
    timestampNotation: notationOf(language),
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
