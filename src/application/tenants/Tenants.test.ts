import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInMemoryApplication, type UnikomApplication } from '../runtime/UnikomApplication.js';
import { DEFAULT_TENANT_ID } from '../../domain/tenants/Tenant.js';
import { rootsOverlap, TenantBoundaryError } from '../../domain/tenants/TenantContainment.js';
import { StaticMasterKeyProvider } from '../../infrastructure/security/MasterKeyProvider.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';

async function scenario(): Promise<{ application: UnikomApplication; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-tenants-'));
  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
    masterKeyProvider: new StaticMasterKeyProvider(randomBytes(32)),
  });

  await application.tenantService.ensureDefaultTenant();

  return { application, root };
}

test('an installation always has the standard client', async () => {
  const { application } = await scenario();

  const tenants = await application.tenantService.list();

  assert.equal(tenants.length, 1);
  assert.equal(tenants[0].id, DEFAULT_TENANT_ID);
  // A company with one source server should never have to think about clients.
  assert.equal(tenants[0].rootDirectory, undefined);
});

test('calling the bootstrap again changes nothing', async () => {
  const { application } = await scenario();
  await application.tenantService.ensureDefaultTenant();

  assert.equal((await application.tenantService.list()).length, 1);
});

test('a job from before clients existed is adopted by the standard client', async () => {
  const { application } = await scenario();

  // Written past the service, the way an upgraded installation would have it.
  const orphan = createTransferJob({ id: 'alt' });
  await application.jobRepository.save({ ...orphan, tenantId: undefined as unknown as string });

  await application.tenantService.ensureDefaultTenant();

  assert.equal((await application.jobRepository.getById('alt'))?.tenantId, DEFAULT_TENANT_ID);
});

test('two clients cannot share or nest their directories', async () => {
  const { application, root } = await scenario();
  await application.tenantService.create({ name: 'Kunde A', rootDirectory: path.join(root, 'kunde-a') });

  await assert.rejects(
    () => application.tenantService.create({ name: 'Kunde B', rootDirectory: path.join(root, 'kunde-a') }),
    TenantBoundaryError
  );

  // Nesting is refused too: the boundary would then hold in one direction only,
  // which looks like a guarantee without being one.
  await assert.rejects(
    () =>
      application.tenantService.create({
        name: 'Kunde C',
        rootDirectory: path.join(root, 'kunde-a', 'unter'),
      }),
    TenantBoundaryError
  );
});

test('similar directory names are not treated as nested', () => {
  // A string prefix would make KundeAB look like it sits inside KundeA.
  assert.equal(rootsOverlap('D:/Data/KundeA', 'D:/Data/KundeAB'), false);
  assert.equal(rootsOverlap('D:/Data/KundeA', 'D:/Data/KundeA/eingang'), true);
  assert.equal(rootsOverlap('D:/Data/KundeA', 'D:/Data/KundeA'), true);
});

test('a job cannot write outside its client directory', async () => {
  const { application, root } = await scenario();
  const kundeA = await application.tenantService.create({
    name: 'Kunde A',
    rootDirectory: path.join(root, 'kunde-a'),
  });
  const kundeB = await application.tenantService.create({
    name: 'Kunde B',
    rootDirectory: path.join(root, 'kunde-b'),
  });

  await assert.rejects(
    () =>
      application.jobService.create(
        createTransferJob({
          id: 'verwechselt',
          tenantId: kundeA.id,
          // A typo, and one client's files would land in the other's folder.
          destinationDirectory: path.join(root, 'kunde-b', 'eingang'),
        })
      ),
    (error: unknown) => {
      assert.ok(error instanceof TenantBoundaryError);
      assert.match(error.message, /outside the directory of "Kunde A"/);
      return true;
    }
  );

  // Inside its own directory it works.
  const fine = await application.jobService.create(
    createTransferJob({
      id: 'richtig',
      tenantId: kundeA.id,
      destinationDirectory: path.join(root, 'kunde-a', 'eingang'),
    })
  );
  assert.equal(fine.tenantId, kundeA.id);
  assert.ok(kundeB.id);
});

