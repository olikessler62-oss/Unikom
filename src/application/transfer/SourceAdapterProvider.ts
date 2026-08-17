import { isUsableBy } from '../../domain/credentials/Credential.js';
import { allFeatures, FeatureNotLicensedError, type FeatureSet } from '../../domain/licensing/Feature.js';
import type { SourceAdapter, SourceCredentials } from '../../domain/source/SourceAdapter.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { SourceAdapterFactory } from '../../infrastructure/sources/SourceAdapterFactory.js';
import type { CredentialService } from '../credentials/CredentialService.js';

/**
 * Builds the source adapter for a job and resolves its credential immediately
 * before the connection is opened. The plaintext secret exists only for the
 * lifetime of the adapter and never reaches the job configuration (spec
 * sections 49-51).
 *
 * This is also the second licence check, and the one that has to hold: a job
 * saved while a module was still licensed reaches this point unchanged, as does
 * a job written straight into the database. No adapter is built for a module
 * that is missing, so the capability does not exist rather than being hidden.
 */
/**
 * What building an adapter actually needs. Named separately so the job editor
 * can test a connection before there is a job to test it with (spec section 52)
 * - and so the checks below apply to that test exactly as they do to a run.
 */
export interface SourceDescription {
  /** Only for messages; a job being edited may not have a name yet. */
  name: string;
  tenantId: string;
  sourceType: TransferJob['sourceType'];
  sourceConfig: TransferJob['sourceConfig'];
  credentialId?: string;
}

export class SourceAdapterProvider {
  constructor(
    private readonly credentialService?: CredentialService,
    private readonly features: FeatureSet = allFeatures()
  ) {}

  forJob(job: TransferJob): Promise<SourceAdapter> {
    return this.forSource(job);
  }

  async forSource(source: SourceDescription): Promise<SourceAdapter> {
    if (
      (source.sourceType === 'SFTP' || source.sourceType === 'FTPS') &&
      !this.features.isEnabled('REMOTE_SOURCES')
    ) {
      throw new FeatureNotLicensedError('REMOTE_SOURCES', `Connecting "${source.name}" to ${source.sourceType}`);
    }

    return SourceAdapterFactory.create(source.sourceConfig, await this.resolveCredentials(source));
  }

  private async resolveCredentials(job: SourceDescription): Promise<SourceCredentials> {
    if (job.sourceType === 'LOCAL' || !job.credentialId) {
      return {};
    }

    if (!this.credentialService) {
      throw new Error(
        `Der Workflow „${job.name}“ verweist auf den Zugang ${job.credentialId}, aber es ist keine ` +
          'Zugangsverwaltung eingerichtet'
      );
    }

    const credential = await this.credentialService.getById(job.credentialId);
    if (!credential) {
      throw new Error(`Den im Workflow „${job.name}“ eingetragenen Zugang ${job.credentialId} gibt es nicht`);
    }

    // Checked again here, not only when the job was saved: a credential can be
    // reassigned to a client afterwards, and a job can be written straight into
    // the database. This is the point where the connection would actually be
    // opened with another client's access data.
    if (!isUsableBy(credential, job.tenantId)) {
      throw new Error(
        `Der Zugang „${credential.name}“ gehört einem anderen Mandanten und darf im Workflow „${job.name}“ ` +
          'nicht verwendet werden'
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
            'einer Quelle'
        );
    }
  }
}
