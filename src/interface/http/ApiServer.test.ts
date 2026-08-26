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
import { jobRoutes } from './routes/JobRoutes.js';
import type { Role } from '../../domain/users/User.js';
import { MAX_FUNDE, type Bestand } from '../../domain/privacy/DataStore.js';

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
async function harness(t: TestContext, features?: StaticFeatureSet, bestaende?: Bestand[]): Promise<Client> {
  const application = createInMemoryApplication({
    stagingRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-api-')),
    features,
    // Die echten hängen an der Datenbank; hier bekommt die Auskunft einen
    // Bestand, an dem sich prüfen lässt, was die Schnittstelle mit ihm tut.
    bestaende,
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
    firstName: username,
    lastName: `${username}mann`,
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

test('ein normaler Benutzer arbeitet mit Workflows, aber nicht mit Zugängen und Benutzern', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  assert.equal((await client.request('GET', '/api/jobs')).status, 200);
  assert.equal((await client.request('POST', '/api/jobs', { body: createTransferJob() })).status, 201);

  const zugang = await client.request('POST', '/api/credentials', {
    body: { name: 'x', type: 'ENCRYPTION_KEY' },
  });

  assert.equal(zugang.status, 403);
  // Die Absage nennt die Stufe: sonst rät der Kunde, warum es nicht geht.
  assert.match(zugang.body.error, /STANDARD/);
  assert.equal((await client.request('GET', '/api/users')).status, 403);
  assert.equal((await client.request('POST', '/api/users', { body: {} })).status, 403);
});

test('a handed-out password blocks everything but the password change', async (t) => {
  const client = await harness(t);
  const adminId = await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'dana', 'STANDARD');
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
 * Die Verzeichnis-Browser öffnen Verbindungen mit gespeicherten Zugangsdaten
 * und zeigen das Dateisystem des Servers. Sie hängen darum an demselben Recht
 * wie jede andere Änderung an einem Workflow.
 *
 * Geprüft wird die Angabe an der Route selbst, nicht ein abgewiesener Aufruf:
 * seit es nur noch zwei Stufen gibt, ist jeder, der sich anmelden kann, auch
 * einer, der Workflows verwalten darf — ein Konto, an dem sich eine Absage
 * vorführen ließe, gibt es nicht mehr. Ohne diesen Test stünde die Angabe
 * ungeprüft da, und ein „SESSION" an ihrer Stelle fiele niemandem auf.
 */
test('die Verzeichnis-Browser verlangen das Recht, Workflows zu verwalten', async (t) => {
  const client = await harness(t);
  const routes = jobRoutes(client.application);

  for (const pattern of [
    '/api/jobs/browse-remote',
    '/api/jobs/browse-local',
    '/api/jobs/browse-destination',
    '/api/jobs/check-destination',
    '/api/jobs/check-archive',
    '/api/jobs/create-directory',
    '/api/jobs/test-connection',
  ]) {
    const route = routes.find((entry) => entry.pattern === pattern && entry.method === 'POST');

    assert.ok(route, `${pattern} gibt es nicht mehr`);
    assert.equal(route.authorization, 'MANAGE_JOBS', pattern);
  }
});

/* Und dass die Angabe wirklich gelesen wird, statt nur dazustehen. */
test('ohne Anmeldung führt kein Verzeichnis-Browser irgendwohin', async (t) => {
  const client = await harness(t);

  const refused = await client.request('POST', '/api/jobs/browse-local', {
    body: { tenantId: 'default', directory: '' },
    csrf: null,
  });

  assert.equal(refused.status, 401);
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


/*
 * Was der Editor über eine Freigabe sagt, muss über dieselbe Verbindung
 * ermittelt sein, die der Lauf später aufmacht.
 *
 * Sonst greifen Verbindungsprobe, Verzeichnisbrowser und Zielprüfung mit dem
 * Konto zu, unter dem Unikom gerade läuft — bei der Einrichtung ist das die
 * Sitzung dessen, der davorsitzt. Das grüne Häkchen sagte dann nur, dass
 * *diese* Person die Freigabe erreicht, und nichts über den eingetragenen
 * Zugang. Beruhigend und falsch, und es fällt erst nachts auf.
 */

const FREIGABE = '\\SERVER01\Austausch\Eingang';

interface Verbindungsversuch {
  directory: string;
  username?: string;
}

/** Ersetzt die Verbindungsverwaltung und schreibt mit, statt zu verbinden. */
async function mitAufzeichnung(client: Client): Promise<{ versuche: Verbindungsversuch[]; zugangId: string }> {
  const versuche: Verbindungsversuch[] = [];

  client.application.shares = {
    async withConnection(directory, credentials, _trace, work) {
      versuche.push({ directory, username: credentials?.username });
      return work();
    },
  };

  const zugang = await client.application.credentialService.create({
    name: 'Dateiserver',
    type: 'USERNAME_PASSWORD',
    username: 'SERVER01\Uebernahme',
    secret: 'nicht-im-Protokoll',
  });

  return { versuche, zugangId: zugang.id };
}

test('die Verbindungsprobe einer Freigabe geht über den hinterlegten Zugang', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const { versuche, zugangId } = await mitAufzeichnung(client);

  await client.request('POST', '/api/jobs/test-connection', {
    body: {
      tenantId: 'default',
      name: 'Kunde A',
      sourceType: 'SHARE',
      sourceConfig: { type: 'SHARE', directory: FREIGABE },
      credentialId: zugangId,
    },
  });

  assert.deepEqual(versuche, [{ directory: FREIGABE, username: 'SERVER01\Uebernahme' }]);
});

test('auch der Verzeichnisbrowser sieht die Freigabe mit ihrem Zugang', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const { versuche, zugangId } = await mitAufzeichnung(client);

  await client.request('POST', '/api/jobs/browse-local', {
    body: { tenantId: 'default', sourceType: 'SHARE', credentialId: zugangId, directory: FREIGABE },
  });

  assert.deepEqual(versuche, [{ directory: FREIGABE, username: 'SERVER01\Uebernahme' }]);
});

test('und die Zielprüfung ebenso', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const { versuche, zugangId } = await mitAufzeichnung(client);

  await client.request('POST', '/api/jobs/check-destination', {
    body: {
      tenantId: 'default',
      name: 'Kunde A',
      destinationType: 'SHARE',
      destinationCredentialId: zugangId,
      directory: FREIGABE,
    },
  });

  assert.deepEqual(versuche, [{ directory: FREIGABE, username: 'SERVER01\Uebernahme' }]);
});

test('ein lokales Verzeichnis macht keine Verbindung auf', async (t) => {
  // Die Gegenprobe: Eine Sitzung, die niemand verlangt hat, wäre ein Eingriff
  // in den Rechner — und je Server lässt Windows nur eine zu.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const { versuche } = await mitAufzeichnung(client);

  await client.request('POST', '/api/jobs/browse-local', {
    body: { tenantId: 'default', sourceType: 'LOCAL', directory: '.' },
  });

  assert.deepEqual(versuche, []);
});

/*
 * Das Archivverzeichnis liegt auf der Quelle. Prüfte der Server es im hiesigen
 * Dateisystem, meldete er Erfolg für ein Verzeichnis, in das nie etwas
 * verschoben wird — beruhigend und falsch, wie bei der Zielprüfung.
 */
test('die Prüfung des Archivs einer entfernten Quelle geht über deren Verbindung', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const answer = await client.request('POST', '/api/jobs/check-archive', {
    body: {
      tenantId: 'default',
      name: 'Kunde A',
      sourceType: 'SFTP',
      // Auf diesem Port lauscht nichts. Ein lokales Verzeichnis dieses Namens
      // gibt es aber — die Prüfung darf sich davon nicht täuschen lassen.
      sourceConfig: { type: 'SFTP', directory: '/', host: '127.0.0.1', port: 1, timeoutSeconds: 2 },
      directory: '.',
    },
  });

  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal((answer.body as { ok: boolean }).ok, false, JSON.stringify(answer.body));
});

test('das Archiv auf einer Freigabe wird mit dem Zugang der Quelle geprüft', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const { versuche, zugangId } = await mitAufzeichnung(client);

  await client.request('POST', '/api/jobs/check-archive', {
    body: {
      tenantId: 'default',
      name: 'Kunde A',
      sourceType: 'SHARE',
      sourceConfig: { type: 'SHARE', directory: FREIGABE },
      credentialId: zugangId,
      directory: FREIGABE + '\archiv',
    },
  });

  assert.deepEqual(versuche, [
    { directory: FREIGABE + '\archiv', username: 'SERVER01\Uebernahme' },
  ]);
});

/*
 * Der einzige dieser Endpunkte, der auf dem System des Kunden schreibt.
 *
 * Geprüft wird deshalb weniger, dass er anlegt, als *was er nicht anlegt*: Ein
 * Name mit Pfad darin führte den Ordner aus dem Verzeichnis heraus, in dem
 * jemand gerade steht — beim Kunden schlimmstenfalls in das Verzeichnis eines
 * anderen Mandanten.
 */
test('ein neuer Ordner entsteht dort, wo das Fenster steht', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const eltern = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ordner-'));

  const answer = await client.request('POST', '/api/jobs/create-directory', {
    body: { tenantId: 'default', name: 'Kunde A', sourceType: 'LOCAL', directory: eltern, folder: 'archiv' },
  });

  assert.equal((answer.body as { ok: boolean }).ok, true, JSON.stringify(answer.body));
  assert.equal((await fs.stat(path.join(eltern, 'archiv'))).isDirectory(), true);
  // Der angelegte Pfad kommt zurück, damit das Fenster hineingehen kann.
  assert.equal((answer.body as { path: string }).path, path.join(eltern, 'archiv'));
});

test('ein Name mit Pfad darin wird abgelehnt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const eltern = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ordner-'));

  for (const name of ['..', '..' + '\\' + 'woanders', 'a/b']) {
    const answer = await client.request('POST', '/api/jobs/create-directory', {
      body: { tenantId: 'default', name: 'Kunde A', sourceType: 'LOCAL', directory: eltern, folder: name },
    });

    assert.equal((answer.body as { ok: boolean }).ok, false, name);
    assert.match((answer.body as { message: string }).message, /einfacher Name/, name);
  }

  // Und wirklich nichts angelegt, auch nicht daneben.
  assert.deepEqual(await fs.readdir(eltern), []);
});

