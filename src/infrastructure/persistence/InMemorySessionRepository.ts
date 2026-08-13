import type { Session, SessionRepository } from '../../domain/users/Session.js';

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, Session>();

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const found = this.sessions.get(tokenHash);
    return found ? { ...found } : undefined;
  }

  async save(session: Session): Promise<Session> {
    this.sessions.set(session.tokenHash, { ...session });
    return { ...session };
  }

  async delete(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteByUser(userId: string): Promise<number> {
    const affected = [...this.sessions.values()].filter((session) => session.userId === userId);

    for (const session of affected) {
      this.sessions.delete(session.tokenHash);
    }

    return affected.length;
  }

  async deleteExpired(now: Date): Promise<number> {
    const expired = [...this.sessions.values()].filter(
      (session) => session.expiresAt.getTime() <= now.getTime()
    );

    for (const session of expired) {
      this.sessions.delete(session.tokenHash);
    }

    return expired.length;
  }
}
