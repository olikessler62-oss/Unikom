import type { DatabaseSync } from 'node:sqlite';

import type { Session, SessionRepository } from '../../../domain/users/Session.js';

interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

function toSession(row: SessionRow): Session {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly database: DatabaseSync) {}

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const row = this.database
      .prepare('SELECT token_hash, user_id, created_at, expires_at, last_seen_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as unknown as SessionRow | undefined;

    return row ? toSession(row) : undefined;
  }

  async save(session: Session): Promise<Session> {
    this.database
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(token_hash) DO UPDATE SET
           expires_at   = excluded.expires_at,
           last_seen_at = excluded.last_seen_at`
      )
      .run(
        session.tokenHash,
        session.userId,
        session.createdAt.toISOString(),
        session.expiresAt.toISOString(),
        session.lastSeenAt.toISOString()
      );

    return session;
  }

  async delete(tokenHash: string): Promise<void> {
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  async deleteByUser(userId: string): Promise<number> {
    return Number(this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes);
  }

  async deleteExpired(now: Date): Promise<number> {
    return Number(
      this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString()).changes
    );
  }
}
