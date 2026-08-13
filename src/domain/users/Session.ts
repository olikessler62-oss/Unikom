/**
 * A logged-in session. Server side on purpose rather than a self-contained
 * token: this way a session can really be revoked — when a user is disabled,
 * when their role changes, when someone logs out — which a signed token cannot
 * do without a revocation list that ends up being a session store anyway.
 */
export interface Session {
  /** Hash of the token, never the token: the store must not hold the key. */
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Refreshed on use, so an active session does not expire under someone. */
  lastSeenAt: Date;
}

export interface SessionRepository {
  findByTokenHash(tokenHash: string): Promise<Session | undefined>;
  save(session: Session): Promise<Session>;
  delete(tokenHash: string): Promise<void>;
  /** Everything belonging to one user, for a disable or a role change. */
  deleteByUser(userId: string): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}
