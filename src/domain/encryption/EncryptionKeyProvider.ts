/**
 * Supplies the secret behind an encryption credential reference. A transfer job
 * only stores a `keyCredentialId` (spec sections 50 and 90); the secret itself
 * must never live in the job configuration.
 */
export interface EncryptionKeyProvider {
  getKey(keyCredentialId: string | undefined): Promise<string>;
}

/**
 * Default until credential management exists (phase 2). It refuses instead of
 * falling back to a built-in key, because a hard-coded key would give the
 * appearance of encryption without the protection.
 */
export class UnavailableEncryptionKeyProvider implements EncryptionKeyProvider {
  async getKey(keyCredentialId: string | undefined): Promise<string> {
    throw new Error(
      keyCredentialId
        ? `Es ist keine Schlüsselverwaltung eingerichtet, der Schlüssel „${keyCredentialId}“ ist nicht auflösbar`
        : 'Für diesen Workflow ist Verschlüsselung eingeschaltet, aber kein Schlüssel ausgewählt'
    );
  }
}
