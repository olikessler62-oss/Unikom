import type { DatabaseSync } from 'node:sqlite';
import type { Credential, CredentialRepository, CredentialType } from '../../../domain/credentials/Credential.js';
import { nullable } from './SqliteDatabase.js';

interface CredentialRow {
  id: string;
  name: string;
  type: string;
  username: string | null;
  encrypted_secret: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, name, type, username, encrypted_secret, created_at, updated_at';

function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CredentialType,
    username: row.username ?? undefined,
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
        `INSERT INTO credentials (id, name, type, username, encrypted_secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name             = excluded.name,
           type             = excluded.type,
           username         = excluded.username,
           encrypted_secret = excluded.encrypted_secret,
           updated_at       = excluded.updated_at`
      )
      .run(
        credential.id,
        credential.name,
        credential.type,
        nullable(credential.username),
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
