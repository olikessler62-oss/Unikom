import type { DatabaseSync } from 'node:sqlite';
import type { Credential, CredentialRepository, CredentialType } from '../../../domain/credentials/Credential.js';
import { nullable } from './SqliteDatabase.js';

interface CredentialRow {
  id: string;
  tenant_id: string | null;
  name: string;
  type: string;
  username: string | null;
  share_path: string | null;
  encrypted_secret: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, tenant_id, name, type, username, share_path, encrypted_secret, created_at, updated_at';

function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    name: row.name,
    type: row.type as CredentialType,
    username: row.username ?? undefined,
    freigabe: row.share_path ?? undefined,
    encryptedSecret: row.encrypted_secret,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteCredentialRepository implements CredentialRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<Credential[]> {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM credentials ORDER BY name`)
      .all() as unknown as CredentialRow[];

    return rows.map(toCredential);
  }

  async getById(id: string): Promise<Credential | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM credentials WHERE id = ?`).get(id) as
      | unknown as CredentialRow
      | undefined;

    return row ? toCredential(row) : undefined;
  }

  async findByName(name: string): Promise<Credential | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM credentials WHERE name = ?`).get(name) as
      | unknown as CredentialRow
      | undefined;

    return row ? toCredential(row) : undefined;
  }

  async save(credential: Credential): Promise<Credential> {
    this.database
      .prepare(
        `INSERT INTO credentials (id, tenant_id, name, type, username, share_path, encrypted_secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant_id        = excluded.tenant_id,
           name             = excluded.name,
           type             = excluded.type,
           username         = excluded.username,
           share_path       = excluded.share_path,
           encrypted_secret = excluded.encrypted_secret,
           updated_at       = excluded.updated_at`
      )
      .run(
        credential.id,
        nullable(credential.tenantId),
        credential.name,
        credential.type,
        nullable(credential.username),
        nullable(credential.freigabe),
        credential.encryptedSecret,
        credential.createdAt.toISOString(),
        credential.updatedAt.toISOString()
      );

    return credential;
  }

  async delete(id: string): Promise<void> {
    this.database.prepare('DELETE FROM credentials WHERE id = ?').run(id);
  }
}
