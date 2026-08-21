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
import {
  generateSshKeyPair,
  normalisePrivateKey,
  publicKeyOf,
  type KeyDescription,
} from '../../infrastructure/security/SshKeys.js';

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
      throw new Error('Ein Zugang braucht ein Geheimnis');
    }

    if (await this.repository.findByName(input.name)) {
      throw new Error(`Einen Zugang namens „${input.name}“ gibt es schon`);
    }

    const now = new Date();
    const credential: Credential = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      type: input.type,
      username: input.username,
      freigabe: input.freigabe,
      encryptedSecret: this.secretCipher.encrypt(input.secret),
      createdAt: now,
      updatedAt: now,
    };

    return toSummary(await this.repository.save(credential));
  }

  /**
   * Stores an SSH key for logging in at an SFTP source — either the operator's
   * own file, or a fresh pair when they have none.
   *
   * The key is normalised on the way in, not on the way out: a file that cannot
   * be read is refused here, while somebody is looking at the form, instead of
   * failing at three in the morning when the job runs. It is also the only
   * moment the passphrase exists — it opens the file and is then gone, because
   * the store encrypts every secret with the installation's master key anyway
   * and a passphrase kept beside its key protects nothing.
   */
  async createSshKey(input: {
    name: string;
    username?: string;
    tenantId?: string;
    /** The uploaded key file. Absent means: make one. */
    material?: string;
    passphrase?: string;
  }): Promise<CredentialSummary> {
    const key =
      input.material === undefined || input.material.trim().length === 0
        ? await generateSshKeyPair(input.name)
        : normalisePrivateKey(input.material, input.passphrase);

    return this.create({
      name: input.name,
      type: 'SSH_PRIVATE_KEY',
      username: input.username,
      tenantId: input.tenantId,
      secret: key.privateKey,
    });
  }

  /**
   * The `authorized_keys` line belonging to a stored SSH key.
   *
   * Not a secret — it is meant to be handed to the counterparty, which is the
   * whole point of asking for it. It is derived from the private key each time
   * rather than stored beside it: one place that can be wrong instead of two.
   */
  async publicKeyOf(id: string): Promise<KeyDescription> {
    const credential = await this.repository.getById(id);

    if (!credential) {
      throw new Error(`Den Zugang „${id}“ gibt es nicht`);
    }

    if (credential.type !== 'SSH_PRIVATE_KEY') {
      throw new Error(`"${credential.name}" is not an SSH key, so it has no public key`);
    }

    return publicKeyOf(this.secretCipher.decrypt(credential.encryptedSecret), credential.name);
  }

  /**
   * Creates a ready-to-use AES key. Preferred over letting a user invent one,
   * because a typed passphrase is rarely as strong as it looks.
   */
  async createEncryptionKey(name: string, tenantId?: string): Promise<CredentialSummary> {
    return this.create({
      name,
      type: 'ENCRYPTION_KEY',
      tenantId,
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
      throw new Error(`Einen Zugang namens „${name}“ gibt es schon`);
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
      throw new Error(`Den Zugang „${id}“ gibt es nicht`);
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