test('moving a destination out of the client directory is caught on update too', async () => {
  const { application, root } = await scenario();
  const kundeA = await application.tenantService.create({
    name: 'Kunde A',
    rootDirectory: path.join(root, 'kunde-a'),
  });
  await application.jobService.create(
    createTransferJob({
      id: 'job-a',
      tenantId: kundeA.id,
      destinationDirectory: path.join(root, 'kunde-a', 'eingang'),
    })
  );

  await assert.rejects(
    () => application.jobService.update('job-a', { destinationDirectory: path.join(root, 'woanders') }),
    TenantBoundaryError
  );
});

test('narrowing a client directory is refused while a job would fall outside', async () => {
  const { application, root } = await scenario();
  const kunde = await application.tenantService.create({ name: 'Kunde A' });
  await application.jobService.create(
    createTransferJob({ id: 'job-a', tenantId: kunde.id, destinationDirectory: path.join(root, 'irgendwo') })
  );

  await assert.rejects(
    () => application.tenantService.update(kunde.id, { rootDirectory: path.join(root, 'kunde-a') }),
    TenantBoundaryError
  );
});

test('a job cannot use another client credential', async () => {
  const { application } = await scenario();
  const kundeA = await application.tenantService.create({ name: 'Kunde A' });
  const kundeB = await application.tenantService.create({ name: 'Kunde B' });

  const secretOfB = await application.credentialService.create({
    name: 'SFTP Kunde B',
    type: 'USERNAME_PASSWORD',
    tenantId: kundeB.id,
    secret: 'geheim',
  });

  await assert.rejects(
    () =>
      application.jobService.create(
        createTransferJob({ id: 'job-a', tenantId: kundeA.id, credentialId: secretOfB.id })
      ),
    (error: unknown) => {
      assert.ok(error instanceof TenantBoundaryError);
      assert.match(error.message, /belongs to client "Kunde B"/);
      return true;
    }
  );
});

test('a shared credential is available to every client', async () => {
  const { application } = await scenario();
  const kundeA = await application.tenantService.create({ name: 'Kunde A' });

  // No tenantId: an encryption key the operator uses across all clients.
  const shared = await application.credentialService.createEncryptionKey('Ablageschlüssel');

  const job = await application.jobService.create(
    createTransferJob({
      id: 'job-a',
      tenantId: kundeA.id,
      encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: shared.id },
    })
  );

  assert.equal(job.encryptionConfig.keyCredentialId, shared.id);
});

test('the adapter refuses a credential that changed hands afterwards', async () => {
  const { application } = await scenario();
  const kundeA = await application.tenantService.create({ name: 'Kunde A' });
  const kundeB = await application.tenantService.create({ name: 'Kunde B' });

  const shared = await application.credentialService.create({
    name: 'SFTP',
    type: 'USERNAME_PASSWORD',
    secret: 'geheim',
  });

  const job = createTransferJob({
    id: 'job-a',
    tenantId: kundeA.id,
    credentialId: shared.id,
    sourceType: 'SFTP',
    sourceConfig: { type: 'SFTP', host: 'sftp.example.com', port: 22, directory: '/out' },
  });
  await application.jobService.create(job);

  // Assigned to another client after the job was saved, so the check at save
  // time cannot have seen it. The one before the connection has to.
  const stored = await application.credentialRepository.getById(shared.id);
  await application.credentialRepository.save({ ...stored!, tenantId: kundeB.id });

  const { SourceAdapterProvider } = await import('../transfer/SourceAdapterProvider.js');
  const provider = new SourceAdapterProvider(application.credentialService);

  await assert.rejects(() => provider.forJob(job), /belongs to another client/);
});

test('a client with jobs cannot be deleted by accident', async () => {
  const { application } = await scenario();
  const kunde = await application.tenantService.create({ name: 'Kunde A' });
  await application.jobService.create(createTransferJob({ id: 'job-a', tenantId: kunde.id }));

  await assert.rejects(() => application.tenantService.delete(kunde.id), /still has 1 job/);

  await application.jobRepository.delete('job-a');
  await application.tenantService.delete(kunde.id);

  assert.equal(await application.tenantService.getById(kunde.id), undefined);
});

test('two clients cannot carry the same name', async () => {
  const { application } = await scenario();
  await application.tenantService.create({ name: 'Kunde A' });

  await assert.rejects(() => application.tenantService.create({ name: 'Kunde A' }), /already a client named/);
});

test('a job pointing at a client that does not exist is refused', async () => {
  const { application } = await scenario();

  await assert.rejects(
    () => application.jobService.create(createTransferJob({ id: 'job-x', tenantId: 'gibtsnicht' })),
    /does not exist/
  );
});
