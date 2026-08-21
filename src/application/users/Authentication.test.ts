import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createInMemoryApplication, type UnikomApplication } from '../runtime/UnikomApplication.js';
import { ensureInitialAdministrator } from './InitialAdministrator.js';
import { LOCK_MINUTES, MAX_FAILED_ATTEMPTS, MINIMUM_PASSWORD_LENGTH } from './UserService.js';
import { SESSION_IDLE_HOURS, SESSION_MAXIMUM_HOURS } from './SessionService.js';
import { may, permissionsFor, permissionsOf } from '../../domain/users/User.js';
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
    firstName: 'Anna',
    lastName: 'Berger',
    role: 'ADMIN',
    password: PASSWORD,
  });

  return { application, adminId: admin.id };
}

test('die zwei Stufen gewähren, was ihr Name sagt', () => {
  assert.equal(may('ADMIN', 'MANAGE_USERS'), true);
  assert.equal(may('STANDARD', 'MANAGE_JOBS'), true, 'Normal ist die Stufe, die die Arbeit macht');
  assert.equal(may('STANDARD', 'RUN_JOBS'), true);
  assert.equal(may('STANDARD', 'MANAGE_CREDENTIALS'), false, 'ein Zugang trägt ein fremdes Kennwort');
  assert.equal(
    may('STANDARD', 'MANAGE_USERS'),
    false,
    'wer Benutzer anlegen darf, kann sich selbst zum Administrator machen'
  );
  assert.deepEqual(permissionsOf('STANDARD'), ['VIEW', 'RUN_JOBS', 'MANAGE_JOBS']);
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
    () => application.userService.create({ username: 'Anna', firstName: 'Xenia',
 lastName: 'Xander', role: 'STANDARD', password: PASSWORD }),
    /gibt es schon/
  );
});

