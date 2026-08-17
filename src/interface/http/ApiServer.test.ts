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

  // The server does this at startup, so the tests start from the same state.
  await application.tenantService.ensureDefaultTenant();

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

test('the login answers with the same identity as /api/me', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');

  const login = await client.login('anna');
  const me = await client.request('GET', '/api/me');

  // The interface adopts whichever of the two it receives, so a module that
  // travels with one and not the other makes the licence look different
  // depending on whether the page was just loaded or just logged in to.
  assert.deepEqual(login.body.features, me.body.features);
  assert.ok(login.body.features.includes('CONSOLIDATION'));
  assert.deepEqual(login.body.licence, me.body.licence);
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
  assert.match(result.body.error, /Sicherheitsmerkmal/);
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

test('a credential assigned to a client stays assigned to it', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const tenant = await client.application.tenantService.create({ name: 'Kunde A' });

  // Both ways in have to carry the client. Dropping it would quietly turn one
  // client's access data into something every other client may use.
  const typed = await client.request('POST', '/api/credentials', {
    body: { name: 'SFTP Kunde A', type: 'USERNAME_PASSWORD', tenantId: tenant.id, secret: 'geheim' },
  });
  assert.equal(typed.body.tenantId, tenant.id);

  const generated = await client.request('POST', '/api/credentials', {
    body: { name: 'Schlüssel Kunde A', type: 'ENCRYPTION_KEY', tenantId: tenant.id },
  });
  assert.equal(generated.body.tenantId, tenant.id, 'a generated key must not become shared by accident');

  // And leaving it out really does mean shared.
  const shared = await client.request('POST', '/api/credentials', {
    body: { name: 'Übergreifend', type: 'ENCRYPTION_KEY' },
  });
  assert.equal(shared.body.tenantId, undefined);
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

  // Hiding it would let a nightly schedule stop without anybody noticing, and
  // every missing module is named rather than only the first one found.
  assert.equal(job.id, 'sftp-job');
  assert.deepEqual(job.missingFeatures, ['REMOTE_SOURCES', 'TRANSFER']);
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

/*
 * The history asks for /api/runs when no single job is picked. It sits one
 * segment above /api/runs/:id, and the router compares segment counts before
 * anything else — a regression there would show up in the browser as
 * "GET /api/runs does not exist" and nowhere in the unit tests.
 */
test('the history of all jobs has its own path next to a single run', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const all = await client.request('GET', '/api/runs');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body, []);

  assert.equal((await client.request('GET', '/api/runs?tenantId=nobody')).status, 200);
  assert.equal((await client.request('GET', '/api/runs/gibtsnicht')).status, 404);
});

/*
 * SSH keys take a different road through the API than a password: the file is
 * parsed on the way in, and the public half comes back out on its own path.
 */
test('an SSH key can be generated and its public key fetched afterwards', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const created = await client.request('POST', '/api/credentials', {
    body: { name: 'Kunde A SFTP', type: 'SSH_PRIVATE_KEY', username: 'unikom' },
  });

  assert.equal(created.status, 201);
  // The private key never leaves the installation, not even to the browser.
  assert.equal('encryptedSecret' in created.body, false);
  assert.equal('secret' in created.body, false);

  const key = await client.request('GET', `/api/credentials/${created.body.id}/public-key`);

  assert.equal(key.status, 200);
  assert.equal(key.body.algorithm, 'ssh-rsa');
  assert.match(key.body.publicKey, /^ssh-rsa [A-Za-z0-9+/=]+ Kunde-A-SFTP$/);
});

test('an unreadable key file is refused when it is entered, not when the job runs', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const refused = await client.request('POST', '/api/credentials', {
    body: { name: 'Kaputt', type: 'SSH_PRIVATE_KEY', secret: 'das ist kein Schlüssel' },
  });

  assert.equal(refused.status, 400);
  assert.match(String(refused.body.error ?? refused.body.message ?? ''), /kein brauchbarer privater SSH-Schlüssel/);
});

