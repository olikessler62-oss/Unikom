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

export type Feature =
  | 'REMOTE_SOURCES'
  | 'ENCRYPTION'
  | 'STEP_2_CONSOLIDATION'
  | 'STEP_3_FILE_EXPORT'
  | 'STEP_3_DATABASE_MIGRATION';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  enabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
}

export interface Identity {
  user: User;
  permissions: Permission[];
  mustChangePassword: boolean;
  csrfToken?: string;
  features?: Feature[];
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
  conflictStrategy: 'SKIP' | 'OVERWRITE' | 'RENAME';
  encryptionConfig: { enabled: boolean; provider: 'NONE' | 'AES_256_GCM'; keyCredentialId?: string };
  sourceSuccessAction: 'KEEP' | 'MOVE' | 'DELETE';
  sourceArchiveDirectory?: string;

  maxConcurrentFiles?: number;
  detectContentDuplicates?: boolean;
  retention?: { logDays?: number; historyDays?: number };

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
