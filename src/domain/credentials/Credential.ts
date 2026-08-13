export type CredentialType = 'USERNAME_PASSWORD' | 'SSH_PRIVATE_KEY' | 'ENCRYPTION_KEY';

/**
 * Credentials are managed separately from transfer jobs (spec section 49); a
 * job only ever stores a `credentialId`. The secret itself is never held in
 * plaintext, neither here nor in the database (section 51).
 */
export interface Credential {
  id: string;
  /**
   * The client this belongs to. Left out for something the operator uses
   * across all of them, typically an encryption key of their own.
   *
   * A job may only use its own tenant's credentials or a shared one: the SFTP
   * password of one client has no business in another client's job.
   */
  tenantId?: string;
  name: string;
  type: CredentialType;
  username?: string;
  encryptedSecret: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a credential looks like once it leaves the credential service: the
 * secret is stripped, so it cannot end up in a log, an API response or a UI
 * state by accident.
 */
export type CredentialSummary = Omit<Credential, 'encryptedSecret'>;

export interface CredentialInput {
  name: string;
  type: CredentialType;
  username?: string;
  /** Absent means shared across all tenants. */
  tenantId?: string;
  /** Plaintext, only in transit; it is encrypted before it is stored. */
  secret: string;
}

/**
 * Whether a job of `tenantId` may use this credential. Shared credentials are
 * available to everyone; a tenant's own credential is not.
 */
export function isUsableBy(credential: Pick<Credential, 'tenantId'>, tenantId: string): boolean {
  return credential.tenantId === undefined || credential.tenantId === tenantId;
}

export interface CredentialRepository {
  list(): Promise<Credential[]>;
  getById(id: string): Promise<Credential | undefined>;
  findByName(name: string): Promise<Credential | undefined>;
  save(credential: Credential): Promise<Credential>;
  delete(id: string): Promise<void>;
}

export function toSummary(credential: Credential): CredentialSummary {
  const { encryptedSecret: _encryptedSecret, ...summary } = credential;
  return summary;
}
