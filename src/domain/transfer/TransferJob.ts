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

  /**
   * Expected SSH host key, as OpenSSH prints it: `SHA256:<base64>`.
   * Without it the connection is refused unless `allowUnknownHostKey` is set,
   * because host key verification may not be switched off silently (spec
   * section 6).
   */
  hostKeyFingerprint?: string;
  /** Deliberate, documented opt-out of host key verification. */
  allowUnknownHostKey?: boolean;

  tls?: boolean;
  /** TLS certificates are validated unless this is explicitly set to false. */
  validateCertificates?: boolean;
  /**
   * PEM certificate to trust in addition to the system store. This is how a
   * server with a private or self-signed certificate is accepted without
   * turning verification off altogether.
   */
  trustedCertificate?: string;
  /** Implicit FTPS connects with TLS from the first byte (spec section 7). */
  implicitFtps?: boolean;
}

/** Retry behaviour for temporary faults (spec sections 65-66). */
export interface RetryConfig {
  /** Total attempts including the first one. */
  attempts: number;
  /** Delay before attempt 2, 3, ... in seconds. */
  delaysSeconds: number[];
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
  /** Files processed at the same time; defaults to 3 (spec section 79). */
  maxConcurrentFiles?: number;
  /** Defaults to three attempts at 0, 5 and 15 seconds (spec section 65). */
  retry?: RetryConfig;

  executionMode: ExecutionMode;
  schedule?: JobSchedule;
  lastExecutionAt?: Date;
  nextExecutionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
