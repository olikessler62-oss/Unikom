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
      // Eine Freigabe wird über dasselbe Dateisystem gelesen — ein UNC-Pfad ist
      // ein Pfad. Was sie unterscheidet, ist die Anmeldung, und die geschieht
      // vor dem Lauf über den ShareConnectionService, nicht hier.
      case 'SHARE':
        return new LocalSourceAdapter(config.directory);
      case 'SFTP':
        return new SftpSourceAdapter(config, credentials);
      case 'FTPS':
        return new FtpsSourceAdapter(config, credentials);
      default:
        throw new Error(`Unbekannte Quellenart: ${String(config.type)}`);
    }
  }
}
