import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createInMemoryApplication, type UnikomApplication } from '../runtime/UnikomApplication.js';
import { ensureInitialAdministrator } from './InitialAdministrator.js';
import { LOCK_MINUTES, MAX_FAILED_ATTEMPTS, MINIMUM_PASSWORD_LENGTH } from './UserService.js';
import { SESSION_IDLE_HOURS, SESSION_MAXIMUM_HOURS } from './SessionService.js';
import { may, permissionsOf } from '../../domain/users/User.js';
import { PasswordHasher } from '../../infrastructure/security/PasswordHasher.js';

const PASSWORD = 'ein-ordentliches-Passwort-2026';
const HOUR = 3_600_000;

/** Mirrors what SessionService stores, so the test can look the session up. */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function withAdmin(): Promise<{ application: UnikomApplication; adminId: string }> {
  const application = createInMemoryApplication();
  const admin = await application.userService.create({
    username: 'anna',
    displayName: 'Anna',
    role: 'ADMIN',
    password: PASSWORD,
  });

  return { application, adminId: admin.id };
}

test('roles grant what their name suggests', () => {
  assert.equal(may('ADMIN', 'MANAGE_USERS'), true);
  assert.equal(may('OPERATOR', 'MANAGE_JOBS'), true);
  assert.equal(may('OPERATOR', 'MANAGE_CREDENTIALS'), false, 'credentials are for administrators');
  assert.equal(may('OPERATOR', 'MANAGE_USERS'), false);
  assert.equal(may('VIEWER', 'VIEW'), true);
  assert.deepEqual(permissionsOf('VIEWER'), ['VIEW']);
});

test('the stored record contains no password', async () => {
  const { application, adminId } = await withAdmin();
  const stored = JSON.stringify(await application.userService.list());

  assert.doesNotMatch(stored, /Passwort/i, 'the summary must not carry the password');
  assert.equal(stored.includes(PASSWORD), false);
  assert.equal(stored.includes('passwordHash'), false, 'even the hash has no business leaving the service');
  assert.ok(adminId);
});

test('the same password produces different hashes for two users', async () => {
  const hasher = new PasswordHasher();
  const first = await hasher.hash(PASSWORD);
  const second = await hasher.hash(PASSWORD);

  assert.notEqual(first, second, 'without a per-user salt one table would break every account at once');
  assert.equal(await hasher.verify(PASSWORD, first), true);
  assert.equal(await hasher.verify(PASSWORD, second), true);
  assert.equal(await hasher.verify('etwas anderes', first), false);
});

test('a truncated or tampered hash record is rejected, not accepted', async () => {
  const hasher = new PasswordHasher();

  for (const broken of ['', 'scrypt', 'scrypt$only-salt', 'plain$c2FsdA==$aGFzaA==', 'nonsense']) {
    assert.equal(await hasher.verify(PASSWORD, broken), false, `"${broken}" must not pass`);
  }
});

test('logging in works and a wrong password does not', async () => {
  const { application } = await withAdmin();

  assert.equal((await application.userService.authenticate('anna', PASSWORD)).ok, true);
  assert.equal((await application.userService.authenticate('anna', 'falsch')).ok, false);
});

test('the username is not case sensitive', async () => {
  const { application } = await withAdmin();

  assert.equal((await application.userService.authenticate('ANNA', PASSWORD)).ok, true);
});

test('an unknown user and a wrong password give the same answer', async () => {
  const { application } = await withAdmin();

  const unknown = await application.userService.authenticate('niemand', PASSWORD);
  const wrong = await application.userService.authenticate('anna', 'falsch');

  assert.equal(unknown.ok, false);
  assert.equal(wrong.ok, false);
  // Otherwise the login form tells an outsider who has an account here.
  assert.deepEqual(unknown, wrong);
});

test('a second account cannot claim the same name in different capitalisation', async () => {
  const { application } = await withAdmin();

  await assert.rejects(
    () => application.userService.create({ username: 'Anna', displayName: 'X', role: 'VIEWER', password: PASSWORD }),
    /gibt es schon/
  );
});

test('a password below the minimum length is refused', async () => {
  const application = createInMemoryApplication();

  await assert.rejects(
    () =>
      application.userService.create({
        username: 'kurz',
        displayName: 'Kurz',
        role: 'VIEWER',
        password: 'x'.repeat(MINIMUM_PASSWORD_LENGTH - 1),
      }),
    new RegExp(`${MINIMUM_PASSWORD_LENGTH} Zeichen`)
  );
});