test('a password below the minimum length is refused', async () => {
  const application = createInMemoryApplication();

  await assert.rejects(
    () =>
      application.userService.create({
        username: 'kurz',
        firstName: 'Kurt',
        lastName: 'Kurz',
        role: 'STANDARD',
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
    firstName: 'Zoe',
    lastName: 'Zweig',
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
  const normal = await application.userService.create({
    username: 'basti',
    firstName: 'Basti',
    lastName: 'Bauer',
    role: 'STANDARD',
    password: PASSWORD,
  });
  const token = await application.sessionService.issue(normal.id);
  assert.ok(await application.sessionService.resolve(token));

  await application.userService.setEnabled(normal.id, false);

  assert.equal(await application.sessionService.resolve(token), undefined, 'a locked door has to lock now, not in 12 hours');
  assert.ok(adminId);
});

test('a role change invalidates the session that still carries the old role', async () => {
  const { application } = await withAdmin();
  const bearbeiter = await application.userService.create({
    username: 'chris',
    firstName: 'Chris',
    lastName: 'Conrad',
    role: 'STANDARD',
    password: PASSWORD,
  });
  const token = await application.sessionService.issue(bearbeiter.id);

  await application.userService.setRole(bearbeiter.id, 'STANDARD');

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
  const normal = await application.userService.create({
    username: 'dana',
    firstName: 'Dana',
    lastName: 'Dorn',
    role: 'STANDARD',
    password: PASSWORD,
  });

  await application.userService.resetPassword(normal.id, 'vom-Administrator-vergeben-2026');
  const token = await application.sessionService.issue(normal.id);
  const authenticated = await application.sessionService.resolve(token);

  assert.ok(authenticated);
  assert.equal(
    application.sessionService.authorize(authenticated, 'VIEW'),
    false,
    'until the password is replaced the session may only replace it'
  );

  await application.userService.changePassword(normal.id, 'vom-Administrator-vergeben-2026', 'selbst-gewaehlt-2026');
  const fresh = await application.sessionService.resolve(await application.sessionService.issue(normal.id));
  assert.equal(fresh ? application.sessionService.authorize(fresh, 'VIEW') : false, true);
  assert.ok(adminId);
});

test('the last active administrator cannot remove themselves', async () => {
  const { application, adminId } = await withAdmin();

  await assert.rejects(() => application.userService.setRole(adminId, 'STANDARD'), /letzte aktive Administrator/);
  await assert.rejects(() => application.userService.setEnabled(adminId, false), /letzte aktive Administrator/);
  await assert.rejects(() => application.userService.delete(adminId), /letzte aktive Administrator/);
});

test('with a second administrator the first one may step down', async () => {
  const { application, adminId } = await withAdmin();
  await application.userService.create({
    username: 'berta',
    firstName: 'Berta',
    lastName: 'Brandt',
    role: 'ADMIN',
    password: PASSWORD,
  });

  const stepped = await application.userService.setRole(adminId, 'STANDARD');
  assert.equal(stepped.role, 'STANDARD');
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

test('ein neuer Benutzer bekommt sein Kürzel aus dem Namen, ohne es einzutippen', async () => {
  const { application } = await withAdmin();
  const angelegt = await application.userService.create({
    username: 'chris',
    firstName: 'Chris',
    lastName: 'Conrad',
    role: 'STANDARD',
    password: PASSWORD,
  });

  assert.equal(angelegt.initials, 'CCD');
  assert.equal(angelegt.displayName, 'Chris Conrad', 'der ausgeschriebene Name entsteht aus beiden Teilen');
});

test('zwei Namen, die dasselbe Kürzel ergäben, bekommen verschiedene', async () => {
  // withAdmin legt Anna Berger an; das ist ABR.
  const { application } = await withAdmin();
  const zweite = await application.userService.create({
    username: 'anne',
    firstName: 'Anne',
    lastName: 'Bauer',
    role: 'STANDARD',
    password: PASSWORD,
  });

  assert.equal(zweite.initials, 'ABN');
  assert.equal(new Set((await application.userService.list()).map((user) => user.initials)).size, 2);
});

test('ein halber Name wird nicht angenommen', async () => {
  const { application } = await withAdmin();

  await assert.rejects(
    () =>
      application.userService.create({
        username: 'halb',
        firstName: 'Nur',
        lastName: '   ',
        role: 'STANDARD',
        password: PASSWORD,
      }),
    /Vornamen und einen Nachnamen/
  );
});

test('eine Namensberichtigung lässt das Kürzel stehen', async () => {
  const { application, adminId } = await withAdmin();

  const berichtigt = await application.userService.update(adminId, {
    username: 'anna',
    firstName: 'Anne',
    lastName: 'Berger',
    role: 'ADMIN',
  });

  // ABR passt weiter zu Anne Berger, also bleibt es. Ein Kürzel, das ohne Not
  // wechselt, taugt nicht als Wiedererkennung.
  assert.equal(berichtigt.initials, 'ABR');
  assert.equal(berichtigt.displayName, 'Anne Berger');
});

test('ein wirklich anderer Name bekommt ein neues Kürzel', async () => {
  const { application, adminId } = await withAdmin();

  const geändert = await application.userService.update(adminId, {
    username: 'anna',
    firstName: 'Petra',
    lastName: 'Sommer',
    role: 'ADMIN',
  });

  assert.equal(geändert.initials, 'PSR');
});

test('der Anmeldename eines anderen lässt sich nicht übernehmen', async () => {
  const { application, adminId } = await withAdmin();
  await application.userService.create({
    username: 'chris',
    firstName: 'Chris',
    lastName: 'Conrad',
    role: 'STANDARD',
    password: PASSWORD,
  });

  await assert.rejects(
    () =>
      application.userService.update(adminId, {
        username: 'CHRIS',
        firstName: 'Anna',
        lastName: 'Berger',
        role: 'ADMIN',
      }),
    /gibt es schon/
  );

  // Der eigene Name darf dagegen stehen bleiben, ohne dass er als vergeben gilt.
  const gleich = await application.userService.update(adminId, {
    username: 'anna',
    firstName: 'Anna',
    lastName: 'Berger',
    role: 'ADMIN',
  });

  assert.equal(gleich.username, 'anna');
});

test('eine Herabstufung über das Formular beendet die offene Sitzung', async () => {
  const { application } = await withAdmin();
  const zweiter = await application.userService.create({
    username: 'berta',
    firstName: 'Berta',
    lastName: 'Brandt',
    role: 'ADMIN',
    password: PASSWORD,
  });
  const token = await application.sessionService.issue(zweiter.id);

  await application.userService.update(zweiter.id, {
    username: 'berta',
    firstName: 'Berta',
    lastName: 'Brandt',
    role: 'STANDARD',
  });

  assert.equal(await application.sessionService.resolve(token), undefined, 'die Sitzung trüge noch die alte Stufe');
});

test('auch über das Formular kann sich der letzte Administrator nicht herabstufen', async () => {
  const { application, adminId } = await withAdmin();

  await assert.rejects(
    () =>
      application.userService.update(adminId, {
        username: 'anna',
        firstName: 'Anna',
        lastName: 'Berger',
        role: 'STANDARD',
      }),
    /letzte aktive Administrator/
  );
});

test('das Recht auf Konfliktdaten folgt nicht aus der Stufe', () => {
  // Im Konfliktbestand stehen die Werte im Klartext. Wer sie sehen darf, soll
  // namentlich feststehen — auch ein Administrator bekommt es nicht nebenbei.
  assert.equal(permissionsFor({ role: 'ADMIN', handleConflicts: false }).includes('HANDLE_CONFLICTS'), false);
  assert.equal(permissionsFor({ role: 'STANDARD', handleConflicts: false }).includes('HANDLE_CONFLICTS'), false);
  assert.equal(permissionsFor({ role: 'STANDARD', handleConflicts: true }).includes('HANDLE_CONFLICTS'), true);
});

test('das Recht wird beim Anlegen nicht mitgegeben, sondern ausdrücklich erteilt', async () => {
  const { application } = await withAdmin();
  const ohne = await application.userService.create({
    username: 'ohne',
    firstName: 'Ohne',
    lastName: 'Recht',
    role: 'STANDARD',
    password: PASSWORD,
  });

  assert.equal(ohne.handleConflicts, false);

  const mit = await application.userService.update(ohne.id, {
    username: 'ohne',
    firstName: 'Ohne',
    lastName: 'Recht',
    role: 'STANDARD',
    handleConflicts: true,
  });

  assert.equal(mit.handleConflicts, true);
});

test('eine Sitzung darf nur, was ihr Benutzer darf', async () => {
  const { application } = await withAdmin();
  const bearbeiter = await application.userService.create({
    username: 'konflikt',
    firstName: 'Konny',
    lastName: 'Fliktmann',
    role: 'STANDARD',
    password: PASSWORD,
    handleConflicts: true,
  });

  const sitzung = await application.sessionService.resolve(await application.sessionService.issue(bearbeiter.id));
  assert.ok(sitzung);

  assert.equal(application.sessionService.authorize(sitzung, 'HANDLE_CONFLICTS'), true);
  assert.equal(application.sessionService.authorize(sitzung, 'MANAGE_USERS'), false, 'die Stufe bleibt, wie sie war');
});
