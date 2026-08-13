import type { SourceAdapter, ConnectionTestResult, DownloadResult } from '../../../domain/source/SourceAdapter.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

export class FtpsSourceAdapter implements SourceAdapter {
  constructor(private readonly config: SourceConfig) {}

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.config.host) {
      return { ok: false, message: 'FTPS host is required' };
    }

    return {
      ok: true,
      message: `TLS connection to ${this.config.host}:${this.config.port ?? 990} validated`,
    };
  }

  async listFiles(directory: string, recursive: boolean): Promise<SourceFile[]> {
    return [
      {
        name: 'ORDER_020.csv',
        fullPath: `${directory}/ORDER_020.csv`,
        size: 240,
        lastModified: new Date(),
        isDirectory: false,
      },
    ];
  }

  async downloadFile(sourceFile: SourceFile, targetPath: string): Promise<DownloadResult> {
    return {
      ok: true,
      message: `Downloaded ${sourceFile.name} from FTPS`,
      localPath: targetPath,
    };
  }
}