test('too many failed attempts pause the account, and the pause expires', async () => {
  const { application } = await withAdmin();
  const start = new Date('2026-11-20T08:00:00.000Z');

  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
    await application.userService.authenticate('anna', 'falsch', start);
  }

  const locked = await application.userService.authenticate('anna', PASSWORD, start);
  assert.equal(locked.ok, false);
  assert.equal(locked.ok === false && locked.reason, 'LOCKED');

  // Self-expiring on purpose: a permanent lock would let anybody shut the only
  // administrator out by typing a wrong password often enough.
  const later = new Date(start.getTime() + (LOCK_MINUTES + 1) * 60_000);
  assert.equal((await application.userService.authenticate('anna', PASSWORD, later)).ok, true);
});

test('a successful login clears the failure count', async () => {
  const { application } = await withAdmin();
  const now = new Date('2026-11-20T08:00:00.000Z');

  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS - 1; attempt += 1) {
    await application.userService.authenticate('anna', 'falsch', now);
  }
  assert.equal((await application.userService.authenticate('anna', PASSWORD, now)).ok, true);

  // Without the reset the next single mistake would lock the account.
  await application.userService.authenticate('anna', 'falsch', now);
  assert.equal((await application.userService.authenticate('anna', PASSWORD, now)).ok, true);
});

test('a disabled account cannot log in', async () => {
  const { application, adminId } = await withAdmin();
  await application.userService.create({
    username: 'zweiter-admin',
    displayName: 'Zweiter',
    role: 'ADMIN',
    password: PASSWORD,
  });

  await application.userService.setEnabled(adminId, false);
  const result = await application.userService.authenticate('anna', PASSWORD);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'DISABLED');
});

test('a session is issued, resolves, and is revoked on logout', async () => {
  const { application, adminId } = await withAdmin();
  const token = await application.sessionService.issue(adminId);

  const resolved = await application.sessionService.resolve(token);
  assert.equal(resolved?.user.id, adminId);

  await application.sessionService.revoke(token);
  assert.equal(await application.sessionService.resolve(token), undefined);
});

test('the store holds no usable token', async () => {
  const { application, adminId } = await withAdmin();
  const token = await application.sessionService.issue(adminId);

  const stored = JSON.stringify(await application.sessionRepository.findByTokenHash(hashOf(token)));
  assert.ok(stored.length > 2, 'the session has to be there at all');
  assert.equal(stored.includes(token), false, 'a stolen session table must not contain working tokens');
});

test('an invalid or absent token resolves to nothing', async () => {
  const { application } = await withAdmin();

  assert.equal(await application.sessionService.resolve(undefined), undefined);
  assert.equal(await application.sessionService.resolve(''), undefined);
  assert.equal(await application.sessionService.resolve('erfunden'), undefined);
});

test('a session expires when idle and is extended by use', async () => {
  const { application, adminId } = await withAdmin();
  const start = new Date('2026-11-20T08:00:00.000Z');
  const token = await application.sessionService.issue(adminId, start);

  // Used shortly before the deadline, so the deadline moves.
  const almost = new Date(start.getTime() + (SESSION_IDLE_HOURS - 1) * HOUR);
  assert.ok(await application.sessionService.resolve(token, almost));

  const wouldHaveExpired = new Date(start.getTime() + (SESSION_IDLE_HOURS + 0.5) * HOUR);
  assert.ok(await application.sessionService.resolve(token, wouldHaveExpired), 'use has to push the deadline back');

  const abandoned = new Date(wouldHaveExpired.getTime() + (SESSION_IDLE_HOURS + 1) * HOUR);
  assert.equal(await application.sessionService.resolve(token, abandoned), undefined);
});

test('a session cannot be kept alive indefinitely', async () => {
  const { application, adminId } = await withAdmin();
  const start = new Date('2026-11-20T08:00:00.000Z');
  const token = await application.sessionService.issue(adminId, start);

  // Used every hour, so the idle timeout never bites - the hard limit does.
  for (let hour = 1; hour < SESSION_MAXIMUM_HOURS; hour += 1) {
    assert.ok(await application.sessionService.resolve(token, new Date(start.getTime() + hour * HOUR)));
  }

  const beyond = new Date(start.getTime() + (SESSION_MAXIMUM_HOURS + 1) * HOUR);
  assert.equal(await application.sessionService.resolve(token, beyond), undefined);
});

test('disabling a user invalidates their open sessions at once', async () => {
  const { application, adminId } = await withAdmin();
  const viewer = await application.userService.create({
    username: 'basti',
    displayName: 'Basti',
    role: 'VIEWER',
    password: PASSWORD,
  });
  const token = await application.sessionService.issue(viewer.id);
  assert.ok(await application.sessionService.resolve(token));

  await application.userService.setEnabled(viewer.id, false);

  assert.equal(await application.sessionService.resolve(token), undefined, 'a locked door has to lock now, not in 12 hours');
  assert.ok(adminId);
});