test('einen Ordner zweimal anzulegen sagt es, statt still nichts zu tun', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const eltern = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-ordner-'));
  const anfrage = {
    body: { tenantId: 'default', name: 'Kunde A', sourceType: 'LOCAL', directory: eltern, folder: 'archiv' },
  };

  await client.request('POST', '/api/jobs/create-directory', anfrage);
  const zweiter = await client.request('POST', '/api/jobs/create-directory', anfrage);

  assert.equal((zweiter.body as { ok: boolean }).ok, false);
  assert.match((zweiter.body as { message: string }).message, /gibt es schon/);
});

test('ein Ordner auf einer Freigabe wird über deren Zugang angelegt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  const { versuche, zugangId } = await mitAufzeichnung(client);

  await client.request('POST', '/api/jobs/create-directory', {
    body: {
      tenantId: 'default',
      name: 'Kunde A',
      sourceType: 'SHARE',
      credentialId: zugangId,
      directory: FREIGABE,
      folder: 'archiv',
    },
  });

  assert.deepEqual(versuche, [{ directory: FREIGABE, username: 'SERVER01\Uebernahme' }]);
});

/*
 * Die Region hängt am Mandanten, nicht an der Installation.
 *
 * Ein Dienstleister holt Daten für mehrere eigene Kunden, und die sitzen in
 * verschiedenen Ländern. Eine Angabe für das ganze Haus läse die Dateien des
 * einen nach der Regel des anderen — stillschweigend, weil `04/03/2026` in
 * beiden Lesarten gelingt.
 */
test('ein Mandant bringt seine Region samt Bedeutung mit', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const antwort = await client.request('GET', '/api/tenants/default');

  assert.equal(antwort.status, 200);
  assert.deepEqual((antwort.body as { region: unknown }).region, {
    locale: 'de-DE',
    timeZone: 'Europe/Berlin',
  });
  assert.equal((antwort.body as { regionIsDefault: boolean }).regionIsDefault, true);
  assert.equal((antwort.body as { dateOrder: string }).dateOrder, 'DAY_FIRST');
  assert.equal((antwort.body as { dateSample: string }).dateSample, '3.4.2026');
});

test('zwei Mandanten lesen dasselbe Datum verschieden', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const amerikanisch = await client.request('POST', '/api/tenants', {
    body: { name: 'Kunde USA', region: { locale: 'en-US', timeZone: 'America/New_York' } },
  });

  assert.equal(amerikanisch.status, 201, JSON.stringify(amerikanisch.body));
  assert.equal((amerikanisch.body as { dateOrder: string }).dateOrder, 'MONTH_FIRST');
  assert.equal((amerikanisch.body as { dateSample: string }).dateSample, '4/3/2026');
  assert.equal((amerikanisch.body as { regionIsDefault: boolean }).regionIsDefault, false);

  // Und der Standardmandant daneben bleibt, wie er war.
  const standard = await client.request('GET', '/api/tenants/default');
  assert.equal((standard.body as { dateOrder: string }).dateOrder, 'DAY_FIRST');
});

test('eine Region, die still ausweichen würde, wird am Mandanten abgelehnt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const antwort = await client.request('PUT', '/api/tenants/default', {
    body: { region: { locale: 'xx-XX', timeZone: 'Europe/Berlin' } },
  });

  assert.equal(antwort.status, 400);
  assert.match((antwort.body as { error: string }).error ?? '', /nicht bedient/);

  // Nichts übernommen: Der Mandant steht, wie er stand.
  const danach = await client.request('GET', '/api/tenants/default');
  assert.equal((danach.body as { regionIsDefault: boolean }).regionIsDefault, true);
});

test('eine geänderte Region bleibt am Mandanten stehen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.request('PUT', '/api/tenants/default', {
    body: { region: { locale: 'en-GB', timeZone: 'Europe/London' } },
  });

  const danach = await client.request('GET', '/api/tenants/default');
  assert.deepEqual((danach.body as { region: unknown }).region, {
    locale: 'en-GB',
    timeZone: 'Europe/London',
  });
  // Englisch, aber Tag zuerst — der Fall, den eine Tabelle nach Sprache
  // verwechselt hätte.
  assert.equal((danach.body as { dateOrder: string }).dateOrder, 'DAY_FIRST');
  assert.equal((danach.body as { dateSample: string }).dateSample, '03/04/2026');
});

/*
 * Wer hat das eingestellt?
 *
 * Die Frage kommt Monate später und meist von jemandem, der keinen Zugang zum
 * System hat. Sie lässt sich nur beantworten, wenn die Kennung des Benutzers
 * an der Handlung hängt — der Anmeldename allein genügt nicht, denn er lässt
 * sich ändern, und die Kennung bleibt.
 */
test('eine Änderung trägt Kennung und Name dessen, der sie veranlasst hat', async (t) => {
  const client = await harness(t);
  const anna = await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.request('PUT', '/api/tenants/default', {
    body: { region: { locale: 'en-GB', timeZone: 'Europe/London' } },
  });

  const zeilen = await client.application.logRepository.list({});
  const änderung = zeilen.find((zeile) => zeile.message.includes('/api/tenants/default'));

  assert.ok(änderung, 'die Änderung muss im Protokoll stehen');
  assert.equal(änderung?.userId, anna);
  assert.equal(änderung?.username, 'anna');
});

test('das Abrufen einer Liste ist keine Änderung und steht nicht im Protokoll', async (t) => {
  // Eine Zeile je Klick machte das Protokoll für die Fälle unbrauchbar, für
  // die es da ist.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.request('GET', '/api/tenants');

  const zeilen = await client.application.logRepository.list({});
  assert.equal(
    zeilen.some((zeile) => zeile.message.includes('GET /api/tenants')),
    false
  );
});

test('der Inhalt der Anfrage steht nicht im Protokoll', async (t) => {
  /*
   * In ihm stehen Kennwörter und Schlüssel, und dieses Protokoll wird
   * weitergegeben. Geprüft an einem Zugang, dessen Geheimnis unverwechselbar
   * ist.
   */
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.request('POST', '/api/credentials', {
    body: {
      name: 'Dateiserver',
      type: 'USERNAME_PASSWORD',
      username: 'uebernahme',
      secret: 'streng-geheimes-kennwort-4711',
    },
  });

  const alles = (await client.application.logRepository.list({})).map((zeile) => zeile.message).join('\n');

  assert.equal(alles.includes('streng-geheimes-kennwort-4711'), false);
  assert.ok(alles.includes('POST /api/credentials'), 'dass etwas angelegt wurde, gehört hinein');
});

test('eine abgewiesene Änderung wird nicht als geschehen protokolliert', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.request('PUT', '/api/tenants/default', {
    body: { region: { locale: 'xx-XX', timeZone: 'Europe/Berlin' } },
  });

  const zeilen = await client.application.logRepository.list({});
  assert.equal(
    zeilen.some((zeile) => zeile.message.includes('/api/tenants/default')),
    false
  );
});

test('ein Administrator ändert Name und Stufe eines Benutzers in einem Zug', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  const chris = await withUser(client, 'chris', 'STANDARD');
  await client.login('anna');

  const geändert = await client.request('PUT', `/api/users/${chris}`, {
    body: { username: 'p.sommer', firstName: 'Petra', lastName: 'Sommer', role: 'ADMIN' },
  });

  assert.equal(geändert.status, 200);
  assert.equal(geändert.body.username, 'p.sommer');
  assert.equal(geändert.body.displayName, 'Petra Sommer');
  // Zum neuen Namen passt das alte Kürzel nicht mehr, also wird es neu gebildet.
  assert.equal(geändert.body.initials, 'PSR');
  assert.equal(geändert.body.role, 'ADMIN');
  assert.equal(geändert.body.passwordHash, undefined, 'der Hash hat hier nichts verloren');
});

test('ein Benutzer ohne Vor- und Nachnamen wird gar nicht erst angelegt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/users', {
    body: { username: 'halb', firstName: 'Nur', role: 'STANDARD', password: 'ein-langes-Passwort-2026' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /lastName/);
});

/*
 * Der ganze Weg eines vergessenen Passworts: der Administrator vergibt eines,
 * der Mensch meldet sich damit an und ersetzt es. Die Stationen einzeln zu
 * prüfen genügt hier nicht — die Frage ist, ob er von vorn bis hinten durch
 * eine Tür kommt, die zwischendurch mehrfach zuschlägt.
 */
test('ein vergebenes Passwort wird bei der Anmeldung ersetzt und gilt danach', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  const chris = await withUser(client, 'chris', 'STANDARD');
  await client.login('anna');

  const vergeben = 'vom-Administrator-2026';
  const vergabe = await client.request('POST', `/api/users/${chris}/password`, { body: { password: vergeben } });
  assert.equal(vergabe.status, 204);

  // Das bisherige Passwort ist damit fort.
  assert.equal((await client.login('chris')).status, 401);

  const angemeldet = await client.login('chris', vergeben);
  assert.equal(angemeldet.status, 200);
  assert.equal(angemeldet.body.mustChangePassword, true);
  assert.deepEqual(angemeldet.body.permissions, [], 'bis zur Änderung darf diese Sitzung nichts anderes');

  const selbst = 'selbst-gewaehlt-2026';
  const änderung = await client.request('POST', '/api/me/password', {
    body: { currentPassword: vergeben, newPassword: selbst },
  });
  assert.equal(änderung.status, 204);

  // Das vergebene Passwort ist verbraucht, das eigene trägt.
  assert.equal((await client.login('chris', vergeben)).status, 401);

  const fertig = await client.login('chris', selbst);
  assert.equal(fertig.status, 200);
  assert.equal(fertig.body.mustChangePassword, false);
  assert.ok(fertig.body.permissions.includes('MANAGE_JOBS'));
});

test('ein falsches bisheriges Passwort ändert nichts', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const abgelehnt = await client.request('POST', '/api/me/password', {
    body: { currentPassword: 'das-war-es-nicht-2026', newPassword: 'ein-neues-Passwort-2026' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.equal((await client.login('chris')).status, 200, 'das bisherige Passwort gilt weiter');
});

test('eine Bestellung im Fließtext wird analysiert, ohne dass daraus eine Datei wird', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const brief = [
    'Sehr geehrte Damen und Herren,',
    '',
    'hiermit bestellen wir folgende Artikel.',
    '',
    'Artikelnummer   Bezeichnung        Menge   Preis',
    '4711            Schraube M8        500     0,12',
    '4712            Mutter M8          500     0,08',
    '4713            Unterlegscheibe    1000    0,04',
    '',
    'Mit freundlichen Grüßen',
  ].join('\n');

  const antwort = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: brief },
  });

  assert.equal(antwort.status, 200);
  assert.equal(antwort.body.blocks.length, 1);

  const [block] = antwort.body.blocks;

  assert.equal(block.start, 6);
  assert.equal(block.end, 8);
  assert.equal(block.headerLine, 5);
  assert.deepEqual(
    block.columns.map((spalte: any) => spalte.type),
    ['INTEGER', 'STRING', 'INTEGER', 'DECIMAL']
  );
  // Anrede und Grußformel gehören nicht dazu — und das steht auch so da.
  assert.deepEqual(antwort.body.ignoredLines, [1, 2, 3, 4, 9, 10]);
});

