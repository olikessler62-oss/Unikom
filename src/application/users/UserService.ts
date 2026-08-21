import { randomUUID } from 'node:crypto';

import type { SessionRepository } from '../../domain/users/Session.js';
import { chooseInitials } from '../../domain/users/Initials.js';
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
export const MINIMUM_PASSWORD_LENGTH = 10;

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
    firstName: string;
    lastName: string;
    role: Role;
    password: string;
    mustChangePassword?: boolean;
    handleConflicts?: boolean;
  }): Promise<UserSummary> {
    const name = assertNameIsComplete(input);
    const username = await this.freeUsername(input.username);

    assertPasswordIsAcceptable(input.password);

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      username,
      ...name,
      initials: chooseInitials(name, await this.takenInitials()),
      role: input.role,
      passwordHash: await this.hasher.hash(input.password),
      mustChangePassword: input.mustChangePassword ?? false,
      enabled: true,
      // Ausdrücklich nicht voreingestellt: Wer die Klartextwerte sehen darf,
      // wird benannt und ergibt sich nicht nebenbei aus dem Anlegen.
      handleConflicts: input.handleConflicts ?? false,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    return toSummary(await this.userRepository.save(user));
  }

  /**
   * Was ein Administrator an einem bestehenden Konto ändern darf: Name,
   * Anmeldename, Berechtigungsstufe. In einem Zug, weil es in der Oberfläche
   * ein Formular mit einem Knopf ist — drei getrennte Aufrufe könnten zur
   * Hälfte gelingen und einen halb geänderten Benutzer hinterlassen.
   */
  async update(
    userId: string,
    input: { username: string; firstName: string; lastName: string; role: Role; handleConflicts?: boolean }
  ): Promise<UserSummary> {
    const user = await this.require(userId);
    const name = assertNameIsComplete(input);
    const username = await this.freeUsername(input.username, userId);

    await this.assertNotTheLastAdministrator(user, { role: input.role });

    const updated = await this.userRepository.save({
      ...user,
      ...name,
      username,
      // Das bisherige Kürzel bleibt stehen, solange es zum Namen passt.
      initials: chooseInitials(name, await this.takenInitials(userId), user.initials),
      role: input.role,
      handleConflicts: input.handleConflicts ?? user.handleConflicts,
      updatedAt: new Date(),
    });

    if (input.role !== user.role) {
      // Die offene Sitzung trägt noch die alte Stufe.
      await this.sessionRepository.deleteByUser(userId);
    }

    return toSummary(updated);
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
      throw new Error('Das bisherige Passwort stimmt nicht');
    }

    assertPasswordIsAcceptable(newPassword);

    if (await this.hasher.verify(newPassword, user.passwordHash)) {
      throw new Error('Das neue Passwort muss sich vom bisherigen unterscheiden');
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

  /** Die Kürzel aller anderen — gegen die muss ein neues sich abgrenzen. */
  private async takenInitials(exceptId?: string): Promise<string[]> {
    return (await this.userRepository.list())
      .filter((user) => user.id !== exceptId)
      .map((user) => user.initials);
  }

  private async freeUsername(wanted: string, ownId?: string): Promise<string> {
    const username = wanted.trim();

    if (!username) {
      throw new Error('Ein Benutzer braucht einen Anmeldenamen');
    }

    const other = await this.userRepository.findByUsername(username);

    if (other && other.id !== ownId) {
      throw new Error(`Den Anmeldenamen „${username}“ gibt es schon`);
    }

    return username;
  }

  private async require(userId: string): Promise<User> {
    const user = await this.userRepository.getById(userId);

    if (!user) {
      throw new Error(`Den Benutzer ${userId} gibt es nicht`);
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
        `„${user.username}“ ist der letzte aktive Administrator. Bitte zuerst einen weiteren ernennen — ` +
          'sonst kann diese Installation niemand mehr verwalten'
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

/**
 * Beide Namen sind Pflicht — aus ihnen entsteht das Kürzel, und ein Kürzel aus
 * einem halben Namen ist keines, das jemand wiedererkennt.
 */
function assertNameIsComplete(input: { firstName: string; lastName: string }): {
  firstName: string;
  lastName: string;
} {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  if (!firstName || !lastName) {
    throw new Error('Ein Benutzer braucht einen Vornamen und einen Nachnamen');
  }

  return { firstName, lastName };
}

function assertPasswordIsAcceptable(password: string): void {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`Ein Passwort braucht mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen`);
  }
}
