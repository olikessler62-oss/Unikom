export type CredentialType = 'USERNAME_PASSWORD' | 'SSH_PRIVATE_KEY' | 'ENCRYPTION_KEY';

/**
 * Credentials are managed separately from transfer jobs (spec section 49); a
 * job only ever stores a `credentialId`. The secret itself is never held in
 * plaintext, neither here nor in the database (section 51).
 */
export interface Credential {
  id: string;
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
  /** Plaintext, only in transit; it is encrypted before it is stored. */
  secret: string;
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
