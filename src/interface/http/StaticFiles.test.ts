import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStaticHandler } from './StaticFiles.js';
import { ApiServer } from './ApiServer.js';
import { createInMemoryApplication } from '../../application/runtime/UnikomApplication.js';

async function harness(t: TestContext): Promise<string> {
  const web = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-web-'));
  await fs.writeFile(path.join(web, 'index.html'), '<!doctype html><div id="app"></div>');
  await fs.mkdir(path.join(web, 'assets'), { recursive: true });
  await fs.writeFile(path.join(web, 'assets', 'index-abc123.js'), 'console.log(1)');

  // A file that must stay unreachable, one level above the served directory.
  await fs.writeFile(path.join(web, '..', 'geheim.txt'), 'nicht für den Browser');

  const application = createInMemoryApplication();
  const server = new ApiServer(application, { port: 0, staticHandler: createStaticHandler(web) });
  const { port } = await server.listen();

  t.after(async () => {
    await server.close();
    application.close();
  });

  return `http://127.0.0.1:${port}`;
}

test('the entry point is delivered at the root', async (t) => {
  const base = await harness(t);
  const response = await fetch(`${base}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await response.text(), /id="app"/);
});

test('an unknown path gets the interface, which routes it itself', async (t) => {
  const base = await harness(t);
  const response = await fetch(`${base}/jobs/17/bearbeiten`);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="app"/);
});

test('the entry point is never cached, the hashed assets are', async (t) => {
  const base = await harness(t);

  assert.equal((await fetch(`${base}/`)).headers.get('cache-control'), 'no-store');
  assert.match(
    (await fetch(`${base}/assets/index-abc123.js`)).headers.get('cache-control') ?? '',
    /immutable/
  );
});

test('nothing outside the built interface can be read', async (t) => {
  const base = await harness(t);

  for (const attempt of [
    '/../geheim.txt',
    '/..%2Fgeheim.txt',
    '/assets/../../geheim.txt',
    '/%2e%2e/geheim.txt',
  ]) {
    const response = await fetch(`${base}${attempt}`, { redirect: 'manual' });
    const body = response.ok ? await response.text() : '';

    assert.equal(body.includes('nicht für den Browser'), false, `${attempt} reached outside the directory`);
  }
});

test('the API keeps its own paths', async (t) => {
  const base = await harness(t);
  const response = await fetch(`${base}/api/jobs`);

  // Not the entry point: an unauthenticated API call has to be refused, not
  // answered with a page that then looks logged in.
  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
});
