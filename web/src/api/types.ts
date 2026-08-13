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

export interface Job {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;
  sourceType: 'LOCAL' | 'SFTP' | 'FTPS';
  sourceDirectory: string;
  destinationDirectory: string;
  filenamePrefix?: string;
  allowedExtensions: string[];
  conflictStrategy: 'SKIP' | 'OVERWRITE' | 'RENAME';
  sourceSuccessAction: 'KEEP' | 'MOVE' | 'DELETE';
  encryptionConfig: { enabled: boolean; provider: 'NONE' | 'AES_256_GCM'; keyCredentialId?: string };
  executionMode: 'MANUAL' | 'AUTOMATIC' | 'MANUAL_AND_AUTOMATIC';
  nextExecutionAt?: string;
  lastExecutionAt?: string;
  /** Filled by the list: modules this job needs but the licence lacks. */
  missingFeatures?: Feature[];
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
