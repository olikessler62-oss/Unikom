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
export class SourceAdapterProvider {
  constructor(
    private readonly credentialService?: CredentialService,
    private readonly features: FeatureSet = allFeatures()
  ) {}

  async forJob(job: TransferJob): Promise<SourceAdapter> {
    if ((job.sourceType === 'SFTP' || job.sourceType === 'FTPS') && !this.features.isEnabled('REMOTE_SOURCES')) {
      throw new FeatureNotLicensedError('REMOTE_SOURCES', `Connecting job "${job.name}" to ${job.sourceType}`);
    }

    return SourceAdapterFactory.create(job.sourceConfig, await this.resolveCredentials(job));
  }

  private async resolveCredentials(job: TransferJob): Promise<SourceCredentials> {
    if (job.sourceType === 'LOCAL' || !job.credentialId) {
      return {};
    }

    if (!this.credentialService) {
      throw new Error(
        `Job "${job.name}" references credential ${job.credentialId}, but no credential service is configured`
      );
    }

    const credential = await this.credentialService.getById(job.credentialId);
    if (!credential) {
      throw new Error(`The credential ${job.credentialId} configured for job "${job.name}" does not exist`);
    }

    const secret = await this.credentialService.resolveSecret(credential.id);

    switch (credential.type) {
      case 'USERNAME_PASSWORD':
        return { username: credential.username, password: secret };
      case 'SSH_PRIVATE_KEY':
        return { username: credential.username, privateKey: secret };
      default:
        throw new Error(
          `Credential "${credential.name}" is of type ${credential.type} and cannot be used to connect to a source`
        );
    }
  }
}
