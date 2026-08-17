import type { Job } from '../../api/types.js';

/**
 * Wie ausführlich ein neuer Workflow mitschreibt.
 *
 * Es gab einmal die Wahl „Wie die Installation" — ein Workflow ohne eigene
 * Angabe erbte die des Servers. Das ist gestrichen: Wer im Störungsfall wissen
 * will, wie laut ein Workflow schreibt, soll es an ihm ablesen können, statt es
 * aus zwei Stellen zusammenzusetzen. Jeder Workflow trägt seine Ausführlichkeit
 * selbst, und das hier ist der Wert, mit dem er beginnt.
 */
export const DEFAULT_JOB_LOG_LEVEL: NonNullable<Job['logLevel']> = 'INFO';
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
    // Jeder Workflow trägt seine Ausführlichkeit selbst. „Wie die Installation"
    // gab es einmal und gibt es nicht mehr: Wer im Störungsfall wissen will,
    // wie laut ein Workflow schreibt, soll es an ihm ablesen können und nicht
    // an zwei Stellen zusammensuchen müssen.
    logLevel: DEFAULT_JOB_LOG_LEVEL,
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
    // Ein lokales Verzeichnis hat keinen Zugang; einen stehen zu lassen wäre
    // eine Lüge. Eine Freigabe darf einen haben — muss aber nicht.
    credentialId: sourceType === 'LOCAL' ? undefined : job.credentialId,
  };
}

/**
 * Das Gegenstück für die Zielseite.
 *
 * `LOCAL` räumt die Verbindungsangaben ganz weg statt sie stehen zu lassen: Ein
 * Workflow, der ins Dateisystem schreibt und trotzdem einen Server und einen
 * Zugang mit sich trägt, sieht bei der nächsten Durchsicht so aus, als täte er
 * etwas anderes als er tut.
 */
export function withDestinationType(job: Job, destinationType: Job['sourceType']): Job {
  if (destinationType === 'LOCAL') {
    return { ...job, destinationType: 'LOCAL', destinationConfig: undefined, destinationCredentialId: undefined };
  }

  // Eine Freigabe braucht keine Verbindungsangaben — nur den Pfad und
  // womöglich einen Zugang. Server und Port stehen zu lassen hieße, Felder zu
  // füllen, die nichts tun.
  if (destinationType === 'SHARE') {
    return { ...job, destinationType: 'SHARE', destinationConfig: undefined };
  }

  return {
    ...job,
    destinationType,
    destinationConfig: {
      ...(job.destinationConfig ?? { type: destinationType, directory: job.destinationDirectory }),
      type: destinationType,
      port: destinationType === 'SFTP' ? 22 : 990,
      validateCertificates: destinationType === 'FTPS' ? true : undefined,
    },
  };
}

export function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
