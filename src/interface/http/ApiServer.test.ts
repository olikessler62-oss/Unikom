import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';

import { ApiServer, CSRF_HEADER } from './ApiServer.js';
import { createInMemoryApplication, type UnikomApplication } from '../../application/runtime/UnikomApplication.js';
import { StaticFeatureSet } from '../../domain/licensing/Feature.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { Role } from '../../domain/users/User.js';

const PASSWORD = 'ein-ordentliches-Passwort-2026';

interface Client {
  application: UnikomApplication;
  base: string;
  request(method: string, path: string, options?: { body?: unknown; anonymous?: boolean; csrf?: string | null }): Promise<{
    status: number;
    body: any;
    raw: string;
  }>;
  login(username: string, password?: string): Promise<{ status: number; body: any }>;
}

/**
 * Closing goes through `t.after`, not the end of the test: a failing assertion
 * would otherwise leave the port open, and the test process never exits.
 */
async function harness(t: TestContext, features?: StaticFeatureSet): Promise<Client> {
  const application = createInMemoryApplication({
    stagingRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-api-')),
    features,
    masterKeyProvider: new StaticMasterKeyProvider(randomBytes(32)),
  });

  const server = new ApiServer(application, { port: 0 });
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await server.close();
    application.close();
  });

  let cookie: string | undefined;
  let csrfToken: string | undefined;

  const request: Client['request'] = async (method, target, options = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (cookie && !options.anonymous) {
      headers.cookie = cookie;
    }

    const token = options.csrf === undefined ? csrfToken : options.csrf;
    if (token !== null && token !== undefined) {
      headers[CSRF_HEADER] = token;
    }

    const response = await fetch(`${base}${target}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const setCookie = response.headers.getSetCookie?.()[0];
    if (setCookie) {
      cookie = setCookie.split(';')[0];
    }

    const raw = await response.text();
    return { status: response.status, body: raw ? JSON.parse(raw) : undefined, raw };
  };

  return {
    application,
    base,
    request,
    login: async (username, password = PASSWORD) => {
      const result = await request('POST', '/api/session', { body: { username, password }, anonymous: true });
      csrfToken = result.body?.csrfToken;
      return result;
    },
  };
}

async function withUser(client: Client, username: string, role: Role): Promise<string> {
  const user = await client.application.userService.create({
    username,
    displayName: username,
    role,
    password: PASSWORD,
  });

  return user.id;
}

test('an anonymous request is refused', async (t) => {
  const client = await harness(t);

  const result = await client.request('GET', '/api/jobs', { anonymous: true });

  assert.equal(result.status, 401);
});

test('logging in returns the user, their permissions and a CSRF token', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');

  const result = await client.login('anna');

  assert.equal(result.status, 200);
  assert.equal(result.body.user.username, 'anna');
  assert.ok(result.body.permissions.includes('MANAGE_USERS'));
  assert.ok(result.body.csrfToken);
  assert.equal(result.body.user.passwordHash, undefined, 'the hash has no business leaving the server');
});

test('a wrong password is refused without saying why', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');

  const result = await client.login('anna', 'falsch');

  assert.equal(result.status, 401);
  assert.match(result.body.error, /Username or password/);
});

test('after logging in the session works, and logging out ends it', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  assert.equal((await client.request('GET', '/api/jobs')).status, 200);

  assert.equal((await client.request('DELETE', '/api/session')).status, 204);
  assert.equal((await client.request('GET', '/api/jobs')).status, 401);
});

test('a change without the CSRF token is refused', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  // The cookie travels, as a browser would send it on a foreign site's request.
  const result = await client.request('POST', '/api/jobs', { body: createTransferJob(), csrf: null });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /CSRF/);
});

test('a wrong CSRF token is refused', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const result = await client.request('POST', '/api/jobs', {
    body: createTransferJob(),
    csrf: 'f'.repeat(64),
  });

  assert.equal(result.status, 403);
});

test('reading needs no CSRF token', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  assert.equal((await client.request('GET', '/api/dashboard', { csrf: null })).status, 200);
});

test('a viewer may look but not change', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'basti', 'VIEWER');
  await client.login('basti');

  assert.equal((await client.request('GET', '/api/jobs')).status, 200);

  const forbidden = await client.request('POST', '/api/jobs', { body: createTransferJob() });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.body.error, /VIEWER/);
});

test('an operator manages jobs but not credentials or users', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'chris', 'OPERATOR');
  await client.login('chris');

  assert.equal((await client.request('POST', '/api/jobs', { body: createTransferJob() })).status, 201);
  assert.equal(
    (await client.request('POST', '/api/credentials', { body: { name: 'x', type: 'ENCRYPTION_KEY' } })).status,
    403
  );
  assert.equal((await client.request('GET', '/api/users')).status, 403);
});

test('a handed-out password blocks everything but the password change', async (t) => {
  const client = await harness(t);
  const adminId = await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'dana', 'VIEWER');
  await client.login('anna');

  const dana = (await client.request('GET', '/api/users')).body.find((user: any) => user.username === 'dana');
  await client.request('POST', `/api/users/${dana.id}/password`, { body: { password: 'vom-Admin-vergeben-2026' } });

  const login = await client.login('dana', 'vom-Admin-vergeben-2026');
  assert.equal(login.body.mustChangePassword, true);
  assert.deepEqual(login.body.permissions, [], 'nothing is allowed yet');

  const blocked = await client.request('GET', '/api/jobs');
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /password has to be changed/);

  const changed = await client.request('POST', '/api/me/password', {
    body: { currentPassword: 'vom-Admin-vergeben-2026', newPassword: 'jetzt-mein-eigenes-2026' },
  });
  assert.equal(changed.status, 204);

  await client.login('dana', 'jetzt-mein-eigenes-2026');
  assert.equal((await client.request('GET', '/api/jobs')).status, 200);
  assert.ok(adminId);
});

test('no credential secret ever leaves the server', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const secret = 'streng-geheimes-Kennwort-4711';
  const created = await client.request('POST', '/api/credentials', {
    body: { name: 'Kunde A SFTP', type: 'USERNAME_PASSWORD', username: 'kunde-a', secret },
  });

  assert.equal(created.status, 201);
  assert.equal(created.raw.includes(secret), false, 'the answer to creating it must not echo it back');
  assert.equal(created.body.encryptedSecret, undefined, 'not even the encrypted form belongs in an answer');

  const listed = await client.request('GET', '/api/credentials');
  assert.equal(listed.raw.includes(secret), false);
  assert.equal(listed.raw.includes('encryptedSecret'), false);

  const single = await client.request('GET', `/api/credentials/${created.body.id}`);
  assert.equal(single.raw.includes(secret), false);

  // The secret can be replaced but never read back: the path exists for PUT
  // alone, so a GET is turned away rather than answered.
  assert.equal((await client.request('GET', `/api/credentials/${created.body.id}/secret`)).status, 405);

  // What can be asked is whether the master key still opens it - a yes or no
  // that gives away nothing about the content.
  const check = await client.request('GET', `/api/credentials/${created.body.id}/check`);
  assert.deepEqual(check.body, { resolvable: true });
});

test('a job needing a missing module is refused with the module named', async (t) => {
  const client = await harness(t, new StaticFeatureSet([]));
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const result = await client.request('POST', '/api/jobs', {
    body: createTransferJob({
      sourceType: 'SFTP',
      sourceConfig: { type: 'SFTP', host: 'sftp.example.com', port: 22, directory: '/out' },
    }),
  });

  assert.equal(result.status, 402, 'a missing module is a payment matter, not a mistake');
  assert.equal(result.body.feature, 'REMOTE_SOURCES');
});

test('a job whose module disappeared is still listed, with the gap named', async (t) => {
  const client = await harness(t, new StaticFeatureSet([]));
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  // Saved past the service, as if the licence had been downgraded afterwards.
  await client.application.jobRepository.save(
    createTransferJob({
      id: 'sftp-job',
      sourceType: 'SFTP',
      sourceConfig: { type: 'SFTP', host: 'sftp.example.com', port: 22, directory: '/out' },
    })
  );

  const [job] = (await client.request('GET', '/api/jobs')).body;

  // Hiding it would let a nightly schedule stop without anybody noticing.
  assert.equal(job.id, 'sftp-job');
  assert.deepEqual(job.missingFeatures, ['REMOTE_SOURCES']);
});

test('an unknown path is 404 and a wrong method is 405', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  assert.equal((await client.request('GET', '/api/gibtsnicht')).status, 404);
  assert.equal((await client.request('PATCH', '/api/jobs')).status, 405);
});

test('a malformed body is reported instead of crashing the server', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  // Not logged in, so the body is never even read: refusing first means an
  // outsider cannot make the server do work.
  const anonymous = await fetch(`${client.base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ das ist kein JSON',
  });
  assert.equal(anonymous.status, 401);

  const authenticated = await client.request('POST', '/api/jobs', { body: 'nicht mal ein Objekt' });
  assert.equal(authenticated.status, 400);

  assert.equal((await client.request('GET', '/api/dashboard')).status, 200, 'the server is still answering');
});

test('the answer carries the headers a browser needs', async (t) => {
  const client = await harness(t);
  const response = await fetch(`${client.base}/api/me`);

  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('the session cookie is httpOnly and same-site', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');

  const response = await fetch(`${client.base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'anna', password: PASSWORD }),
  });

  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/, 'no script may read the session token');
  assert.match(cookie, /SameSite=Strict/);
  // Secure would make the cookie vanish on a plain-HTTP installation.
  assert.doesNotMatch(cookie, /Secure/);
});

test('listening on the network without TLS is refused', async () => {
  const application = createInMemoryApplication();
  const exposed = new ApiServer(application, { host: '0.0.0.0', port: 0 });

  await assert.rejects(() => exposed.listen(), /would cross the network in the clear/);

  // With TLS in front it is allowed - and then the cookie is marked Secure.
  const proxied = new ApiServer(application, { host: '0.0.0.0', port: 0, behindTls: true });
  const { port } = await proxied.listen();
  assert.ok(port > 0);
  await proxied.close();
});