test('only an SSH key has a public key', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const password = await client.request('POST', '/api/credentials', {
    body: { name: 'Kunde B SFTP', type: 'USERNAME_PASSWORD', username: 'unikom', secret: 'geheim' },
  });

  const key = await client.request('GET', `/api/credentials/${password.body.id}/public-key`);

  assert.equal(key.status, 404);
});

/*
 * The remote directory browser sits behind the same authorisation as every
 * other change to a job: it opens a connection with stored credentials, and
 * that is not something a viewer gets to do.
 */
test('browsing a remote directory needs the right to manage jobs', async (t) => {
  const client = await harness(t);
  await withUser(client, 'vera', 'VIEWER');
  await client.login('vera');

  const refused = await client.request('POST', '/api/jobs/browse-remote', {
    body: {
      tenantId: 'default',
      sourceType: 'SFTP',
      sourceConfig: { type: 'SFTP', directory: '/', host: '127.0.0.1' },
      directory: 'orders',
    },
  });

  assert.equal(refused.status, 403);
});

/* Der lokale Browser zeigt das Dateisystem des Servers. Wer Workflows nicht
 * verwalten darf, hat darin nichts zu suchen — sonst wäre er ein bequemer Weg,
 * die Verzeichnisstruktur eines fremden Hauses zu erkunden. */
test('der lokale Verzeichnisbrowser verlangt das Recht, Workflows zu verwalten', async (t) => {
  const client = await harness(t);
  await withUser(client, 'vera', 'VIEWER');
  await client.login('vera');

  const refused = await client.request('POST', '/api/jobs/browse-local', {
    body: { tenantId: 'default', directory: '' },
  });

  assert.equal(refused.status, 403);
});

/* Der Browser der Zielseite öffnet ebenso eine Verbindung mit gespeicherten
 * Zugangsdaten. Eine zweite Tür zu derselben Fähigkeit, die weniger verlangt,
 * wäre der Sinn der ersten. */
test('auch der Zielbrowser verlangt das Recht, Workflows zu verwalten', async (t) => {
  const client = await harness(t);
  await withUser(client, 'vera', 'VIEWER');
  await client.login('vera');

  const refused = await client.request('POST', '/api/jobs/browse-destination', {
    body: {
      tenantId: 'default',
      destinationType: 'SFTP',
      destinationConfig: { type: 'SFTP', directory: '/', host: '127.0.0.1' },
      directory: 'eingang',
    },
  });

  assert.equal(refused.status, 403);
});

test('a path that leaves the working directory is refused without a connection', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  // No server is listening on this port. The answer still has to arrive, and
  // has to be about the path — the check happens before anything is dialled.
  const answer = await client.request('POST', '/api/jobs/browse-remote', {
    body: {
      tenantId: 'default',
      sourceType: 'SFTP',
      sourceConfig: {
        type: 'SFTP',
        directory: '/',
        host: '127.0.0.1',
        port: 1,
        remoteWorkingDirectory: '/customer123',
      },
      directory: '../customer1234',
    },
  });

  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal((answer.body as { ok: boolean }).ok, false);
  assert.match((answer.body as { message: string }).message, /nicht verlassen/);
});

/*
 * Die Zielprüfung muss dorthin sehen, wohin auch geschrieben wird. Prüfte sie
 * bei einem entfernten Ziel das hiesige Dateisystem, meldete sie Erfolg für
 * ein Verzeichnis, das mit dem Lauf nichts zu tun hat — der schlimmste Ausgang,
 * weil er beruhigt.
 */
test('die Prüfung eines entfernten Ziels geht über die Verbindung, nicht über die eigene Platte', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const answer = await client.request('POST', '/api/jobs/check-destination', {
    body: {
      tenantId: 'default',
      name: 'Kunde A',
      destinationType: 'SFTP',
      // Auf diesem Port lauscht nichts. Ein lokales Verzeichnis dieses Namens
      // gibt es aber — die Prüfung darf sich davon nicht täuschen lassen.
      destinationConfig: { type: 'SFTP', directory: '/', host: '127.0.0.1', port: 1, timeoutSeconds: 2 },
      directory: '.',
      createDestinationDirectory: true,
    },
  });

  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal((answer.body as { ok: boolean }).ok, false, JSON.stringify(answer.body));
});