test('a role change invalidates the session that still carries the old role', async () => {
  const { application } = await withAdmin();
  const operator = await application.userService.create({
    username: 'chris',
    displayName: 'Chris',
    role: 'OPERATOR',
    password: PASSWORD,
  });
  const token = await application.sessionService.issue(operator.id);

  await application.userService.setRole(operator.id, 'VIEWER');

  assert.equal(await application.sessionService.resolve(token), undefined);
});

test('changing the password logs the other sessions out', async () => {
  const { application, adminId } = await withAdmin();
  const elsewhere = await application.sessionService.issue(adminId);

  await application.userService.changePassword(adminId, PASSWORD, 'ein-noch-besseres-Passwort-2026');

  assert.equal(await application.sessionService.resolve(elsewhere), undefined);
  assert.equal((await application.userService.authenticate('anna', PASSWORD)).ok, false);
  assert.equal((await application.userService.authenticate('anna', 'ein-noch-besseres-Passwort-2026')).ok, true);
});

test('a password change needs the current password', async () => {
  const { application, adminId } = await withAdmin();

  await assert.rejects(
    () => application.userService.changePassword(adminId, 'falsch', 'ein-ganz-neues-Passwort-2026'),
    /bisherige Passwort stimmt nicht/
  );
});

test('the new password has to differ from the old one', async () => {
  const { application, adminId } = await withAdmin();

  await assert.rejects(
    () => application.userService.changePassword(adminId, PASSWORD, PASSWORD),
    /unterscheiden/
  );
});

test('a handed-out password may do nothing but be replaced', async () => {
  const { application, adminId } = await withAdmin();
  const viewer = await application.userService.create({
    username: 'dana',
    displayName: 'Dana',
    role: 'VIEWER',
    password: PASSWORD,
  });

  await application.userService.resetPassword(viewer.id, 'vom-Administrator-vergeben-2026');
  const token = await application.sessionService.issue(viewer.id);
  const authenticated = await application.sessionService.resolve(token);

  assert.ok(authenticated);
  assert.equal(
    application.sessionService.authorize(authenticated, 'VIEW'),
    false,
    'until the password is replaced the session may only replace it'
  );

  await application.userService.changePassword(viewer.id, 'vom-Administrator-vergeben-2026', 'selbst-gewaehlt-2026');
  const fresh = await application.sessionService.resolve(await application.sessionService.issue(viewer.id));
  assert.equal(fresh ? application.sessionService.authorize(fresh, 'VIEW') : false, true);
  assert.ok(adminId);
});

test('the last active administrator cannot remove themselves', async () => {
  const { application, adminId } = await withAdmin();

  await assert.rejects(() => application.userService.setRole(adminId, 'VIEWER'), /letzte aktive Administrator/);
  await assert.rejects(() => application.userService.setEnabled(adminId, false), /letzte aktive Administrator/);
  await assert.rejects(() => application.userService.delete(adminId), /letzte aktive Administrator/);
});

test('with a second administrator the first one may step down', async () => {
  const { application, adminId } = await withAdmin();
  await application.userService.create({
    username: 'berta',
    displayName: 'Berta',
    role: 'ADMIN',
    password: PASSWORD,
  });

  const stepped = await application.userService.setRole(adminId, 'VIEWER');
  assert.equal(stepped.role, 'VIEWER');
});

test('the first start creates one administrator with a password shown once', async () => {
  const application = createInMemoryApplication();

  const created = await ensureInitialAdministrator(application.userService);
  assert.ok(created);
  assert.equal(created.username, 'admin');
  assert.ok(created.password.length >= MINIMUM_PASSWORD_LENGTH);

  assert.equal((await application.userService.authenticate('admin', created.password)).ok, true);

  // Calling it again does nothing, so it is safe on every start.
  assert.equal(await ensureInitialAdministrator(application.userService), undefined);
  assert.equal(await application.userService.count(), 1);
});

test('the generated first password has to be replaced before anything else', async () => {
  const application = createInMemoryApplication();
  const created = await ensureInitialAdministrator(application.userService);

  const result = await application.userService.authenticate('admin', created?.password ?? '');
  assert.equal(result.ok, true);

  const authenticated = await application.sessionService.resolve(
    await application.sessionService.issue(result.ok ? result.user.id : '')
  );

  assert.ok(authenticated);
  assert.equal(application.sessionService.authorize(authenticated, 'MANAGE_JOBS'), false);
});

test('expired sessions can be swept up', async () => {
  const { application, adminId } = await withAdmin();
  const start = new Date('2026-11-20T08:00:00.000Z');
  await application.sessionService.issue(adminId, start);

  const removed = await application.sessionService.pruneExpired(
    new Date(start.getTime() + (SESSION_IDLE_HOURS + 1) * HOUR)
  );

  assert.equal(removed, 1);
});
