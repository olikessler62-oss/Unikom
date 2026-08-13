import type { EncryptionKeyProvider } from '../../domain/encryption/EncryptionKeyProvider.js';
import type { CredentialService } from './CredentialService.js';

/**
 * Resolves the `keyCredentialId` of a job into the actual key (spec section 90).
 * Failures name the credential, never its content.
 */
export class CredentialEncryptionKeyProvider implements EncryptionKeyProvider {
  constructor(private readonly credentialService: CredentialService) {}

  async getKey(keyCredentialId: string | undefined): Promise<string> {
    if (!keyCredentialId) {
      throw new Error('Encryption is enabled for this job but no encryption key credential is configured');
    }

    const credential = await this.credentialService.getById(keyCredentialId);
    if (!credential) {
      throw new Error(`The encryption key credential "${keyCredentialId}" does not exist`);
    }

    if (credential.type !== 'ENCRYPTION_KEY') {
      throw new Error(
        `Credential "${credential.name}" is of type ${credential.type} and cannot be used as an encryption key`
      );
    }

    return this.credentialService.resolveSecret(keyCredentialId);
  }
}
