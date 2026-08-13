export type CredentialType = 'USERNAME_PASSWORD' | 'SSH_PRIVATE_KEY' | 'ENCRYPTION_KEY';

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  username?: string;
  encryptedSecret: string;
  createdAt: Date;
  updatedAt: Date;
}
