import { randomUUID } from 'node:crypto';

import type { SessionRepository } from '../../domain/users/Session.js';
import {
  toSummary,
  type Role,
  type User,
  type UserRepository,
  type UserSummary,
} from '../../domain/users/User.js';
import { PasswordHasher } from '../../infrastructure/security/PasswordHasher.js';

/** After this many consecutive failures the account rests for a while. */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_MINUTES = 15;
/** Short enough to be a real barrier, long enough not to annoy. */
export const MINIMUM_PASSWORD_LENGTH = 12;

export type AuthenticationFailure =
  | 'INVALID_CREDENTIALS'
  | 'DISABLED'
  | 'LOCKED';

export type AuthenticationResult =
  | { ok: true; user: User }
  | { ok: false; reason: AuthenticationFailure; message: string };

export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly hasher: PasswordHasher = new PasswordHasher()
  ) {}

  async list(): Promise<UserSummary[]> {
    return (await this.userRepository.list()).map(toSummary);
  }

  async count(): Promise<number> {
    return this.userRepository.count();
  }

  async create(input: {
    username: string;
    displayName: string;
    role: Role;
    password: string;
    mustChangePassword?: boolean;
  }): Promise<UserSummary> {
    const username = input.username.trim();

    if (!username) {
      throw new Error('A user needs a username');
    }

    if (await this.userRepository.findByUsername(username)) {
      throw new Error(`The username "${username}" is already taken`);
    }

    assertPasswordIsAcceptable(input.password);

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      username,
      displayName: input.displayName.trim() || username,
      role: input.role,
      passwordHash: await this.hasher.hash(input.password),
      mustChangePassword: input.mustChangePassword ?? false,
      enabled: true,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    return toSummary(await this.userRepository.save(user));
  }

  /**
   * The same answer for an unknown user and a wrong password, deliberately: a
   * different message would turn the login form into a way to find out who has
   * an account here.
   */
  async authenticate(username: string, password: string, now: Date = new Date()): Promise<AuthenticationResult> {
    const user = await this.userRepository.findByUsername(username.trim());

    if (!user) {
      // Still spend the time a real check costs, so the answer does not arrive
      // noticeably faster for a username that does not exist.
      await this.hasher.verify(password, await this.hasher.hash('a password nobody has'));
      return invalidCredentials();
    }

    if (!user.enabled) {
      return { ok: false, reason: 'DISABLED', message: 'This account is disabled' };
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      return {
        ok: false,
        reason: 'LOCKED',
        message: `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}`,
      };
    }

    if (!(await this.hasher.verify(password, user.passwordHash))) {
      await this.recordFailedAttempt(user, now);
      return invalidCredentials();
    }

    await this.userRepository.save({
      ...user,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
      lastLoginAt: now,
      updatedAt: now,
    });

    return { ok: true, user };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.require(userId);

    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      throw new Error('The current password is not correct');
    }

    assertPasswordIsAcceptable(newPassword);

    if (await this.hasher.verify(newPassword, user.passwordHash)) {
      throw new Error('The new password has to differ from the current one');
    }

    await this.userRepository.save({
      ...user,
      passwordHash: await this.hasher.hash(newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    });

    // Everywhere else stays logged in on the old password otherwise, which is
    // the opposite of why somebody changes it.
    await this.sessionRepository.deleteByUser(userId);
  }

  /** An administrator hands out a new password; the user has to replace it. */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.require(userId);
    assertPasswordIsAcceptable(newPassword);

    await this.userRepository.save({
      ...user,
      passwordHash: await this.hasher.hash(newPassword),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
      updatedAt: new Date(),
    });

    await this.sessionRepository.deleteByUser(userId);
  }

  async setRole(userId: string, role: Role): Promise<UserSummary> {
    const user = await this.require(userId);
    await this.assertNotTheLastAdministrator(user, { role });

    const updated = await this.userRepository.save({ ...user, role, updatedAt: new Date() });

    // The open session still carries the old role, so it has to go.
    await this.sessionRepository.deleteByUser(userId);

    return toSummary(updated);
  }

  async setEnabled(userId: string, enabled: boolean): Promise<UserSummary> {
    const user = await this.require(userId);

    if (!enabled) {
      await this.assertNotTheLastAdministrator(user, { enabled });
    }

    const updated = await this.userRepository.save({ ...user, enabled, updatedAt: new Date() });

    if (!enabled) {
      await this.sessionRepository.deleteByUser(userId);
    }

    return toSummary(updated);
  }

  async delete(userId: string): Promise<void> {
    const user = await this.require(userId);
    await this.assertNotTheLastAdministrator(user, { enabled: false });

    await this.sessionRepository.deleteByUser(userId);
    await this.userRepository.delete(userId);
  }

  private async require(userId: string): Promise<User> {
    const user = await this.userRepository.getById(userId);

    if (!user) {
      throw new Error(`There is no user ${userId}`);
    }

    return user;
  }

  /**
   * Nobody may remove the last way in. Without this an administrator can lock
   * the whole installation by demoting themselves — and there is no second
   * door, because the login is the only one.
   */
  private async assertNotTheLastAdministrator(
    user: User,
    change: { role?: Role; enabled?: boolean }
  ): Promise<void> {
    const staysAdministrator = (change.role ?? user.role) === 'ADMIN' && (change.enabled ?? user.enabled);

    if (user.role !== 'ADMIN' || user.enabled === false || staysAdministrator) {
      return;
    }

    const others = (await this.userRepository.list()).filter(
      (candidate) => candidate.id !== user.id && candidate.role === 'ADMIN' && candidate.enabled
    );

    if (others.length === 0) {
      throw new Error(
        `"${user.username}" is the last active administrator. Appoint another one first, ` +
          'otherwise nobody can manage this installation any more'
      );
    }
  }

  private async recordFailedAttempt(user: User, now: Date): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const locked = attempts >= MAX_FAILED_ATTEMPTS;

    await this.userRepository.save({
      ...user,
      failedLoginAttempts: locked ? 0 : attempts,
      lockedUntil: locked ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      updatedAt: now,
    });
  }
}

function invalidCredentials(): AuthenticationResult {
  return { ok: false, reason: 'INVALID_CREDENTIALS', message: 'Username or password is not correct' };
}

function assertPasswordIsAcceptable(password: string): void {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`A password needs at least ${MINIMUM_PASSWORD_LENGTH} characters`);
  }
}