test('die Analyse liest nach der Region des Mandanten, nicht nach der des Servers', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const angelegt = await client.request('POST', '/api/tenants', {
    body: { name: 'US Corp', region: { locale: 'en-US', timeZone: 'America/New_York' } },
  });

  assert.equal(angelegt.status, 201, angelegt.raw);

  const inhalt = ['Id;Betrag', '1;1,234', '2;2,345', '3;3,456'].join('\n');

  const deutsch = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: inhalt },
  });
  const amerikanisch = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: angelegt.body.id, content: inhalt },
  });

  // Dieselben Zeichen, zwei Bedeutungen: 1,234 ist deutsch eine Dezimalzahl
  // und amerikanisch eintausendzweihundertvierunddreißig.
  assert.equal(deutsch.body.blocks[0].columns[1].type, 'DECIMAL');
  assert.equal(amerikanisch.body.blocks[0].columns[1].type, 'INTEGER');
});

test('hinterlegte Struktur und Erkennung werden zusammengeführt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const antwort = await client.request('POST', '/api/discovery/analyse', {
    body: {
      tenantId: 'default',
      content: ['4711;Schraube;500;0,12', '4712;Mutter;500;0,08', '4713;Scheibe;250;0,04'].join('\n'),
      mode: 'BEIDE',
      expectation: {
        verbindlichkeit: 'VORGABE',
        spalten: [
          { position: 1, name: 'Artikelnummer', type: 'INTEGER' },
          { position: 3, name: 'Menge', type: 'DATE' },
        ],
      },
    },
  });

  assert.equal(antwort.status, 200);
  assert.equal(antwort.body.chosen.configurationMatch, 0.5, 'eine von zwei Angaben trifft zu');
  assert.equal(antwort.body.chosen.abweichungen.length, 1);
  assert.equal(antwort.body.chosen.abweichungen[0].name, 'Menge');
});

test('ein Erkennungsmodus, den es nicht gibt, wird abgelehnt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const abgelehnt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'a;b', mode: 'RATEN' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /kein Erkennungsmodus/);
});

test('eine bestätigte Struktur wird beim nächsten Eingang wiedererkannt', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const lieferung = (nummern: number[]): string =>
    ['Artikelnummer;Bezeichnung;Menge;Preis', ...nummern.map((nummer) => `${nummer};Schraube M8;500;0,12`)].join('\n');

  // Erste Lieferung: nur Erkennung, nichts ist bekannt.
  const erste = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: lieferung([4711, 4712, 4713]) },
  });

  assert.equal(erste.status, 200);
  assert.deepEqual(erste.body.knownStructures, []);

  // Der Mensch bestätigt sie.
  const gespeichert = await client.request('POST', '/api/profiles', {
    body: { tenantId: 'default', name: 'Bestellung Müller GmbH', block: erste.body.blocks[0] },
  });

  assert.equal(gespeichert.status, 201);
  assert.equal(gespeichert.body.confirmedByName, 'chris', 'die Struktur kommt von einem Menschen');
  assert.deepEqual(
    gespeichert.body.columns.map((spalte: any) => spalte.type),
    ['INTEGER', 'STRING', 'INTEGER', 'DECIMAL']
  );

  // Zweite Lieferung derselben Quelle.
  const zweite = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: lieferung([4801, 4802]), mode: 'BEIDE' },
  });

  assert.equal(zweite.body.knownStructures.length, 1);
  assert.equal(zweite.body.knownStructures[0].name, 'Bestellung Müller GmbH');
  assert.equal(zweite.body.knownStructures[0].score, 1);
  assert.equal(zweite.body.usedStructure, 'Bestellung Müller GmbH');

  // Und beide Wege zusammen sind sicherer als die Erkennung allein.
  assert.ok(zweite.body.chosen.overallConfidence > zweite.body.chosen.patternMatch);
  assert.deepEqual(
    zweite.body.chosen.columns.map((spalte: any) => spalte.herkunft),
    ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED']
  );
});

test('eine bekannte Struktur eines anderen Mandanten gilt hier nicht', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const fremder = await client.request('POST', '/api/tenants', { body: { name: 'Fremd GmbH' } });
  const inhalt = ['Nr;Name;Menge', '1;Schraube;500', '2;Mutter;300'].join('\n');

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: inhalt },
  });

  await client.request('POST', '/api/profiles', {
    body: { tenantId: 'default', name: 'Nur für den Standardmandanten', block: erkannt.body.blocks[0] },
  });

  const beimFremden = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: fremder.body.id, content: inhalt, mode: 'BEIDE' },
  });

  assert.deepEqual(beimFremden.body.knownStructures, [], 'Strukturen gehören dem Mandanten, nicht der Installation');
  assert.equal(beimFremden.body.usedStructure, undefined);
});

test('eine Struktur ohne erkannten Block lässt sich nicht anlegen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const abgelehnt = await client.request('POST', '/api/profiles', {
    body: { tenantId: 'default', name: 'Erfunden' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /erkannten Datenblock/);
});

test('aus dem erkannten Block entsteht eine Datei, mit der weitergearbeitet werden kann', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-mandant-'));
  const mandant = await client.request('POST', '/api/tenants', {
    body: { name: 'Müller GmbH', rootDirectory: wurzel },
  });

  assert.equal(mandant.status, 201, mandant.raw);

  const brief = [
    'Sehr geehrte Damen und Herren,',
    '',
    'Artikelnummer;Bezeichnung;Menge;Preis',
    '4711;Schraube M8;500;0,12',
    '4712;Mutter M8;500;0,08',
    '',
    'Mit freundlichen Grüßen',
  ].join('\n');

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: mandant.body.id, content: brief },
  });

  const uebernommen = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: mandant.body.id, name: 'bestellung', block: erkannt.body.blocks[0] },
  });

  assert.equal(uebernommen.status, 200, uebernommen.raw);
  assert.equal(uebernommen.body.rows, 2);

  const geschrieben = await fs.readFile(uebernommen.body.file, 'utf-8');

  // Anrede und Grußformel sind fort; übrig ist ein gewöhnlicher Datenbestand.
  assert.equal(
    geschrieben,
    ['Artikelnummer;Bezeichnung;Menge;Preis', '4711;Schraube M8;500;0,12', '4712;Mutter M8;500;0,08', ''].join('\r\n')
  );

  // Und die Datei liegt im Bereich des Mandanten, nicht irgendwo.
  assert.ok(uebernommen.body.file.startsWith(path.join(wurzel, 'eingang')), uebernommen.body.file);
});

test('ein Dateiname mit Pfad darin wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-mandant-'));
  const mandant = await client.request('POST', '/api/tenants', {
    body: { name: 'Weber AG', rootDirectory: wurzel },
  });

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: mandant.body.id, content: ['a;b', '1;2', '3;4'].join('\n') },
  });

  const abgelehnt = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: mandant.body.id, name: '../../woanders', block: erkannt.body.blocks[0] },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /Pfadangaben/);
});

test('ohne Wurzelverzeichnis sagt Unikom, was fehlt, statt irgendwohin zu schreiben', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: ['a;b', '1;2', '3;4'].join('\n') },
  });

  const abgelehnt = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'egal', block: erkannt.body.blocks[0] },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /Wurzelverzeichnis/);
});

