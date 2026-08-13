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

/**
 * How long records about transferred files are kept. Both stores hold file
 * names, and a file name is regularly personal data — "Rechnung_Mueller.pdf"
 * names a person. Keeping them without a stated period is hard to justify
 * (Art. 5(1)(e) GDPR).
 *
 * The two settings are deliberately not one, because deleting them has very
 * different consequences.
 */
export interface RetentionConfig {
  /**
   * Log entries older than this are deleted. This has no effect on transfers;
   * only the trail of what happened gets shorter. Defaults to 90 days.
   */
  logDays?: number;
  /**
   * Records of taken-over files older than this are deleted. **This changes
   * behaviour**: those records are the duplicate registry, so a file that is
   * still lying in the source directory becomes unknown again and is taken over
   * a second time.
   *
   * It only matters for `sourceSuccessAction: 'KEEP'`. A job that moves or
   * deletes its source files has nothing left to pick up twice.
   *
   * Undefined means keep indefinitely — there is no safe default here, so the
   * decision stays with whoever configures the job.
   */
  historyDays?: number;
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
  /**
   * The client this job belongs to. An installation always has at least the
   * standard tenant, so this is never empty — a service provider who collects
   * data for several clients keeps them apart by it, and everything the job
   * writes stays inside that client's directory.
   */
  tenantId: string;
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
  /** How long log and file history are kept; defaults to 90 days of log. */
  retention?: RetentionConfig;
  /**
   * Whether two files with identical content but different names count as
   * duplicates, so that the second one is not stored. **Off by default.**
   *
   * Which files a source system provides is its own decision. Whether the same
   * content arriving twice under two names is a mistake or intended is
   * something we cannot tell from here, and silently withholding a file the
   * customer sent is the riskier of the two assumptions.
   *
   * Worth switching on for one specific pattern: source systems that rewrite
   * their files nightly without changing anything. Same name, new modification
   * time - the repeat protection does not catch that, this does.
   *
   * Independent of this, the same source file is never fetched twice; that is
   * what makes a scheduled run repeatable and is not configurable.
   */
  detectContentDuplicates?: boolean;

  executionMode: ExecutionMode;
  schedule?: JobSchedule;
  lastExecutionAt?: Date;
  nextExecutionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
