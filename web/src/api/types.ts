/**
 * What the API sends. Kept as its own definitions rather than importing the
 * server types: dates arrive as strings over JSON, and the interface should
 * notice when a field disappears instead of silently reading undefined.
 */

export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type Permission =
  | 'VIEW'
  | 'RUN_JOBS'
  | 'MANAGE_JOBS'
  | 'MANAGE_CREDENTIALS'
  | 'MANAGE_USERS';

/**
 * Vier Module werden verkauft — Übertragen eingeschlossen; entfernte Quellen und
 * Verschlüsselung sind Fähigkeiten darin, keine Produkte daneben.
 */
export type Feature =
  | 'TRANSFER'
  | 'REMOTE_SOURCES'
  | 'ENCRYPTION'
  | 'CONSOLIDATION'
  | 'DATA_IMPORT'
  | 'CONVERSION';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  enabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
}

/**
 * Wie lange diese Installation bezahlt ist. Der Server entscheidet damit, die
 * Oberfläche berichtet es nur — geprüft wird vor jeder Übertragung, nicht hier.
 */
export type LicenceState = 'UNLICENSED' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | 'INVALID';

export interface Licence {
  state: LicenceState;
  /** Ob Übertragungen starten dürfen. Alles andere bleibt immer erreichbar. */
  mayRun: boolean;
  customer?: string;
  licenceId?: string;
  validUntil?: string;
  daysRemaining?: number;
  problem?: string;
  features?: Feature[];
}

export interface Identity {
  user: User;
  permissions: Permission[];
  mustChangePassword: boolean;
  csrfToken?: string;
  features?: Feature[];
  licence?: Licence;
}

export interface Tenant {
  id: string;
  name: string;
  description?: string;
  rootDirectory?: string;
  enabled: boolean;
  jobCount?: number;
}

export type SourceType = 'LOCAL' | 'SFTP' | 'FTPS';

export interface SourceConfig {
  type: SourceType;
  directory: string;
  /**
   * Wo diese Verbindung auf dem Server beginnt, wenn nicht im Anmeldeordner.
   * Jeder eingegebene Pfad wird von hier aus gelesen, und keiner darf hinaus.
   */
  remoteWorkingDirectory?: string;
  recursive?: boolean;
  host?: string;
  port?: number;
  timeoutSeconds?: number;
  /** `SHA256:<base64>`, the way OpenSSH prints it. */
  hostKeyFingerprint?: string;
  allowUnknownHostKey?: boolean;
  validateCertificates?: boolean;
  trustedCertificate?: string;
  implicitFtps?: boolean;
}

export interface Schedule {
  type: 'INTERVAL' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'CRON';
  intervalMinutes?: number;
  executionTime?: string;
  weekdays?: number[];
  cronExpression?: string;
  timezone: string;
  missedRunPolicy: 'SKIP';
}

/**
 * Woher ein Kettenglied liest und wohin es schreibt.
 *
 * `PRECEDING` und `FOLLOWING` sind Verweise, keine Pfade: ändert jemand das Ziel
 * des Gliedes davor, folgt dieses mit. Ein vorbestücktes Textfeld wäre genau bis
 * zu dieser Änderung richtig und danach still falsch.
 */
export type StageInput = { from: 'PRECEDING' } | { from: 'DIRECTORY'; directory: string };
export type StageOutput = { to: 'FOLLOWING' } | { to: 'DIRECTORY'; directory: string };

/**
 * Jedes Glied außer dem Übertragen. Eine Form für alle: sie unterscheiden sich
 * darin, was sie mit den Daten tun, nicht darin, wie sie eingehängt sind.
 */
export interface StageConfig {
  enabled: boolean;
  input: StageInput;
  /** Fehlt, wo das Glied nicht in ein Verzeichnis schreibt. */
  output?: StageOutput;
}

/** Die Glieder, aus denen ein Workflow gebaut wird — Namen, keine Nummern. */
export type StageId = 'TRANSFER' | 'CONSOLIDATE' | 'IMPORT' | 'CONVERT';

export interface Job {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;

  sourceType: SourceType;
  sourceConfig: SourceConfig;
  sourceDirectory: string;
  credentialId?: string;
  /**
   * Was die Quelle liefert — das Gegenstück zu `encryptionConfig`, das
   * beschreibt, was ins Ziel geht. Zwei Einstellungen, weil es zwei Schlüssel
   * sind: der des Absenders öffnet, der eigene verschließt.
   */
  sourceEncryption?: {
    enabled: boolean;
    keyCredentialId?: string;
    /** Ohne dies wird eine unverschlüsselte Datei abgelehnt. */
    acceptPlaintext?: boolean;
  };
  includeSubdirectories: boolean;

  filenamePrefix?: string;
  caseSensitivePrefix: boolean;
  allowedExtensions: string[];
  ignoredTemporaryExtensions: string[];
  minimumFileAgeSeconds: number;
  stabilityCheck: {
    enabled: boolean;
    intervalSeconds: number;
    requiredStableChecks: number;
    compareSize: boolean;
    compareLastModified: boolean;
  };