test('eine ganze E-Mail wird analysiert, samt Anhang und Herkunft', async (t) => {
  const client = await harness(t);
  await withUser(client, 'chris', 'STANDARD');
  await client.login('chris');

  const grenze = 'grenze-4711';
  const anhang = Buffer.from(['Nr;Ort;PLZ', '1;Köln;50667', '2;Bonn;53111'].join('\r\n'), 'utf-8');
  const mail = [
    'From: einkauf@mueller.example',
    'Subject: =?UTF-8?Q?Bestellung_M=C3=BCller_GmbH?=',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${grenze}"`,
    '',
    `--${grenze}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Guten Tag,',
    '',
    '4711;Schraube M8;500',
    '4712;Mutter M8;300',
    '',
    'Viele Grüße',
    `--${grenze}`,
    'Content-Type: text/csv; name="Lieferadressen.csv"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="Lieferadressen.csv"',
    '',
    anhang.toString('base64'),
    `--${grenze}--`,
    '',
  ].join('\r\n');

  const antwort = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: mail, kind: 'EMAIL' },
  });

  assert.equal(antwort.status, 200, antwort.raw);
  assert.equal(antwort.body.message.subject, 'Bestellung Müller GmbH', 'der Betreff wird lesbar');
  assert.deepEqual(antwort.body.message.attachments, ['Lieferadressen.csv']);
  assert.equal(antwort.body.blocks.length, 2);
  assert.deepEqual(
    antwort.body.blocks.map((block: any) => block.source),
    ['Text der Nachricht', 'Anhang Lieferadressen.csv']
  );
});

test('das Recht auf Konfliktdaten wird ausdrücklich erteilt und übersteht den Neustart', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const angelegt = await client.request('POST', '/api/users', {
    body: {
      username: 'konny',
      firstName: 'Konny',
      lastName: 'Fliktmann',
      role: 'STANDARD',
      password: 'ein-langes-Passwort-2026',
      handleConflicts: true,
    },
  });

  assert.equal(angelegt.status, 201);
  assert.equal(angelegt.body.handleConflicts, true);

  // Der Administrator selbst hat es nicht — er müsste es sich geben, und das
  // stünde dann im Protokoll.
  const alle = (await client.request('GET', '/api/users')).body;
  const anna = alle.find((eintrag: any) => eintrag.username === 'anna');

  assert.equal(anna.handleConflicts, false, 'auch ein Administrator bekommt es nicht von selbst');
});

test('die Anmeldung nennt das eigene Recht unter den Berechtigungen', async (t) => {
  const client = await harness(t);
  const id = await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const ohne = await client.request('GET', '/api/me');
  assert.equal(ohne.body.permissions.includes('HANDLE_CONFLICTS'), false);

  await client.request('PUT', `/api/users/${id}`, {
    body: { username: 'anna', firstName: 'Anna', lastName: 'Bergmann', role: 'ADMIN', handleConflicts: true },
  });

  const mit = await client.request('GET', '/api/me');
  assert.equal(mit.body.permissions.includes('HANDLE_CONFLICTS'), true);
});

/**
 * Ein Bestand zum Anfassen.
 *
 * Die echten hängen an der Datenbank. Was hier geprüft wird, ist die
 * Schnittstelle davor: dass sie ohne Bestätigung nichts ausführt, dass sie eine
 * vollständige Datei ausleitet und dass ein normaler Benutzer an all das nicht
 * herankommt.
 */
function probeBestand(zeilen: string[]): Bestand {
  const angaben = { key: 'probe', name: 'Probebestand', behandlung: 'SCHWAERZEN' as const };

  return {
    ...angaben,
    inhalt: 'Zeilen für die Prüfung',
    ort: 'DATENBANK',
    personenbezug: 'JA',
    aufbewahrung: '90 Tage',
    mandantenweise: true,

    async suchen(begriff, _tenantId, grenze = MAX_FUNDE) {
      const getroffen = zeilen.filter((zeile) => zeile.includes(begriff));

      return {
        ...angaben,
        treffer: getroffen.length,
        funde: getroffen.slice(0, grenze).map((zeile) => ({ wo: 'Probezeile', auszug: zeile })),
      };
    },

    async ausfuehren(begriff) {
      let stellen = 0;

      zeilen.forEach((zeile, stelle) => {
        if (zeile.includes(begriff)) {
          zeilen[stelle] = zeile.replaceAll(begriff, '[gelöscht]');
          stellen += 1;
        }
      });

      return stellen;
    },
  };
}

async function privacyHarness(t: TestContext, zeilen: string[]): Promise<Client> {
  const client = await harness(t, undefined, [probeBestand(zeilen)]);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  return client;
}

test('die Auskunftsseite bleibt einem normalen Benutzer verschlossen', async (t) => {
  const client = await harness(t, undefined, [probeBestand([])]);
  await withUser(client, 'bernd', 'STANDARD');
  await client.login('bernd');

  assert.equal((await client.request('GET', '/api/privacy/report')).status, 403);
  assert.equal((await client.request('POST', '/api/privacy/search', { body: { term: 'Mustermann' } })).status, 403);
  assert.equal(
    (await client.request('POST', '/api/privacy/erase', { body: { term: 'Mustermann', confirmed: true } })).status,
    403
  );
});

test('die Auskunftsseite nennt Bestände, Fristen und die Zusagen', async (t) => {
  const client = await privacyHarness(t, []);

  await client.application.jobRepository.save(
    createTransferJob({ id: 'j1', tenantId: 'default', name: 'Rechnungen', retention: { logDays: 7 } })
  );

  const bogen = (await client.request('GET', '/api/privacy/report')).body;

  assert.deepEqual(
    bogen.bestaende.map((bestand: any) => bestand.name),
    ['Probebestand']
  );

  const mandant = bogen.fristen.find((eintrag: any) => eintrag.tenantId === 'default');
  const workflow = mandant.workflows.find((eintrag: any) => eintrag.jobId === 'j1');

  assert.equal(workflow.name, 'Rechnungen');
  assert.deepEqual(
    workflow.fristen.find((frist: any) => frist.was === 'Laufprotokoll'),
    { was: 'Laufprotokoll', wert: '7 Tage', voreingestellt: false }
  );

  // Die Zusage, die am meisten wert ist und am leichtesten verloren geht.
  assert.ok(bogen.zusagen.some((zusage: string) => /sendet von sich aus nichts nach außen/.test(zusage)));
});

test('ein Löschauftrag ohne Bestätigung ändert nichts', async (t) => {
  // FR_009, Abschnitt 5: erst anzeigen, dann bestätigen, dann entfernen.
  const zeilen = ['Lieferung an Mustermann'];
  const client = await privacyHarness(t, zeilen);

  const abgelehnt = await client.request('POST', '/api/privacy/erase', { body: { term: 'Mustermann' } });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /bestätigt/);
  assert.deepEqual(zeilen, ['Lieferung an Mustermann'], 'die Zeile steht unverändert');
});

test('ein bestätigter Löschauftrag führt aus und liefert den Beleg mit', async (t) => {
  const zeilen = ['Lieferung an Mustermann', 'Lieferung an Berger'];
  const client = await privacyHarness(t, zeilen);

  const bericht = await client.request('POST', '/api/privacy/erase', {
    body: { term: 'Mustermann', confirmed: true },
  });

  assert.equal(bericht.status, 200);
  assert.deepEqual(zeilen, ['Lieferung an [gelöscht]', 'Lieferung an Berger']);
  assert.match(bericht.body.beleg.filename, /^Unikom_Loeschbeleg_Mustermann_/);
  assert.match(bericht.body.beleg.text, /Probebestand: 1 Stelle\(n\) unkenntlich gemacht/);
  // Ein Beleg, der den gelöschten Wert wiederholt, wäre die Wiedervorlage
  // dessen, was gerade verschwinden sollte — der Suchbegriff steht im Kopf,
  // die Fundstellen nicht mehr.
  assert.equal(bericht.body.beleg.text.match(/Mustermann/g).length, 1);
});

test('die Ausleitung enthält jede Fundstelle, nicht die ersten fünfzig', async (t) => {
  const zeilen = Array.from({ length: 60 }, (_, nummer) => `Vorgang ${nummer} für Mustermann`);
  const client = await privacyHarness(t, zeilen);

  const bildschirm = await client.request('POST', '/api/privacy/search', { body: { term: 'Mustermann' } });
  const datei = await client.request('POST', '/api/privacy/export', { body: { term: 'Mustermann' } });

  assert.equal(bildschirm.body.bestaende[0].treffer, 60);
  assert.equal(bildschirm.body.bestaende[0].funde.length, MAX_FUNDE);

  assert.match(datei.body.filename, /^Unikom_Auskunft_Mustermann_.*\.txt$/);
  assert.equal(datei.body.text.match(/Vorgang \d+ für Mustermann/g).length, 60);
  assert.doesNotMatch(datei.body.text, /aufgeführt/, 'ohne Kürzung kein Hinweis auf eine');
});

test('ein zu kurzer Begriff wird an der Schnittstelle abgewiesen', async (t) => {
  const client = await privacyHarness(t, ['Mustermann']);

  for (const pfad of ['/api/privacy/search', '/api/privacy/export']) {
    const abgelehnt = await client.request('POST', pfad, { body: { term: 'Mu' } });

    assert.equal(abgelehnt.status, 400, pfad);
    assert.match(abgelehnt.body.error, /zu kurz/);
  }
});

/* ---------- Etappe 2: Eingangsprofile, Versionen, Schnappschuss ---------- */

const TABELLE = ['Nr;Ort;Betrag', '1;Köln;12,50', '2;Bonn;8,00', '3;Essen;19,90'].join('\n');

async function mitProfil(client: Client, name = 'Bestellung Müller GmbH'): Promise<any> {
  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: TABELLE },
  });

  const angelegt = await client.request('POST', '/api/profiles', {
    body: { tenantId: 'default', name, block: erkannt.body.blocks[0] },
  });

  assert.equal(angelegt.status, 201, angelegt.body?.error);
  return angelegt.body;
}

test('ein neues Eingangsprofil beginnt bei Version 1', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);

  assert.equal(profil.version, 1);
  assert.equal(profil.versionen.length, 1);
  assert.equal(profil.confirmedByName, 'anna');
  assert.equal(profil.columns.length, 3);
});

test('eine geänderte Einstellung erzeugt eine Version und lässt die alte stehen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);
  const fortgeschrieben = await client.request('PUT', `/api/profiles/${profil.id}`, {
    body: { einstellungen: { locale: 'en-US' }, notiz: 'Lieferant schreibt jetzt amerikanisch' },
  });

  assert.equal(fortgeschrieben.body.neueVersion, true);
  assert.equal(fortgeschrieben.body.version, 2);
  assert.deepEqual(fortgeschrieben.body.versionen[0].einstellungen, {}, 'Version 1 bleibt, wie sie war');
  assert.equal(fortgeschrieben.body.versionen[1].notiz, 'Lieferant schreibt jetzt amerikanisch');
  assert.equal(fortgeschrieben.body.versionen[1].erstelltVonName, 'anna');
});

test('ein zweites Speichern ohne Änderung erzeugt keine Version', async (t) => {
  // Eine Kette aus zwanzig gleichen Versionen ist keine Geschichte.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);
  await client.request('PUT', `/api/profiles/${profil.id}`, { body: { einstellungen: { locale: 'en-US' } } });
  const nochmal = await client.request('PUT', `/api/profiles/${profil.id}`, {
    body: { einstellungen: { locale: 'en-US' } },
  });

  assert.equal(nochmal.body.neueVersion, false);
  assert.equal(nochmal.body.version, 2);
});

test('ein neuer Name allein ist keine neue Version', async (t) => {
  // Name und Beschreibung sind Beschriftungen, keine Definition — ein Lauf
  // liest nicht nach ihnen.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);
  const umbenannt = await client.request('PUT', `/api/profiles/${profil.id}`, {
    body: { name: 'Bestellung Müller und Söhne' },
  });

  assert.equal(umbenannt.body.name, 'Bestellung Müller und Söhne');
  assert.equal(umbenannt.body.neueVersion, false);
  assert.equal(umbenannt.body.versionen.length, 1);
});

test('eine Einstellung, die es nicht gibt, wird abgewiesen statt stillschweigend abgelegt', async (t) => {
  // Sonst stünde sie für immer im Profil, ohne je zu wirken.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);
  const abgelehnt = await client.request('PUT', `/api/profiles/${profil.id}`, {
    body: { einstellungen: { sprache: 'de' } },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /Unbekannte Einstellung\(en\): sprache/);
});

test('die effektiven Einstellungen zeigen, wer wen überstimmt', async (t) => {
  // Das Beispiel aus SPEC-02, Abschnitt 41, durch die Schnittstelle.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);
  await client.request('PUT', `/api/profiles/${profil.id}`, { body: { einstellungen: { locale: 'fr-FR' } } });
  await client.request('PUT', '/api/tenants/default', {
    body: { name: 'Standard', region: { locale: 'en-US', timeZone: 'America/New_York' } },
  });

  const effektiv = await client.request('GET', `/api/profiles/effective?tenantId=default&profileId=${profil.id}`);
  const sprache = effektiv.body.einstellungen.find((eintrag: any) => eintrag.name === 'locale');

  assert.equal(sprache.wert, 'en-US');
  assert.equal(sprache.ebene, 'MANDANT');
  assert.deepEqual(sprache.ebenen, [
    { ebene: 'ALLGEMEIN', wert: 'de-DE' },
    { ebene: 'PROFIL', wert: 'fr-FR' },
    { ebene: 'MANDANT', wert: 'en-US' },
  ]);
});

test('jede Analyse sagt, womit sie gelesen hat', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const ohneProfil = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: TABELLE },
  });

  assert.ok(ohneProfil.body.snapshot.id);
  assert.equal(ohneProfil.body.snapshot.profileId, undefined);
  assert.equal(ohneProfil.body.snapshot.einstellungen.locale, 'de-DE');
  assert.equal(ohneProfil.body.snapshot.herkunft.locale, 'ALLGEMEIN');
});

test('mit erkanntem Profil trägt der Schnappschuss dessen Version', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const profil = await mitProfil(client);

  const erneut = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: TABELLE, mode: 'BEIDE' },
  });

  assert.equal(erneut.body.snapshot.profileId, profil.id);
  assert.equal(erneut.body.snapshot.profileVersion, 1);
  assert.equal(erneut.body.knownStructures[0].version, 1);
});

test('ein Schnappschuss ändert sich nicht, wenn sich die Einstellungen ändern', async (t) => {
  // SPEC-02, Abschnitt 43: Eine spätere Änderung darf einen abgeschlossenen
  // Lauf nicht nachträglich verändern.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const vorher = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: TABELLE },
  });

  await client.request('PUT', '/api/tenants/default', {
    body: { name: 'Standard', region: { locale: 'en-US', timeZone: 'America/New_York' } },
  });

  const nachher = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: TABELLE },
  });
  const alter = await client.request('GET', `/api/snapshots/${vorher.body.snapshot.id}`);

  assert.equal(nachher.body.snapshot.einstellungen.locale, 'en-US', 'neue Läufe lesen nach der neuen Einstellung');
  assert.equal(alter.body.einstellungen.locale, 'de-DE', 'der alte Schnappschuss bleibt, wie er war');
  assert.notEqual(alter.body.id, nachher.body.snapshot.id);
});

test('ein Eingangsprofil gehört zum Workflow, nicht zur Anlage', async (t) => {
  // Deshalb darf ein normaler Benutzer es pflegen: Er richtet Workflows ein,
  // und ein Profil ist ein Teil davon. Zugänge und Benutzer bleiben dem
  // Administrator vorbehalten — das ist die andere Art von Einstellung.
  const client = await harness(t);
  await withUser(client, 'bernd', 'STANDARD');
  await client.login('bernd');

  const angelegt = await client.request('POST', '/api/profiles', {
    body: { tenantId: 'default', name: 'Bestellung Lieferant', block: { columns: [{ name: 'a' }] } },
  });

  assert.equal(angelegt.status, 201);
  assert.equal((await client.request('GET', '/api/profiles?tenantId=default', { anonymous: true })).status, 401);
});

/* ---------- JSON und XML durch die Analyse ---------- */

test('JSON wird als Bestand gelesen, mit seinen eigenen Typen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const inhalt = JSON.stringify({
    kunden: [
      { nr: 4711, name: 'Mustermann', adresse: { ort: 'Köln' }, aktiv: true },
      { nr: 4712, name: 'Berger', adresse: { ort: 'Bonn' }, aktiv: false },
    ],
  });

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: inhalt, kind: 'JSON' },
  });

  assert.equal(erkannt.status, 200, erkannt.body?.error);

  const block = erkannt.body.blocks[0];

  assert.deepEqual(
    block.columns.map((spalte: any) => spalte.name),
    ['nr', 'name', 'adresse.ort', 'aktiv']
  );
  assert.equal(block.columns[0].type, 'INTEGER');
  assert.equal(block.columns[3].type, 'BOOLEAN');
  assert.equal(block.rows.length, 2);
});

test('XML wird gelesen, Attribute werden eigene Felder', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const inhalt =
    '<bestellungen><bestellung nr="1"><kunde id="4711">Mustermann</kunde><ort>Köln</ort></bestellung>' +
    '<bestellung nr="2"><kunde id="4712">Berger</kunde><ort>Bonn</ort></bestellung></bestellungen>';

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: inhalt, kind: 'XML' },
  });

  assert.equal(erkannt.status, 200, erkannt.body?.error);
  assert.deepEqual(
    erkannt.body.blocks[0].columns.map((spalte: any) => spalte.name),
    ['@nr', 'kunde.@id', 'kunde', 'ort']
  );
});

test('eine XML-Datei mit eigenen Entitäten wird mit Grund abgewiesen', async (t) => {
  // Und zwar mit 400: Eine kaputte oder gefährliche Datei ist eine Auskunft
  // über die Datei, kein Serverfehler.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const angriff =
    '<?xml version="1.0"?><!DOCTYPE l [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><l><e>&xxe;</e></l>';

  const abgelehnt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: angriff, kind: 'XML' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /deklariert eigene Entitäten/);
});

test('kaputtes JSON wird mit Grund abgewiesen, nicht mit einem Serverfehler', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: '{ kaputt: ', kind: 'JSON' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /JSON konnte nicht gelesen werden/);
});

test('eine Art von Inhalt, die es nicht gibt, wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'a;b', kind: 'YAML' },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /keine Art von Inhalt/);
});

test('aus einem JSON-Bestand entsteht eine Datei wie aus jedem anderen', async (t) => {
  // Das ist der Punkt der gemeinsamen Form: Ab hier weiß niemand mehr, aus
  // welchem Format die Daten kamen.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-json-'));
  await client.request('PUT', '/api/tenants/default', { body: { name: 'Standard', rootDirectory: wurzel } });

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: JSON.stringify([{ nr: 1, ort: 'Köln' }, { nr: 2, ort: 'Bonn' }]), kind: 'JSON' },
  });

  const uebernommen = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'kunden', block: erkannt.body.blocks[0] },
  });

  assert.equal(uebernommen.status, 200, uebernommen.body?.error);
  assert.equal(uebernommen.body.rows, 2);

  const geschrieben = await fs.readFile(uebernommen.body.file, 'utf-8');

  assert.match(geschrieben, /nr;ort/);
  assert.match(geschrieben, /2;Bonn/);
});

/* ---------- Der Weg zurück durch die Schnittstelle ---------- */

async function mitWurzel(client: Client): Promise<void> {
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-export-'));

  await client.request('PUT', '/api/tenants/default', { body: { name: 'Standard', rootDirectory: wurzel } });
}

test('ein erkannter Block lässt sich als JSON ausleiten', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  await mitWurzel(client);

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'Nr;Ort\n1;Köln\n2;Bonn' },
  });

  const uebernommen = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'kunden', format: 'JSON', block: erkannt.body.blocks[0] },
  });

  assert.equal(uebernommen.status, 200, uebernommen.body?.error);
  assert.match(uebernommen.body.file, /\.json$/);

  const inhalt = JSON.parse(await fs.readFile(uebernommen.body.file, 'utf-8'));

  assert.equal(inhalt.kunden.length, 2);
  assert.equal(inhalt.kunden[1].Ort, 'Bonn');
});

test('ein erkannter Block lässt sich als XML ausleiten', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  await mitWurzel(client);

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'Nr;Ort\n1;Köln\n2;Bonn' },
  });

  const uebernommen = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'kunden', format: 'XML', block: erkannt.body.blocks[0] },
  });

  assert.equal(uebernommen.status, 200, uebernommen.body?.error);
  assert.match(uebernommen.body.file, /\.xml$/);

  const inhalt = await fs.readFile(uebernommen.body.file, 'utf-8');

  assert.match(inhalt, /<kunden>/);
  assert.match(inhalt, /<Ort>Köln<\/Ort>/);
});

test('ohne Angabe bleibt es bei CSV', async (t) => {
  // Wer nichts sagt, bekommt, was er bisher bekommen hat.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  await mitWurzel(client);

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'Nr;Ort\n1;Köln\n2;Bonn' },
  });

  const uebernommen = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'kunden', block: erkannt.body.blocks[0] },
  });

  assert.equal(uebernommen.body.format, 'CSV');
  assert.match(uebernommen.body.file, /\.csv$/);
});

test('ein Zielformat, das es nicht gibt, wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  await mitWurzel(client);

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'Nr;Ort\n1;Köln\n2;Bonn' },
  });

  const abgelehnt = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'kunden', format: 'YAML', block: erkannt.body.blocks[0] },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /kein Zielformat/);
});

test('XML aus einer Quelle mit unbrauchbaren Spaltennamen sagt, was es umbenannt hat', async (t) => {
  // Eine Umbenennung, die niemand mitbekommt, fällt erst beim Empfänger auf.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');
  await mitWurzel(client);

  const erkannt = await client.request('POST', '/api/discovery/analyse', {
    body: { tenantId: 'default', content: 'Bestell Nr;Ort\n1;Köln\n2;Bonn' },
  });

  const uebernommen = await client.request('POST', '/api/discovery/extract', {
    body: { tenantId: 'default', name: 'kunden', format: 'XML', block: erkannt.body.blocks[0] },
  });

  assert.match(uebernommen.body.notes.join(' '), /taugt nicht als XML-Name/);
});

/* ---------- Etappe 4: Qualität durch die Schnittstelle ---------- */

test('die Prüfung meldet Konflikte je Zeile, ohne die anderen aufzuhalten', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const geprueft = await client.request('POST', '/api/quality/check', {
    body: {
      tenantId: 'default',
      fields: ['customerId', 'email', 'quantity'],
      rows: [
        ['4711', 'anna@example.org', '5'],
        ['4712', 'kein-mail', '-3'],
        ['', 'bernd@example.org', '9'],
      ],
      rules: { quantity: { target: 'INTEGER' } },
    },
  });

  assert.equal(geprueft.status, 200, geprueft.body?.error);
  assert.deepEqual(geprueft.body.pruefzeilen, [2, 3]);
  assert.equal(geprueft.body.blockiert, false);
  assert.equal(geprueft.body.zeilen.length, 3, 'alle Zeilen stehen weiterhin im Ergebnis');
});

test('jeder Befund nennt Ursache und Auswirkung', async (t) => {
  // SPEC-08, Abschnitt 9: in verständlicher Sprache, beides.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const geprueft = await client.request('POST', '/api/quality/check', {
    body: { tenantId: 'default', fields: ['email'], rows: [['kein-mail']] },
  });

  const befund = geprueft.body.befunde.find((eintrag: any) => eintrag.feld === 'email');

  assert.ok(befund.ursache);
  assert.ok(befund.auswirkung);
  assert.notEqual(befund.ursache, befund.auswirkung);
});

test('eine Normalisierung wird ausgewiesen, nicht still vollzogen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const geprueft = await client.request('POST', '/api/quality/check', {
    body: {
      tenantId: 'default',
      fields: ['customerId'],
      rows: [['  4711  ']],
      rules: { customerId: { normalise: { trimmen: true } } },
    },
  });

  assert.deepEqual(geprueft.body.aenderungen[0].schritte, ['Leerzeichen am Rand entfernt']);
  assert.equal(geprueft.body.aenderungen[0].vorher, '  4711  ');
  assert.equal(geprueft.body.aenderungen[0].nachher, '4711');
});

test('Nachkommastellen werden nicht abgeschnitten, sondern gemeldet', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const geprueft = await client.request('POST', '/api/quality/check', {
    body: {
      tenantId: 'default',
      fields: ['quantity'],
      rows: [['1.234,56']],
      rules: { quantity: { target: 'INTEGER' } },
    },
  });

  const konflikt = geprueft.body.befunde.find((befund: any) => befund.schwere === 'KONFLIKT');

  assert.equal(geprueft.body.zusammenfassung.KONFLIKT, 1);
  assert.match(konflikt.auswirkung, /Datenverlust/);
  assert.equal(geprueft.body.zeilen[0][0], '1.234,56', 'der Wert bleibt, wie er war');
});

test('die Region kommt vom Mandanten und nicht aus der Anfrage', async (t) => {
  // Wer sie mitschicken dürfte, könnte eine Prüfung bestehen lassen, die im
  // Lauf danach fehlschlägt — und dann glaubt der Vorschau niemand mehr.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.request('PUT', '/api/tenants/default', {
    body: { name: 'Standard', region: { locale: 'en-US', timeZone: 'America/New_York' } },
  });

  const geprueft = await client.request('POST', '/api/quality/check', {
    body: {
      tenantId: 'default',
      fields: ['quantity'],
      rows: [['1,234.56']],
      rules: { quantity: { target: 'DECIMAL' } },
      region: { locale: 'de-DE' },
    },
  });

  assert.equal(geprueft.body.zusammenfassung.KONFLIKT, 0, 'amerikanisch gelesen, wie am Mandanten eingestellt');
});

test('ein Zieltyp, den es nicht gibt, wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/quality/check', {
    body: { tenantId: 'default', fields: ['a'], rows: [['x']], rules: { a: { target: 'MONEY' } } },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /kein Zieltyp/);
});

test('die geltenden Qualitätsregeln lassen sich abfragen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const regeln = await client.request('GET', '/api/quality/rules');

  assert.ok(regeln.body.some((regel: any) => regel.id === 'email-format'));
  assert.ok(regeln.body.every((regel: any) => regel.name && regel.schwere));
});

/* ---------- Etappe 5: mehrere Quellen durch die Schnittstelle ---------- */

test('der Prüflauf liest zwei CSV-Texte und führt sie zusammen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const lauf = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      mode: 'ANREICHERN',
      type: 'MERGE',
      leading: 'kunden',
      key: { fields: ['kdnr'] },
      sources: [
        { id: 'kunden', name: 'Kunden.csv', text: 'kdnr;name\n4711;Müller GmbH\n' },
        { id: 'adressen', name: 'Adressen.csv', text: 'kdnr;ort\n4711;Bonn\n' },
      ],
    },
  });

  assert.equal(lauf.status, 200, lauf.body?.error);
  assert.deepEqual(lauf.body.felder, ['kdnr', 'name', 'ort']);
  assert.deepEqual(lauf.body.zeilen[0].werte, ['4711', 'Müller GmbH', 'Bonn']);
  assert.deepEqual(lauf.body.zeilen[0].herkunft, [
    { quelle: 'kunden', zeile: 1 },
    { quelle: 'adressen', zeile: 1 },
  ]);
});

test('der Browser zerlegt keine CSV — das Trennzeichen erkennt der Server', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const lauf = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      sources: [{ id: 'a', name: 'A.csv', text: 'kdnr,ort\n4711,Bonn\n' }],
    },
  });

  assert.deepEqual(lauf.body.felder, ['kdnr', 'ort']);
  assert.deepEqual(lauf.body.zeilen[0].werte, ['4711', 'Bonn']);
});

test('die Mindestkonfidenz kommt vom Mandanten und nicht aus der Anfrage', async (t) => {
  // Wer sie mitschicken dürfte, könnte sich eine automatische Entscheidung
  // bestellen, die im Lauf danach ein Konflikt ist.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const lauf = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      type: 'MERGE',
      key: { fields: ['kdnr'] },
      priority: { mindestKonfidenz: 0.5 },
      sources: [
        { id: 'a', name: 'A.csv', text: 'kdnr;ort\n4711;Bonn\n' },
        { id: 'b', name: 'B.csv', text: 'kdnr;ort\n4711;Köln\n' },
        { id: 'c', name: 'C.csv', text: 'kdnr;ort\n4711;Bonn\n' },
      ],
    },
  });

  assert.equal(lauf.body.zusammenfassung.konflikte, 1, 'zwei von drei reichen nicht');
});

test('ein unbekannter Wert für eine Einstellung wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      mode: 'ZUSAMMENWERFEN',
      sources: [{ id: 'a', name: 'A.csv', text: 'kdnr\n1\n' }],
    },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /ANREICHERN, SAMMELN/);
});

test('eine fehlende Hauptdatei ist ein erklärter Konflikt und kein Fehlercode', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const lauf = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      mode: 'ANREICHERN',
      key: { fields: ['kdnr'] },
      sources: [{ id: 'a', name: 'A.csv', text: 'kdnr;ort\n4711;Bonn\n' }],
    },
  });

  assert.equal(lauf.status, 200);
  const konflikt = lauf.body.konflikte.find((eintrag: any) => eintrag.art === 'STRUKTUR');
  assert.ok(konflikt.ursache && konflikt.naechsteSchritte, 'Ursache und nächste Schritte, nicht nur ein Code');
});

test('ohne Quellen gibt es nichts zu konsolidieren', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/consolidation/preview', {
    body: { tenantId: 'default', sources: [] },
  });

  assert.equal(abgelehnt.status, 400);
});

test('der Prüflauf braucht das Recht, Aufträge zu führen', async (t) => {
  const client = await harness(t);

  const anonym = await client.request('POST', '/api/consolidation/preview', {
    body: { tenantId: 'default', sources: [{ id: 'a', name: 'A.csv', text: 'x\n1\n' }] },
  });

  assert.equal(anonym.status, 401);
});

test('die Ähnlichkeitssuche fragt, statt zusammenzuführen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const lauf = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      type: 'MERGE',
      key: { fields: ['kdnr'] },
      similarity: { fields: ['nachname'], threshold: 0.75 },
      sources: [
        { id: 'nord', name: 'Nord.csv', text: 'kdnr;nachname\n1;Meier\n' },
        { id: 'sued', name: 'Süd.csv', text: 'kdnr;nachname\n2;Maier\n' },
      ],
    },
  });

  assert.equal(lauf.status, 200, lauf.body?.error);
  assert.equal(lauf.body.zeilen.length, 2, 'beide Datensätze bleiben stehen');
  assert.equal(lauf.body.zusammenfassung.verdacht, 1);
  assert.equal(lauf.body.konflikte[0].art, 'DUBLETTE_VERMUTET');
});

test('eine Schwelle außerhalb von null bis eins wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      similarity: { fields: ['nachname'], threshold: 12 },
      sources: [{ id: 'a', name: 'A.csv', text: 'nachname\nMeier\n' }],
    },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /keine Schwelle/);
});

test('eine Ähnlichkeitssuche ohne Felder wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      similarity: { fields: [] },
      sources: [{ id: 'a', name: 'A.csv', text: 'nachname\nMeier\n' }],
    },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /woran sich Ähnlichkeit messen/);
});

/* ---------- Etappe 6: Konfliktbearbeitung ---------- */

async function konfliktLauf(client: Client): Promise<string> {
  const lauf = await client.request('POST', '/api/consolidation/preview', {
    body: {
      tenantId: 'default',
      type: 'MERGE',
      key: { fields: ['kdnr'] },
      sources: [
        { id: 'crm', name: 'CRM.csv', text: 'kdnr;ort\n4711;Bonn\n' },
        { id: 'erp', name: 'ERP.csv', text: 'kdnr;ort\n4711;Köln\n' },
      ],
    },
  });

  const faelle = await client.application.conflictService.ausBericht(lauf.body, {
    tenantId: 'default',
    laufId: 'lauf1',
    benutzer: { id: 'system', name: 'System' },
  });

  return faelle[0].id;
}

test('Konflikte eines Laufs lassen sich auflisten und einzeln ansehen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);
  const liste = await client.request('GET', '/api/conflicts?tenantId=default');

  assert.equal(liste.status, 200, liste.body?.error);
  assert.equal(liste.body.faelle.length, 1);
  assert.equal(liste.body.stand.freigabeMoeglich, false);

  const einzeln = await client.request('GET', `/api/conflicts/${id}`);

  assert.equal(einzeln.body.fall.status, 'OFFEN');
  assert.equal(einzeln.body.historie[0].art, 'ENTSTANDEN');
  assert.equal(einzeln.body.bearbeitbar, true);
});

test('die Vorschau schreibt nicht, die Entscheidung schon', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);
  const wahl = { kind: 'BEREINIGEN', fields: [{ field: 'ort', choice: { kind: 'QUELLE', source: 'ERP.csv' } }] };

  const vorschau = await client.request('POST', `/api/conflicts/${id}/preview`, {
    body: { tenantId: 'default', decision: wahl },
  });

  assert.equal(vorschau.status, 200, vorschau.body?.error);
  assert.equal(vorschau.body.werte.ort, 'Köln');
  assert.equal((await client.request('GET', `/api/conflicts/${id}`)).body.fall.status, 'OFFEN');

  const entschieden = await client.request('POST', `/api/conflicts/${id}/decide`, {
    body: { tenantId: 'default', decision: wahl, version: 1 },
  });

  assert.equal(entschieden.status, 200, entschieden.body?.error);
  assert.equal(entschieden.body.fall.status, 'BEREINIGT');
});

test('wer entscheidet, kommt aus der Sitzung und nicht aus dem Rumpf', async (t) => {
  // Eine Historie, in der der Name aus der Anfrage stammt, dokumentiert nur,
  // was jemand behauptet hat.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);

  await client.request('POST', `/api/conflicts/${id}/decide`, {
    body: {
      tenantId: 'default',
      decision: { kind: 'AKZEPTIEREN' },
      benutzer: 'jemand anderes',
      userId: 'fremd',
    },
  });

  const ansicht = await client.request('GET', `/api/conflicts/${id}`);

  assert.equal(ansicht.body.historie[1].benutzerName, 'anna');
});

test('ein gesperrter Fall weist den zweiten Bearbeiter ab', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'bernd', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);

  assert.equal((await client.request('POST', `/api/conflicts/${id}/lock`)).status, 200);

  await client.login('bernd');

  const abgewiesen = await client.request('POST', `/api/conflicts/${id}/lock`);

  assert.equal(abgewiesen.status, 409);
  assert.match(abgewiesen.body.error, /anna hat diesen Fall/);
});

test('eine überholte Fassung wird abgewiesen und nicht überschrieben', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);

  await client.request('POST', `/api/conflicts/${id}/decide`, {
    body: { tenantId: 'default', decision: { kind: 'AKZEPTIEREN' }, version: 1 },
  });

  const zuSpaet = await client.request('POST', `/api/conflicts/${id}/decide`, {
    body: { tenantId: 'default', decision: { kind: 'AKZEPTIEREN' }, version: 1 },
  });

  assert.equal(zuSpaet.status, 409);
  assert.match(zuSpaet.body.error, /Jemand anderes war schneller/);
});

test('die Freigabe wird verweigert, solange ein Fall offen ist', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);
  const verweigert = await client.request('POST', '/api/conflicts/release', { body: { tenantId: 'default' } });

  assert.equal(verweigert.status, 409);
  assert.match(verweigert.body.error, /auf eine Entscheidung/);

  await client.request('POST', `/api/conflicts/${id}/decide`, {
    body: {
      tenantId: 'default',
      decision: { kind: 'BEREINIGEN', fields: [{ field: 'ort', choice: { kind: 'QUELLE', source: 'CRM.csv' } }] },
    },
  });

  /*
   * Entschieden ist entschieden — die Freigabe scheitert jetzt nicht mehr am
   * Bestand, sondern am **Rückweg**: Der Korrekturlauf rechnet auf der
   * ursprünglichen Lieferung, und diese Fälle stammen aus einer Vorschau, die
   * nie eine hatte.
   */
  const ohnePaket = await client.request('POST', '/api/conflicts/release', {
    body: { tenantId: 'default', runId: 'lauf1', newRunId: 'lauf2' },
  });

  assert.equal(ohnePaket.status, 409);
  assert.match(ohnePaket.body.error, /kein Archivpaket/);
});

test('ohne Lauf gibt es keinen Rückweg', async (t) => {
  /*
   * Der Korrekturlauf rechnet auf **einer** Lieferung, und die steht im
   * Archivpaket eines bestimmten Laufs. „Alle bereinigten Fälle des Mandanten"
   * ist keine Lieferung, sondern eine Auswahl über mehrere.
   */
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);

  await client.request('POST', `/api/conflicts/${id}/decide`, {
    body: {
      tenantId: 'default',
      decision: { kind: 'BEREINIGEN', fields: [{ field: 'ort', choice: { kind: 'QUELLE', source: 'CRM.csv' } }] },
    },
  });

  const ohneLauf = await client.request('POST', '/api/conflicts/release', { body: { tenantId: 'default' } });

  assert.equal(ohneLauf.status, 400);
  assert.match(ohneLauf.body.error, /braucht den Lauf/);
});

test('der Bearbeitungsstand wird je Benutzer gespeichert', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await withUser(client, 'bernd', 'ADMIN');
  await client.login('anna');

  const id = await konfliktLauf(client);

  await client.request('PUT', '/api/conflicts/progress', {
    body: { tenantId: 'default', last: id, position: 0, sort: 'ENTSTEHUNG' },
  });

  assert.equal((await client.request('GET', '/api/conflicts?tenantId=default')).body.einstieg.gilt, true);

  await client.login('bernd');

  assert.equal((await client.request('GET', '/api/conflicts?tenantId=default')).body.einstieg.gilt, false);
});

test('ein unbekannter Sortierwert wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const abgelehnt = await client.request('GET', '/api/conflicts?tenantId=default&sort=NACH_LAUNE');

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /DRINGLICHKEIT/);
});

test('die Konfliktbearbeitung verlangt eine Anmeldung', async (t) => {
  const client = await harness(t);

  assert.equal((await client.request('GET', '/api/conflicts?tenantId=default')).status, 401);
});

/* ---------- Etappe 7: Validierung und Freigabe ---------- */

/** Damit jeder Workflow einen eigenen Namen bekommt. */
let zaehler = 1;

/**
 * Ein Prüflauf samt dem Workflow, aus dem er stammt.
 *
 * Der Workflow gehört dazu: Ein Ergebnisstand ohne ihn ließe sich später nicht
 * mehr gegen seine Einstellungen prüfen — und genau daran hängt, ob Modul 3
 * darin eingeschaltet war.
 */
async function lauf(client: Client, workflow?: Record<string, unknown>, quelle = 'kdnr;ort\n4711;Bonn\n4712;Köln\n') {
  const angelegt = await client.request('POST', '/api/jobs', {
    body: {
      ...createTransferJob(),
      name: `Lauf ${zaehler++}`,
      ...(workflow ?? {
        delivery: {
          enabled: true,
          ziel: 'DATEI',
          konvertieren: { format: 'CSV' },
          input: { from: 'PRECEDING' },
          output: { to: 'DIRECTORY', directory: 'C:/aus' },
        },
      }),
    },
  });

  const bericht = await client.request('POST', '/api/consolidation/preview', {
    body: { tenantId: 'default', sources: [{ id: 'a', name: 'A.csv', text: quelle }] },
  });

  return {
    jobId: angelegt.body.id as string,
    report: bericht.body,
    input: {
      fields: bericht.body.felder,
      rows: bericht.body.zeilen.map((zeile: any) => zeile.werte),
    },
  };
}

test('ein sauberer Lauf gibt sich selbst frei', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const abschluss = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', runId: 'lauf1', jobId, report, input },
  });

  assert.equal(abschluss.status, 200, abschluss.body?.error);
  assert.equal(abschluss.body.urteil.frei, true);
  assert.equal(abschluss.body.stand.status, 'COMPLETED');
  assert.equal(abschluss.body.stand.freigabe.art, 'AUTOMATISCH');
  assert.ok(abschluss.body.stand.freigabe.bedingungen.length >= 3, 'die tragenden Bedingungen stehen dabei');
});

test('der Testlauf legt nichts an', async (t) => {
  // SPEC-08, Abschnitt 11: „Der Testlauf darf Originaldaten nicht verändern."
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const geprueft = await client.request('POST', '/api/results/validate', {
    body: { tenantId: 'default', jobId, report, input },
  });

  assert.equal(geprueft.status, 200, geprueft.body?.error);
  assert.equal(geprueft.body.sauber, true);
  assert.deepEqual((await client.request('GET', '/api/results?tenantId=default')).body, []);
});

test('ein fehlendes Zielfeld hält das Ergebnis auf', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const abschluss = await client.request('POST', '/api/results/complete', {
    body: {
      tenantId: 'default',
      jobId,
      report,
      input,
      target: [{ name: 'kdnr', required: true }, { name: 'iban' }],
    },
  });

  assert.equal(abschluss.body.stand.status, 'WAITING_FOR_RELEASE');
  assert.equal(abschluss.body.stand.pruefung.blockiert, true);
  assert.equal(abschluss.body.stand.freigabe, undefined);
});

test('ein offener kritischer Konflikt lässt den Lauf warten, bis ein Mensch entscheidet', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const abschluss = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', jobId, report, input, conflicts: { open: 1, criticalOpen: 1 } },
  });

  const id = abschluss.body.stand.id;

  assert.equal(abschluss.body.stand.status, 'WAITING_FOR_RELEASE');

  const ohneGrund = await client.request('POST', `/api/results/${id}/release`, {
    body: { conflicts: { open: 1, criticalOpen: 1 } },
  });

  assert.equal(ohneGrund.status, 422);
  assert.match(ohneGrund.body.error, /braucht deshalb eine Begründung/);

  const freigegeben = await client.request('POST', `/api/results/${id}/release`, {
    body: { conflicts: { open: 1, criticalOpen: 1 }, reason: 'Mit dem Kunden geklärt' },
  });

  assert.equal(freigegeben.status, 200, freigegeben.body?.error);
  assert.equal(freigegeben.body.status, 'COMPLETED_WITH_CONFLICTS');
  assert.equal(freigegeben.body.freigabe.benutzerName, 'anna');
  assert.match(freigegeben.body.freigabe.begruendung, /geklärt/);
});

test('die Liste kommt ohne die Datenzeilen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  await client.request('POST', '/api/results/complete', { body: { tenantId: 'default', jobId, report, input } });

  const liste = await client.request('GET', '/api/results?tenantId=default');

  assert.equal(liste.body.length, 1);
  assert.equal(liste.body[0].zeilen, undefined);
  assert.equal(liste.body[0].datensaetze, 2);

  const einzeln = await client.request('GET', `/api/results/${liste.body[0].id}`);

  assert.equal(einzeln.body.zeilen.length, 2, 'wer einen Stand öffnet, bekommt sie');
});

test('ein früherer Stand wird kopiert und nicht zurückgespult', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const erster = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', runId: 'lauf1', jobId, report, input },
  });

  const wieder = await client.request('POST', `/api/results/${erster.body.stand.id}/restore`, {
    body: { newRunId: 'lauf9' },
  });

  assert.equal(wieder.status, 200, wieder.body?.error);
  assert.equal(wieder.body.wiederhergestelltAus, erster.body.stand.id);
  assert.equal(wieder.body.ausLauf, 'lauf1');
  assert.equal(wieder.body.status, 'WAITING_FOR_RELEASE');

  const alle = await client.request('GET', '/api/results?tenantId=default');

  assert.equal(alle.body.length, 2, 'der alte Stand bleibt');
  assert.equal(alle.body[0].status, 'COMPLETED');
});

test('ein unbekannter Zieltyp wird abgewiesen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const abgelehnt = await client.request('POST', '/api/results/validate', {
    body: { tenantId: 'default', report, input, target: [{ name: 'kdnr', type: 'MONEY' }] },
  });

  assert.equal(abgelehnt.status, 400);
  assert.match(abgelehnt.body.error, /kein Zieltyp/);
});

test('die Freigabe verlangt eine Anmeldung', async (t) => {
  const client = await harness(t);

  assert.equal((await client.request('GET', '/api/results?tenantId=default')).status, 401);
});

test('die Übergabe an Modul 3 verweigert ein nicht freigegebenes Ergebnis', async (t) => {
  // „Ein nicht freigegebenes Ergebnis ist kein gültiges Ergebnis. Es darf von
  // Modul 3 nicht übernommen werden." Die Prüfung steht auf dieser Seite.
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const abschluss = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', jobId, report, input, conflicts: { open: 1, criticalOpen: 1 } },
  });

  const id = abschluss.body.stand.id;
  const verweigert = await client.request('GET', `/api/results/${id}/handover`);

  assert.equal(verweigert.status, 409);
  assert.match(verweigert.body.error, /nicht freigegeben/);

  await client.request('POST', `/api/results/${id}/release`, {
    body: { conflicts: { open: 1, criticalOpen: 1 }, reason: 'geklärt' },
  });

  const uebergeben = await client.request('GET', `/api/results/${id}/handover`);

  assert.equal(uebergeben.status, 200, uebergeben.body?.error);
  assert.equal(uebergeben.body.datensaetze, 2);
  assert.equal(uebergeben.body.freigabeart, 'MANUELL');
  assert.equal(uebergeben.body.freigegebenVon, 'anna');
});

/* ---------- Modulgrenze: was intern ist, und was hinausgeht ---------- */

test('ohne ein einziges Modul lässt sich alles Interne weiter einstellen', async (t) => {
  /*
   * „Alles, was Unikom intern angeht bzw. den Verarbeitungsablauf, darf
   * generell immer und überall geschrieben werden." Eine Installation ohne
   * Lizenz ist keine, die man nicht mehr bedienen kann — sie ist eine, die
   * nichts ausliefert. Einrichten, prüfen und entscheiden bleibt möglich,
   * sonst könnte niemand vorbereiten, was er nach dem Kauf laufen lassen will.
   */
  const client = await harness(t, new StaticFeatureSet([]));
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const mandant = await client.request('PUT', '/api/tenants/default', {
    body: { name: 'Standard', consolidation: { jahrhundertGrenze: 60 } },
  });

  assert.equal(mandant.status, 200, mandant.body?.error);

  const profil = await client.request('POST', '/api/profiles', {
    body: {
      tenantId: 'default',
      name: 'Bestellung',
      block: { columns: [{ name: 'kdnr', type: 'STRING' }], rows: [['4711']] },
    },
  });

  assert.equal(profil.status, 201, profil.body?.error);

  const zuordnung = await client.request('POST', '/api/mappings', {
    body: { art: 'FELD', ebene: 'MANDANT', tenantId: 'default', von: 'Kd-Nr', nach: 'customerId' },
  });

  assert.equal(zuordnung.status, 201, zuordnung.body?.error);

  const regeln = await client.request('GET', '/api/quality/rules');

  assert.equal(regeln.status, 200, 'die geltenden Regeln lassen sich ansehen');
});

/**
 * Die vier Pflichtverzeichnisse eines abholenden Durchgangs.
 *
 * Ohne sie nimmt der Dienst den Workflow nicht an — siehe
 * `assertAblageorteSindDa`. Als eine Zeile, damit ein Test über Regeln,
 * Umformungen oder Schemata sie nicht viermal ausbuchstabieren muss.
 */
const ABHOLUNG = {
  archiv: 'C:/archiv',
  arbeit: 'C:/arbeit',
  erledigt: 'C:/erledigt',
  gescheitert: 'C:/gescheitert',
};

test('ohne Modul 3 geht kein Datensatz hinaus', async (t) => {
  // „Alles, was Daten-Migration und Daten-Export angeht: nur schreiben, wenn
  // Modul 3 gekauft und angehakt ist."
  const client = await harness(t, new StaticFeatureSet(['CONSOLIDATION']));
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client, {
    transfer: { enabled: false },
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      dateien: { abholung: ABHOLUNG },
    },
  });
  const abschluss = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', jobId, report, input },
  });

  assert.equal(abschluss.status, 200, 'konsolidieren geht');
  assert.equal(abschluss.body.stand.freigabe.art, 'AUTOMATISCH', 'freigeben auch');

  const verweigert = await client.request('GET', `/api/results/${abschluss.body.stand.id}/handover`);

  assert.equal(verweigert.status, 409);
  assert.match(verweigert.body.error, /keines der Module, die Daten hinausgeben/);
});

test('die Übergabe sagt, welche Bedingungen sie geprüft hat', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client);
  const abschluss = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', jobId, report, input },
  });

  const uebergabe = await client.request('GET', `/api/results/${abschluss.body.stand.id}/handover`);

  assert.equal(uebergabe.status, 200, uebergabe.body?.error);
  assert.equal(uebergabe.body.geprueft.length, 2, 'beide Bedingungen, weil der Workflow am Stand hängt');
  assert.match(uebergabe.body.geprueft[0], /^gekauft:/);
  assert.match(uebergabe.body.geprueft[1], /^angehakt:/);
});

test('ein Workflow ohne eingeschaltetes Modul 3 gibt nichts heraus', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const { jobId, report, input } = await lauf(client, {
    transfer: { enabled: false },
    consolidation: {
      enabled: true,
      input: { from: 'DIRECTORY', directory: 'C:/eingang' },
      output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
      dateien: { abholung: ABHOLUNG },
    },
  });

  const abschluss = await client.request('POST', '/api/results/complete', {
    body: { tenantId: 'default', jobId, report, input },
  });

  const verweigert = await client.request('GET', `/api/results/${abschluss.body.stand.id}/handover`);

  assert.equal(verweigert.status, 409);
  assert.match(verweigert.body.error, /in diesem Ablauf nicht eingeschaltet/);
});

test('ein Kunde mit nur der Konsolidierung kann einen Workflow anlegen und speichern', async (t) => {
  /*
   * Er wählt eine Datei selbst aus und konsolidiert sie — ohne Modul 1 und
   * ohne Modul 3. Vorher scheiterte das am Speichern: Das Übertragen galt als
   * eingeschaltet, weil es fehlte, und verlangte ein Modul, das dieser Kunde
   * nie gekauft hat.
   */
  const client = await harness(t, new StaticFeatureSet(['CONSOLIDATION']));
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const angelegt = await client.request('POST', '/api/jobs', {
    body: {
      ...createTransferJob(),
      name: 'Nur konsolidieren',
      transfer: { enabled: false },
      consolidation: {
        enabled: true,
        input: { from: 'DIRECTORY', directory: 'C:/eingang' },
        output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
        dateien: { abholung: ABHOLUNG },
      },
    },
  });

  assert.equal(angelegt.status, 201, angelegt.body?.error);
  assert.equal(angelegt.body.transfer.enabled, false);
  assert.equal(angelegt.body.consolidation.enabled, true);
});

/* ---------- Etappe 8: Hintergrundbetrieb ---------- */

test('die laufenden Prozesse lassen sich abfragen', async (t) => {
  /*
   * Steht hier nichts und ein Workflow ist fällig, läuft der Worker nicht —
   * und das ist die häufigste Ursache dafür, dass „nachts nichts passiert ist".
   */
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const leer = await client.request('GET', '/api/background/processes');

  assert.equal(leer.status, 200, leer.body?.error);
  assert.deepEqual(leer.body, []);

  await client.application.backgroundService.schlage(
    { id: 'worker-1', host: 'rechner', pid: 42, gestartet: new Date().toISOString() },
    'lauf1'
  );

  const belegt = await client.request('GET', '/api/background/processes');

  assert.equal(belegt.body.length, 1);
  assert.equal(belegt.body[0].lebt, true);
  assert.equal(belegt.body[0].schlag.laufId, 'lauf1');
});

test('Benachrichtigungen kommen mit ihrem Stand und den Kanälen', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.application.backgroundService.melde('default', 'LAUF_ERFOLGREICH', {
    titel: 'Fertig',
    text: '12 Dateien',
  });
  await client.application.backgroundService.melde('default', 'KONFLIKTE_ENTSTANDEN', {
    titel: '3 Fälle',
    text: 'warten',
  });

  const antwort = await client.request('GET', '/api/notifications?tenantId=default');

  assert.equal(antwort.status, 200, antwort.body?.error);
  assert.deepEqual(antwort.body.stand, { offen: 2, draengend: 1 });
  assert.equal(antwort.body.kanaele.INFORMATION.popup, false, 'ein Erfolg macht kein Popup auf');
  assert.equal(antwort.body.kanaele.AKTION_ERFORDERLICH.nachVorn, true);
});

test('gesehen und bestätigt gehen getrennte Wege', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  const meldung = await client.application.backgroundService.melde('default', 'LAUF_FEHLER', {
    titel: 'Fehler',
    text: 'x',
  });

  await client.request('POST', `/api/notifications/${meldung.id}/seen`);

  const nachDemSehen = await client.request('GET', '/api/notifications?tenantId=default&open=true');

  assert.equal(nachDemSehen.body.meldungen.length, 1, 'gesehen ist nicht erledigt');
  assert.ok(nachDemSehen.body.meldungen[0].gesehen);

  await client.request('POST', `/api/notifications/${meldung.id}/acknowledge`);

  const danach = await client.request('GET', '/api/notifications?tenantId=default&open=true');

  assert.deepEqual(danach.body.meldungen, []);
  assert.equal((await client.request('GET', '/api/notifications?tenantId=default')).body.meldungen[0].bestaetigtVon, 'anna');
});

test('nachzuholen sind nur die drängenden', async (t) => {
  const client = await harness(t);
  await withUser(client, 'anna', 'ADMIN');
  await client.login('anna');

  await client.application.backgroundService.melde('default', 'LAUF_ERFOLGREICH', { titel: 'a', text: 'a' });
  await client.application.backgroundService.melde('default', 'LAUF_FEHLER', { titel: 'b', text: 'b' });

  const offen = await client.request('GET', '/api/notifications/pending?tenantId=default');

  assert.equal(offen.body.length, 1);
  assert.equal(offen.body[0].titel, 'b');
});

test('der Ereignisstrom verlangt eine Anmeldung', async (t) => {
  const client = await harness(t);
  const antwort = await client.request('GET', '/api/events?tenantId=default');

  assert.equal(antwort.status, 401);
  assert.match(antwort.body.error, /Anmeldung/);
});

test('der Hintergrundbetrieb verlangt eine Anmeldung', async (t) => {
  const client = await harness(t);

  assert.equal((await client.request('GET', '/api/background/processes')).status, 401);
  assert.equal((await client.request('GET', '/api/notifications?tenantId=default')).status, 401);
});
