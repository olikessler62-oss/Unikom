import type { SourceConfig } from '../../domain/transfer/TransferJob.js';
import type { SourceAdapter } from '../../domain/source/SourceAdapter.js';
import { LocalSourceAdapter } from './local/LocalSourceAdapter.js';
import { SftpSourceAdapter } from './sftp/SftpSourceAdapter.js';
import { FtpsSourceAdapter } from './ftps/FtpsSourceAdapter.js';

export class SourceAdapterFactory {
  static create(config: SourceConfig): SourceAdapter {
    switch (config.type) {
      case 'LOCAL':
        return new LocalSourceAdapter();
      case 'SFTP':
        return new SftpSourceAdapter(config);
      case 'FTPS':
        return new FtpsSourceAdapter(config);
      default:
        throw new Error(`Unsupported source type: ${String(config.type)}`);
    }
  }
}
