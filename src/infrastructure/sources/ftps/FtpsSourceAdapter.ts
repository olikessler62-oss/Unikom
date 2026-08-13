import type { SourceAdapter, ConnectionTestResult, DownloadResult } from '../../../domain/source/SourceAdapter.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

const NOT_IMPLEMENTED =
  'The FTPS adapter is not implemented yet (spec section 7, phase 8). ' +
  'It needs a real explicit-FTPS client including certificate validation before any job may use it.';

/**
 * Placeholder for the FTPS source. Like the SFTP adapter it reports failure
 * rather than faking a successful transfer.
 */
export class FtpsSourceAdapter implements SourceAdapter {
  constructor(private readonly config: SourceConfig) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: false, message: NOT_IMPLEMENTED };
  }

  async listFiles(_directory: string, _recursive: boolean): Promise<SourceFile[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async downloadFile(_sourceFile: SourceFile, _targetPath: string): Promise<DownloadResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
