import type { SourceAdapter, ConnectionTestResult, DownloadResult } from '../../../domain/source/SourceAdapter.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';
import type { SourceFile } from '../../../domain/files/SourceFile.js';

const NOT_IMPLEMENTED =
  'The SFTP adapter is not implemented yet (spec section 6, phase 7). ' +
  'It needs a real SSH client including host key verification before any job may use it.';

/**
 * Placeholder for the SFTP source. It deliberately reports failure instead of
 * pretending to transfer files: a job that silently claims success while
 * nothing was downloaded would violate the core rule of spec section 116.
 */
export class SftpSourceAdapter implements SourceAdapter {
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
