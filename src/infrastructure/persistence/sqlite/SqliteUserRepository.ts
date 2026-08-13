import type { DatabaseSync } from 'node:sqlite';

import type { Role, User, UserRepository } from '../../../domain/users/User.js';
import { nullable } from './SqliteDatabase.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_hash: string;
  must_change_password: number;
  enabled: number;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, username, display_name, role, password_hash, must_change_password, enabled,
                 failed_login_attempts, locked_until, last_login_at, created_at, updated_at`;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as Role,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password === 1,
    enabled: row.enabled === 1,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : undefined,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<User[]> {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM users ORDER BY username_lower ASC`)
      .all() as unknown as UserRow[];

    return rows.map(toUser);
  }

  async getById(id: string): Promise<User | undefined> {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as unknown as
      | UserRow
      | undefined;

    return row ? toUser(row) : undefined;
  }

  async findByUsername(username: string): Promise<User | undefined> {
    // The lower-case column carries the UNIQUE constraint, so two accounts
    // that differ only in capitalisation cannot exist in the first place.
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM users WHERE username_lower = ?`)
      .get(username.toLowerCase()) as unknown as UserRow | undefined;

    return row ? toUser(row) : undefined;
  }

  async save(user: User): Promise<User> {
    this.database
      .prepare(
        `INSERT INTO users
           (id, username, username_lower, display_name, role, password_hash, must_change_password,
            enabled, failed_login_attempts, locked_until, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username              = excluded.username,
           username_lower        = excluded.username_lower,
           display_name          = excluded.display_name,
           role                  = excluded.role,
           password_hash         = excluded.password_hash,
           must_change_password  = excluded.must_change_password,
           enabled               = excluded.enabled,
           failed_login_attempts = excluded.failed_login_attempts,
           locked_until          = excluded.locked_until,
           last_login_at         = excluded.last_login_at,
           updated_at            = excluded.updated_at`
      )
      .run(
        user.id,
        user.username,
        user.username.toLowerCase(),
        user.displayName,
        user.role,
        user.passwordHash,
        user.mustChangePassword ? 1 : 0,
        user.enabled ? 1 : 0,
        user.failedLoginAttempts,
        nullable(user.lockedUntil?.toISOString()),
        nullable(user.lastLoginAt?.toISOString()),
        user.createdAt.toISOString(),
        user.updatedAt.toISOString()
      );

    return user;
  }

  async delete(id: string): Promise<void> {
    this.database.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  async count(): Promise<number> {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM users').get() as unknown as {
      total: number;
    };

    return Number(row.total);
  }
}
