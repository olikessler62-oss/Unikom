import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInMemoryApplication, type UnikomApplication } from '../runtime/UnikomApplication.js';
import {
  einstellungenDesMandanten,
  wirksameEinstellungen,
} from '../../domain/consolidation/Einstellungen.js';
import { DEFAULT_TENANT_ID, type Tenant } from '../../domain/tenants/Tenant.js';
import { assertWithinTenant, rootsOverlap, TenantBoundaryError } from '../../domain/tenants/TenantContainment.js';
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

test('a network share works as a client directory just like a local path', () => {
  const share: Tenant = {
    id: 'kunde-a',
    name: 'Kunde A',
    rootDirectory: '\\\\dateiserver\\austausch\\KundeA',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Inside its own share directory.
  assertWithinTenant(share, '\\\\dateiserver\\austausch\\KundeA\\eingang', 'The destination');

  // Mixed separators are the same place; somebody typing forward slashes must
  // not be turned away for it.
  assertWithinTenant(share, '//dateiserver/austausch/KundeA/eingang', 'The destination');

  // The neighbouring client's directory on the same share is outside.
  assert.throws(
    () => assertWithinTenant(share, '\\\\dateiserver\\austausch\\KundeB', 'The destination'),
    TenantBoundaryError
  );

  // And so is a local path, however similar it looks.
  assert.throws(() => assertWithinTenant(share, 'C:\\Daten\\KundeA', 'The destination'), TenantBoundaryError);
});

test('two clients on the same share cannot overlap either', () => {
  assert.equal(rootsOverlap('\\\\server\\austausch\\KundeA', '\\\\server\\austausch\\KundeB'), false);
  assert.equal(rootsOverlap('\\\\server\\austausch\\KundeA', '\\\\server\\austausch\\KundeAB'), false);
  assert.equal(rootsOverlap('\\\\server\\austausch', '\\\\server\\austausch\\KundeA'), true);
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
      assert.match(error.message, /außerhalb des Verzeichnisses von „Kunde A“/);
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
      assert.match(error.message, /gehört dem Mandanten „Kunde B“/);
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

  await assert.rejects(() => provider.forJob(job), /gehört einem anderen Mandanten/);
});

test('a client with jobs cannot be deleted by accident', async () => {
  const { application } = await scenario();
  const kunde = await application.tenantService.create({ name: 'Kunde A' });
  await application.jobService.create(createTransferJob({ id: 'job-a', tenantId: kunde.id }));

  await assert.rejects(() => application.tenantService.delete(kunde.id), /hat noch 1 Workflow/);

  await application.jobRepository.delete('job-a');
  await application.tenantService.delete(kunde.id);

  assert.equal(await application.tenantService.getById(kunde.id), undefined);
});

test('two clients cannot carry the same name', async () => {
  const { application } = await scenario();
  await application.tenantService.create({ name: 'Kunde A' });

  await assert.rejects(() => application.tenantService.create({ name: 'Kunde A' }), /gibt es schon/);
});

test('a job pointing at a client that does not exist is refused', async () => {
  const { application } = await scenario();

  await assert.rejects(
    () => application.jobService.create(createTransferJob({ id: 'job-x', tenantId: 'gibtsnicht' })),
    /den es nicht gibt/
  );
});

/* ---------- Die Ebene, die gewinnt ---------- */

test('was am Mandanten eingestellt wird, steht danach auch dort', async () => {
  /*
   * Die Mandantenebene gewinnt in der Hierarchie (SPEC-02, Abschnitt 40) — und
   * war die einzige, die niemand setzen konnte. Neun Stellen im Erzeugnis
   * fragten danach, und es stand immer nichts darin.
   */
  const { application } = await scenario();

  await application.tenantService.update(DEFAULT_TENANT_ID, {
    consolidation: { nullWerte: ['keine Angabe', 'unbekannt'], jahrhundertGrenze: 30 },
  });

  const mandant = await application.tenantService.getById(DEFAULT_TENANT_ID);

  assert.deepEqual(mandant?.consolidation?.nullWerte, ['keine Angabe', 'unbekannt']);
  assert.equal(mandant?.consolidation?.jahrhundertGrenze, 30);
});

test('sie wirkt sich auf die Vererbung aus und nicht nur auf den Bestand', async () => {
  // Sonst wäre sie eine Angabe, die man setzen kann und die nichts tut.
  const { application } = await scenario();

  await application.tenantService.update(DEFAULT_TENANT_ID, {
    consolidation: { nullWerte: ['keine Angabe'] },
  });

  const mandant = await application.tenantService.getById(DEFAULT_TENANT_ID);
  const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant!), undefined);

  assert.deepEqual(wirksam.nullWerte, ['keine Angabe']);
});

test('unbrauchbare Einstellungen werden abgelehnt, bevor irgendetwas gespeichert ist', async () => {
  /*
   * Ein Zahlendreher hier wirkt auf jeden Lauf jedes Workflows dieses Kunden.
   * Halb gespeichert wäre schlimmer als gar nicht: Dann stünde der neue Name im
   * Bestand und die alte Stichprobe daneben.
   */
  const { application } = await scenario();

  await assert.rejects(
    application.tenantService.update(DEFAULT_TENANT_ID, {
      name: 'Umbenannt',
      consolidation: { stichprobe: 2 },
    }),
    /mindestens 10 Werte/
  );

  const mandant = await application.tenantService.getById(DEFAULT_TENANT_ID);

  assert.notEqual(mandant?.name, 'Umbenannt', 'auch der Name darf nicht durchgekommen sein');
  assert.equal(mandant?.consolidation, undefined);
});

test('alle Beanstandungen kommen auf einmal', async () => {
  // Sonst korrigiert jemand vier Mal hintereinander je einen Wert.
  const { application } = await scenario();

  await assert.rejects(
    application.tenantService.update(DEFAULT_TENANT_ID, {
      consolidation: { stichprobe: 2, jahrhundertGrenze: 150 },
    }),
    (fehler: Error) => {
      assert.match(fehler.message, /Stichprobe/);
      assert.match(fehler.message, /Jahrhundertgrenze/);

      return true;
    }
  );
});

test('null nimmt die Einstellungen fort, undefined lässt sie stehen', async () => {
  /*
   * Ohne diesen Unterschied ließe sich eine einmal gesetzte Einstellung nie
   * wieder abschalten — oder jedes Speichern des Formulars schriebe sie erneut.
   */
  const { application } = await scenario();

  await application.tenantService.update(DEFAULT_TENANT_ID, { consolidation: { jahrhundertGrenze: 30 } });
  await application.tenantService.update(DEFAULT_TENANT_ID, { name: 'Standard' });

  assert.equal((await application.tenantService.getById(DEFAULT_TENANT_ID))?.consolidation?.jahrhundertGrenze, 30);

  await application.tenantService.update(DEFAULT_TENANT_ID, { consolidation: null });

  assert.equal((await application.tenantService.getById(DEFAULT_TENANT_ID))?.consolidation, undefined);
});
