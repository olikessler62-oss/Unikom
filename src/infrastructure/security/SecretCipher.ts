import crypto from 'node:crypto';
import type { MasterKeyProvider } from './MasterKeyProvider.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Protects the short secrets of a credential (password, private key,
 * encryption key) before they reach the database. AES-256-GCM is used so a
 * manipulated record is detected rather than silently decrypted into garbage.
 *
 * Layout of the stored value: base64( iv | tag | ciphertext ).
 */
export class SecretCipher {
  constructor(private readonly masterKeyProvider: MasterKeyProvider) {}

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKeyProvider.getMasterKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(stored: string): string {
    const payload = Buffer.from(stored, 'base64');
    if (payload.length < IV_BYTES + TAG_BYTES) {
      throw new Error('The stored secret is truncated and cannot be decrypted');
    }

    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKeyProvider.getMasterKey(), iv);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // The original error text carries no secret, but it is also unhelpful.
      throw new Error(
        'The stored secret could not be decrypted. Either the master key changed or the record was modified.'
      );
    }
  }
}
