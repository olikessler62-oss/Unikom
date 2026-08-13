export type SourceType = 'LOCAL' | 'SFTP' | 'FTPS';
export type ExecutionMode = 'MANUAL' | 'AUTOMATIC' | 'MANUAL_AND_AUTOMATIC';
export type ConflictStrategy = 'SKIP' | 'OVERWRITE' | 'RENAME';
export type SourceSuccessAction = 'KEEP' | 'MOVE' | 'DELETE';
export type EncryptionProvider = 'NONE' | 'AES_256_GCM';

export interface SourceConfig {
  type: SourceType;
  directory: string;
  recursive?: boolean;
  host?: string;
  port?: number;
  username?: string;
  timeoutSeconds?: number;
  retryAttempts?: number;
  useSshPrivateKey?: boolean;
  tls?: boolean;
  validateCertificates?: boolean;
}

export interface StabilityCheckConfig {
  enabled: boolean;
  intervalSeconds: number;
  requiredStableChecks: number;
  compareSize: boolean;
  compareLastModified: boolean;
}

export interface EncryptionConfig {
  enabled: boolean;
  provider: EncryptionProvider;
  keyCredentialId?: string;
}

export interface JobSchedule {
  type: 'INTERVAL' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'CRON';
  intervalMinutes?: number;
  executionTime?: string;
  weekdays?: number[];
  cronExpression?: string;
  timezone: string;
  missedRunPolicy: 'SKIP';
}

export interface TransferJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  sourceType: SourceType;
  sourceConfig: SourceConfig;
  credentialId?: string;
  sourceDirectory: string;
  includeSubdirectories: boolean;
  filenamePrefix?: string;
  caseSensitivePrefix: boolean;
  allowedExtensions: string[];
  ignoredTemporaryExtensions: string[];
  minimumFileAgeSeconds: number;
  stabilityCheck: StabilityCheckConfig;
  destinationDirectory: string;
  createDestinationDirectory: boolean;
  conflictStrategy: ConflictStrategy;
  encryptionConfig: EncryptionConfig;
  sourceSuccessAction: SourceSuccessAction;
  sourceArchiveDirectory?: string;
  executionMode: ExecutionMode;
  schedule?: JobSchedule;
  lastExecutionAt?: Date;
  nextExecutionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