  destinationDirectory: string;
  createDestinationDirectory: boolean;
  /**
   * Wohin geschrieben wird; fehlt heißt Dateisystem. Eine Windows-Freigabe ist
   * kein eigener Typ — ein UNC-Pfad ist ein Pfad.
   */
  destinationType?: SourceType;
  /** Dieselben Verbindungsangaben wie bei der Quelle, weil es dieselben sind. */
  destinationConfig?: SourceConfig;
  destinationCredentialId?: string;
  conflictStrategy: 'SKIP' | 'OVERWRITE' | 'RENAME' | 'NEW_NAME';
  /** Der Name für NEW_NAME — ohne Endung, die bringt die Datei mit. */
  conflictFilename?: string;
  /** Schreibweise des Zeitstempels; fehlt heißt Tag zuerst. */
  timestampNotation?: 'DAY_FIRST' | 'MONTH_FIRST';
  encryptionConfig: {
    enabled: boolean;
    provider: 'NONE' | 'AES_256_GCM';
    keyCredentialId?: string;
    /** Schon beim Abholen verschlüsseln — unabhängig davon, was im Ziel liegt. */
    onPickup?: boolean;
  };
  sourceSuccessAction: 'KEEP' | 'MOVE' | 'DELETE';
  sourceArchiveDirectory?: string;

  maxConcurrentFiles?: number;
  detectContentDuplicates?: boolean;
  /** Wie ausführlich dieser Workflow protokolliert; fehlt heißt: wie die Installation. */
  logLevel?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
  /** Ob jedes Laufprotokoll zusätzlich als Datei abgelegt wird; voreingestellt aus. */
  saveProtocol?: boolean;
  /** Wohin, wenn nicht in das Protokollverzeichnis der Installation. */
  protocolDirectory?: string;
  retention?: { logDays?: number; historyDays?: number };

  /** Daten übertragen; fehlt heißt: läuft. So verhielt sich jeder Job bisher. */
  transfer?: { enabled: boolean };
  /** Daten konsolidieren. */
  consolidation?: StageConfig;
  /** Daten importieren — in Datenbanktabellen, daher ohne Zielverzeichnis. */
  dataImport?: StageConfig;
  /** Daten konvertieren — in ein anderes Dateiformat. */
  conversion?: StageConfig;

  executionMode: 'MANUAL' | 'AUTOMATIC' | 'MANUAL_AND_AUTOMATIC';
  schedule?: Schedule;
  nextExecutionAt?: string;
  lastExecutionAt?: string;
  createdAt?: string;
  updatedAt?: string;

  /** Filled by the list: modules this job needs but the licence lacks. */
  missingFeatures?: Feature[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  filesFound?: number;
  /** Was auf dem Weg geschah — Auflösen, Verbinden, Hostkey, Anmelden, Lesen. */
  steps?: string[];
}

/** Ein Verzeichnis auf dem entfernten Server, wie der Server es nennt. */
export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  /** Ohne das Remote-Arbeitsverzeichnis — so, wie es ins Eingabefeld gehört. */
  relativePath: string;
}

export interface RemoteDirectoryResult {
  ok: boolean;
  message: string;
  path?: string;
  relativePath?: string;
  parentPath?: string;
  entries: RemoteDirectoryEntry[];
  filesFound?: number;
  /** Mehrere Lesarten der Eingabe gibt es wirklich — dann wird nicht geraten. */
  ambiguous?: string[];
  /** Alle geprüften Lesarten, in der Reihenfolge der Prüfung. */
  tried?: string[];
}

export interface DirectoryCheckResult {
  ok: boolean;
  message: string;
  exists: boolean;
  writable: boolean;
  wouldBeCreated?: boolean;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export interface RunSummary {
  runId: string;
  jobId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  filesFound: number;
  filesProcessed: number;
  filesSucceeded: number;
  filesSkipped: number;
  filesFailed: number;
}

export type FileStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'SKIPPED' | 'FAILED';

export interface TransferFile {
  id: string;
  transferRunId: string;
  jobId: string;
  sourcePath: string;
  sourceFilename: string;
  sourceSize?: number;
  destinationFilename?: string;
  destinationSize?: number;
  sha256?: string;
  status: FileStatus;
  resolution?: 'TRANSFERRED' | 'DUPLICATE';
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  jobId?: string;
  runId?: string;
  filename?: string;
  /** Stelle im Protokoll. Die Leitwarte holt damit nur, was neu ist. */
  sequence?: number;
}

export type RunControlState = 'RUNNING' | 'PAUSED' | 'CANCELLED';

/** Ein Lauf, der gerade in Arbeit ist — die Zeilen der Leitwarte. */
export interface ActiveRun {
  runId: string;
  jobId: string;
  jobName: string;
  tenantId: string;
  startedAt: string;
  state: RunControlState;
}

export interface RunDetail extends RunSummary {
  jobName?: string;
  files: TransferFile[];
  logs: LogEntry[];
}

export interface Dashboard {
  activeJobs: number;
  runsToday: number;
  filesTransferredToday: number;
  filesFailedToday: number;
  runningJobs: string[];
  nextExecutions: { jobId: string; jobName: string; nextExecutionAt: string }[];
}

export interface Credential {
  id: string;
  tenantId?: string;
  name: string;
  type: 'USERNAME_PASSWORD' | 'SSH_PRIVATE_KEY' | 'ENCRYPTION_KEY';
  username?: string;
}
