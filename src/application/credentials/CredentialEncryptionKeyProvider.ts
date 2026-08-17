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
      throw new Error('Für diesen Workflow ist Verschlüsselung eingeschaltet, aber kein Schlüssel ausgewählt');
    }

    const credential = await this.credentialService.getById(keyCredentialId);
    if (!credential) {
      throw new Error(`Den Schlüssel „${keyCredentialId}“ gibt es nicht`);
    }

    if (credential.type !== 'ENCRYPTION_KEY') {
      throw new Error(
        `Der Zugang „${credential.name}“ ist vom Typ ${credential.type} und taugt nicht als Schlüssel`
      );
    }

    return this.credentialService.resolveSecret(keyCredentialId);
  }
}
