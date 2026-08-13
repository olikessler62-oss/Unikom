import type { SourceConfig } from '../../domain/transfer/TransferJob.js';
import type { SourceAdapter, SourceCredentials } from '../../domain/source/SourceAdapter.js';
import { LocalSourceAdapter } from './local/LocalSourceAdapter.js';
import { SftpSourceAdapter } from './sftp/SftpSourceAdapter.js';
import { FtpsSourceAdapter } from './ftps/FtpsSourceAdapter.js';

/**
 * The single place that knows which protocol maps to which adapter. Everything
 * protocol specific lives behind these adapters (spec section 99).
 */
export class SourceAdapterFactory {
  static create(config: SourceConfig, credentials: SourceCredentials = {}): SourceAdapter {
    switch (config.type) {
      case 'LOCAL':
        return new LocalSourceAdapter();
      case 'SFTP':
        return new SftpSourceAdapter(config, credentials);
      case 'FTPS':
        return new FtpsSourceAdapter(config, credentials);
      default:
        throw new Error(`Unsupported source type: ${String(config.type)}`);
    }
  }
}
