import type { SourceFile } from '../files/SourceFile.js';

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Filled by "test connection" in the job editor (spec section 52). */
  filesFound?: number;
}

export interface DownloadResult {
  ok: boolean;
  message: string;
  localPath?: string;
}

/**
 * Access data for a remote source, resolved from a credential right before the
 * connection is opened. It never enters a transfer job, a log or a repository.
 */
export interface SourceCredentials {
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SourceAdapter {
  testConnection(): Promise<ConnectionTestResult>;
  listFiles(directory: string, recursive: boolean): Promise<SourceFile[]>;
  downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult>;
  moveFile?(sourceFile: SourceFile, targetDirectory: string): Promise<void>;
  deleteFile?(sourceFile: SourceFile): Promise<void>;
  /** Releases a network connection; local sources do not need it. */
  dispose?(): Promise<void>;
}
