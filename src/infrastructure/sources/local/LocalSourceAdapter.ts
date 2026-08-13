import type { SourceAdapter, ConnectionTestResult, DownloadResult } from '../../../domain/source/SourceAdapter.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export class LocalSourceAdapter implements SourceAdapter {
  /**
   * The configured directory. Optional only because older callers built this
   * adapter without one; without it a connection test cannot say anything.
   */
  constructor(private readonly directory?: string) {}

  /**
   * Really looks. This used to answer "successful" unconditionally, which is
   * the worst possible answer for a button labelled "test connection": somebody
   * mistypes a path, is told it is fine, saves the job, and finds out at three
   * in the morning that nothing was ever picked up.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.directory) {
      return { ok: false, message: 'No source directory is configured' };
    }

    let entries;

    try {
      entries = await fs.readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT') {
        return { ok: false, message: `The directory ${this.directory} does not exist` };
      }

      if (code === 'ENOTDIR') {
        return { ok: false, message: `${this.directory} is a file, not a directory` };
      }

      if (code === 'EACCES' || code === 'EPERM') {
        return { ok: false, message: `No permission to read ${this.directory}` };
      }

      return {
        ok: false,
        message: `${this.directory} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const filesFound = entries.filter((entry) => entry.isFile()).length;

    return {
      ok: true,
      message: `Directory ${this.directory} can be read`,
      // Section 52: the editor shows this, so a directory that is reachable but
      // empty looks different from one that has something in it.
      filesFound,
    };
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
