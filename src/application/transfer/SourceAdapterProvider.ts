import type { SourceAdapter, SourceCredentials } from '../../domain/source/SourceAdapter.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { SourceAdapterFactory } from '../../infrastructure/sources/SourceAdapterFactory.js';
import type { CredentialService } from '../credentials/CredentialService.js';

/**
 * Builds the source adapter for a job and resolves its credential immediately
 * before the connection is opened. The plaintext secret exists only for the
 * lifetime of the adapter and never reaches the job configuration (spec
 * sections 49-51).
 */
export class SourceAdapterProvider {
  constructor(private readonly credentialService?: CredentialService) {}

  async forJob(job: TransferJob): Promise<SourceAdapter> {
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
