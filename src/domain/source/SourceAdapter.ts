import type { SourceFile } from '../files/SourceFile.js';

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface DownloadResult {
  ok: boolean;
  message: string;
  localPath?: string;
}

export interface SourceAdapter {
  testConnection(): Promise<ConnectionTestResult>;
  listFiles(directory: string, recursive: boolean): Promise<SourceFile[]>;
  downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult>;
  moveFile?(sourceFile: SourceFile, targetDirectory: string): Promise<void>;
  deleteFile?(sourceFile: SourceFile): Promise<void>;
}
