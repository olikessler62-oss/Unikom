import crypto from 'node:crypto';
import {
  toSummary,
  type Credential,
  type CredentialInput,
  type CredentialRepository,
  type CredentialSummary,
} from '../../domain/credentials/Credential.js';
import { MASTER_KEY_BYTES } from '../../infrastructure/security/MasterKeyProvider.js';
import type { SecretCipher } from '../../infrastructure/security/SecretCipher.js';

/**
 * Manages access data separately from the transfer jobs (spec sections 49-51).
 *
 * Every read method deliberately returns a summary without the secret. Only
 * `resolveSecret` hands out plaintext, and it is called by the transfer
 * pipeline alone, so a secret cannot reach a log, an export or an API response
 * by accident.
 */
export class CredentialService {
  constructor(
    private readonly repository: CredentialRepository,
    private readonly secretCipher: SecretCipher
  ) {}

  async create(input: CredentialInput): Promise<CredentialSummary> {
    if (input.secret.length === 0) {
      throw new Error('A credential needs a secret');
    }

    if (await this.repository.findByName(input.name)) {
      throw new Error(`A credential named "${input.name}" already exists`);
    }

    const now = new Date();
    const credential: Credential = {
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      username: input.username,
      encryptedSecret: this.secretCipher.encrypt(input.secret),
      createdAt: now,
      updatedAt: now,
    };

    return toSummary(await this.repository.save(credential));
  }

  /**
   * Creates a ready-to-use AES key. Preferred over letting a user invent one,
   * because a typed passphrase is rarely as strong as it looks.
   */
  async createEncryptionKey(name: string): Promise<CredentialSummary> {
    return this.create({
      name,
      type: 'ENCRYPTION_KEY',
      secret: crypto.randomBytes(MASTER_KEY_BYTES).toString('base64'),
    });
  }

  async list(): Promise<CredentialSummary[]> {
    return (await this.repository.list()).map(toSummary);
  }

  async getById(id: string): Promise<CredentialSummary | undefined> {
    const credential = await this.repository.getById(id);
    return credential ? toSummary(credential) : undefined;
  }

  async rename(id: string, name: string): Promise<CredentialSummary | undefined> {
    const credential = await this.repository.getById(id);
    if (!credential) {
      return undefined;
    }

    const conflicting = await this.repository.findByName(name);
    if (conflicting && conflicting.id !== id) {
      throw new Error(`A credential named "${name}" already exists`);
    }

    return toSummary(await this.repository.save({ ...credential, name, updatedAt: new Date() }));
  }

  async replaceSecret(id: string, secret: string): Promise<CredentialSummary | undefined> {
    const credential = await this.repository.getById(id);
    if (!credential) {
      return undefined;
    }

    return toSummary(
      await this.repository.save({
        ...credential,
        encryptedSecret: this.secretCipher.encrypt(secret),
        updatedAt: new Date(),
      })
    );
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  /**
   * The single place that produces a plaintext secret. Callers must never log
   * or persist the result.
   */
  async resolveSecret(id: string): Promise<string> {
    const credential = await this.repository.getById(id);
    if (!credential) {
      throw new Error(`Credential "${id}" does not exist`);
    }

    return this.secretCipher.decrypt(credential.encryptedSecret);
  }

  /** Verifies that a credential can be decrypted, without revealing anything. */
  async canResolve(id: string): Promise<boolean> {
    try {
      await this.resolveSecret(id);
      return true;
    } catch {
      return false;
    }
  }
}
