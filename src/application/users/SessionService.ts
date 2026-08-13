import { createHash, randomBytes } from 'node:crypto';

import type { Session, SessionRepository } from '../../domain/users/Session.js';
import { may, type Permission, type User, type UserRepository } from '../../domain/users/User.js';

/** Idle time after which a session expires. Every use pushes it back. */
export const SESSION_IDLE_HOURS = 12;
/** Hard upper bound, regardless of activity. */
export const SESSION_MAXIMUM_HOURS = 24 * 7;

export interface AuthenticatedSession {
  user: User;
  session: Session;
}

/**
 * Issues and checks sessions. The token exists exactly twice: once in the
 * browser cookie and once in the caller's hand right after the login. What the
 * store holds is only its SHA-256 — someone who reads the session table can
 * therefore not log in with what they find there.
 */
export class SessionService {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly userRepository: UserRepository
  ) {}

  /** Returns the token; this is the only moment it exists in clear. */
  async issue(userId: string, now: Date = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await this.sessionRepository.save({
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_HOURS * 3_600_000),
      lastSeenAt: now,
    });

    return token;
  }

  /**
   * Checks a token and extends the session. Returns undefined for anything
   * that is not a valid, unexpired session of an enabled user — the caller
   * only has to distinguish "logged in" from "not logged in".
   */
  async resolve(token: string | undefined, now: Date = new Date()): Promise<AuthenticatedSession | undefined> {
    if (!token) {
      return undefined;
    }

    const tokenHash = hashToken(token);
    const session = await this.sessionRepository.findByTokenHash(tokenHash);

    if (!session) {
      return undefined;
    }

    if (session.expiresAt.getTime() <= now.getTime() || this.exceedsMaximumAge(session, now)) {
      await this.sessionRepository.delete(tokenHash);
      return undefined;
    }

    const user = await this.userRepository.getById(session.userId);

    if (!user || !user.enabled) {
      // Disabled between two requests, or deleted altogether.
      await this.sessionRepository.delete(tokenHash);
      return undefined;
    }

    const extended = await this.sessionRepository.save({
      ...session,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_HOURS * 3_600_000),
    });

    return { user, session: extended };
  }

  async revoke(token: string): Promise<void> {
    await this.sessionRepository.delete(hashToken(token));
  }

  async revokeAllOf(userId: string): Promise<number> {
    return this.sessionRepository.deleteByUser(userId);
  }

  async pruneExpired(now: Date = new Date()): Promise<number> {
    return this.sessionRepository.deleteExpired(now);
  }

  /**
   * A session whose user still has to change their password may do exactly
   * that and nothing else. Otherwise a handed-out password would be a working
   * login for as long as nobody bothers to change it.
   */
  authorize(authenticated: AuthenticatedSession, permission: Permission): boolean {
    if (authenticated.user.mustChangePassword) {
      return false;
    }

    return may(authenticated.user.role, permission);
  }

  private exceedsMaximumAge(session: Session, now: Date): boolean {
    return now.getTime() - session.createdAt.getTime() > SESSION_MAXIMUM_HOURS * 3_600_000;
  }
}

/**
 * SHA-256 without a salt is right here, unlike for passwords: the token is 32
 * random bytes, so there is nothing to guess and no dictionary to try. What
 * this buys is that a stolen session table contains no usable tokens.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Companion token against cross-site requests, derived from the session token.
 *
 * The session cookie alone is not proof that a request was intended: a browser
 * sends it with a request another site triggered too. This token has to travel
 * in a header, which only our own page can set — and to compute it you need the
 * session token, which sits in an httpOnly cookie that no foreign script reads.
 *
 * Derived rather than stored: no extra column, and the hash cannot be turned
 * back into a session token if it ever ends up in a log.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHash('sha256').update(`unikom-csrf:${sessionToken}`).digest('hex');
}
