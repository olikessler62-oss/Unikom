import type { SourceAdapter, ConnectionTestResult, DownloadResult } from '../../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export class LocalSourceAdapter implements SourceAdapter {
  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: 'Local source connection successful' };
  }

  async listFiles(directory: string, recursive: boolean): Promise<SourceFile[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: SourceFile[] = [];

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const stat = await fs.stat(fullPath);

      if (entry.isDirectory()) {
        if (recursive) {
          const nested = await this.listFiles(fullPath, true);
          files.push(...nested);
        }
        files.push({
          name: entry.name,
          fullPath,
          isDirectory: true,
          metadata: { pathType: 'directory' },
        });
        continue;
      }

      files.push({
        name: entry.name,
        fullPath,
        size: stat.size,
        lastModified: new Date(stat.mtimeMs),
        isDirectory: false,
        metadata: { pathType: 'file' },
      });
    }

    return files;
  }

  async downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult> {
    await fs.copyFile(sourceFile.fullPath, targetPath);
    return { ok: true, message: 'File copied successfully', localPath: targetPath };
  }

  async moveFile(sourceFile: SourceFile, targetDirectory: string): Promise<void> {
    await fs.mkdir(targetDirectory, { recursive: true });
    const destination = path.join(targetDirectory, sourceFile.name);
    await fs.rename(sourceFile.fullPath, destination);
  }

  async deleteFile(sourceFile: SourceFile): Promise<void> {
    await fs.unlink(sourceFile.fullPath);
  }
}
