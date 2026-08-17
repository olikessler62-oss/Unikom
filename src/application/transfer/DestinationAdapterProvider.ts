import type { DestinationAdapter } from '../../domain/destination/DestinationAdapter.js';
import type { SourceCredentials } from '../../domain/source/SourceAdapter.js';
import type { SourceConfig, TransferJob } from '../../domain/transfer/TransferJob.js';
import { allFeatures, FeatureNotLicensedError, type FeatureSet } from '../../domain/licensing/Feature.js';
import { isUsableBy } from '../../domain/credentials/Credential.js';
import { LocalDestinationAdapter } from '../../infrastructure/destinations/local/LocalDestinationAdapter.js';
import { SftpDestinationAdapter } from '../../infrastructure/destinations/sftp/SftpDestinationAdapter.js';
import { FtpsDestinationAdapter } from '../../infrastructure/destinations/ftps/FtpsDestinationAdapter.js';
import type { CredentialService } from '../credentials/CredentialService.js';
import { StagingService } from './StagingService.js';

/**
 * Baut das Ziel eines Workflows.
 *
 * Das Gegenstück zum SourceAdapterProvider, und aus demselben Grund eine
 * eigene Stelle: Hier werden Zugangsdaten aufgelöst und die Lizenz geprüft,
 * unmittelbar bevor eine Verbindung aufgemacht wird — nicht schon beim
 * Speichern des Workflows, denn zwischen beidem kann sich alles ändern.
 *
 * Ohne Angabe ist das Ziel das Dateisystem. Das ist keine Vorsichtsmaßnahme
 * für alte Datensätze, sondern der Normalfall: Die meisten Übertragungen enden
 * in einem Verzeichnis oder auf einer Freigabe.
 */
export interface DestinationDescription {
  name: string;
  tenantId: string;
  destinationType?: TransferJob['destinationType'];
  destinationConfig?: SourceConfig;
  destinationDirectory: string;
  destinationCredentialId?: string;
}

export class DestinationAdapterProvider {
  constructor(
    private readonly credentialService?: CredentialService,
    private readonly features: FeatureSet = allFeatures(),
    private readonly stagingService: StagingService = new StagingService()
  ) {}

  forJob(job: TransferJob): Promise<DestinationAdapter> {
    return this.forDestination(job);
  }

  async forDestination(destination: DestinationDescription): Promise<DestinationAdapter> {
    const type = destination.destinationType ?? 'LOCAL';

    if (type === 'LOCAL') {
      return new LocalDestinationAdapter(this.stagingService);
    }

    if (!this.features.isEnabled('REMOTE_SOURCES')) {
      throw new FeatureNotLicensedError(
        'REMOTE_SOURCES',
        `Das Ziel von „${destination.name}“ über ${type} zu beschreiben`
      );
    }

    const config: SourceConfig = {
      ...(destination.destinationConfig ?? { type, directory: destination.destinationDirectory }),
      type,
      directory: destination.destinationDirectory,
    };

    const credentials = await this.resolveCredentials(destination);

    return type === 'SFTP'
      ? new SftpDestinationAdapter(config, credentials)
      : new FtpsDestinationAdapter(config, credentials);
  }

  private async resolveCredentials(destination: DestinationDescription): Promise<SourceCredentials> {
    if (!destination.destinationCredentialId) {
      return {};
    }

    if (!this.credentialService) {
      throw new Error(
        `Der Workflow „${destination.name}“ verweist für sein Ziel auf den Zugang ` +
          `${destination.destinationCredentialId}, aber es ist keine Zugangsverwaltung eingerichtet`
      );
    }

    const credential = await this.credentialService.getById(destination.destinationCredentialId);
    if (!credential) {
      throw new Error(
        `Den im Ziel von „${destination.name}“ eingetragenen Zugang ` +
          `${destination.destinationCredentialId} gibt es nicht`
      );
    }

    // Auch hier erneut geprüft, nicht nur beim Speichern: Ein Zugang kann
    // danach einem anderen Mandanten zugeordnet werden, und ein Workflow kann
    // unmittelbar in die Datenbank geschrieben werden. Dies ist die Stelle, an
    // der wirklich mit fremden Zugangsdaten verbunden würde.
    if (!isUsableBy(credential, destination.tenantId)) {
      throw new Error(
        `Der Zugang „${credential.name}“ gehört einem anderen Mandanten und darf im Ziel von ` +
          `„${destination.name}“ nicht verwendet werden`
      );
    }

    const secret = await this.credentialService.resolveSecret(credential.id);

    switch (credential.type) {
      case 'USERNAME_PASSWORD':
        return { username: credential.username, password: secret };
      case 'SSH_PRIVATE_KEY':
        return { username: credential.username, privateKey: secret };
      default:
        throw new Error(
          `Der Zugang „${credential.name}“ ist vom Typ ${credential.type} und taugt nicht zum Verbinden mit ` +
            'einem Ziel'
        );
    }
  }
}
