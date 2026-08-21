import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferJobService } from './TransferJobService.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';

const job: TransferJob = {
  id: 'job-1',
  tenantId: 'default',
  name: 'Customer A Orders',
  enabled: true,
  sourceType: 'LOCAL',
  sourceConfig: { type: 'LOCAL', directory: 'C:/Import' },
  sourceDirectory: 'C:/Import',
  allowedExtensions: ['csv'],
  ignoredTemporaryExtensions: ['.tmp'],
  minimumFileAgeSeconds: 30,
  stabilityCheck: {
    enabled: true,
    intervalSeconds: 5,
    requiredStableChecks: 2,
    compareSize: true,
    compareLastModified: true,
  },
  destinationDirectory: 'D:/Incoming',
  createDestinationDirectory: true,
  conflictStrategy: 'SKIP',
  encryptionConfig: { enabled: false, provider: 'NONE' },
  sourceSuccessAction: 'KEEP',
  executionMode: 'AUTOMATIC',
  createdAt: new Date(),
  updatedAt: new Date(),
};

test('transfer job service stores and retrieves jobs', async () => {
  const repo = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repo);

  await service.create(job);
  const stored = await service.getById('job-1');

  assert.ok(stored);
  assert.equal(stored?.name, 'Customer A Orders');
});

test('transfer job service updates a job', async () => {
  const repo = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repo);

  await service.create(job);
  const updated = await service.update('job-1', { enabled: false, description: 'Disabled temporarily' });

  assert.ok(updated);
  assert.equal(updated?.enabled, false);
  assert.equal(updated?.description, 'Disabled temporarily');
});

test('storing under a new name without a name is refused at save time', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create({ ...job, conflictStrategy: 'NEW_NAME' }),
    /braucht diesen Namen/,
    'a job that promises a name it does not have would fetch its files and have nowhere to put them'
  );
});

test('a chosen name that is a path is refused', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create({ ...job, conflictStrategy: 'NEW_NAME', conflictFilename: '..\\..\\woanders' }),
    /lässt sich nicht als Dateiname verwenden/
  );
});

test('a chosen name survives an update that does not mention it', async () => {
  const repo = new InMemoryTransferJobRepository();
  const service = new TransferJobService(repo);

  await service.create({ ...job, conflictStrategy: 'NEW_NAME', conflictFilename: 'Nachlieferung' });
  const updated = await service.update('job-1', { description: 'Something else entirely' });

  assert.equal(updated?.conflictFilename, 'Nachlieferung');
});

/*
 * Ein Workflow ohne Servernamen speichert sich sonst anstandslos, steht in der
 * Liste wie jeder andere und scheitert das erste Mal um drei Uhr nachts. Die
 * Auskunft käme dann von der Uhrzeit statt vom Editor.
 */
test('eine SFTP-Quelle ohne Servernamen wird beim Speichern abgelehnt', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create({ ...job, sourceType: 'SFTP', sourceConfig: { type: 'SFTP', directory: '/raus' } }),
    /kein Server eingetragen/
  );
});

test('ein SFTP-Ziel ohne Servernamen wird beim Speichern abgelehnt', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create({
        ...job,
        destinationType: 'SFTP',
        destinationConfig: { type: 'SFTP', directory: '/eingang' },
      }),
    /kein Server eingetragen/
  );
});

test('auch das nachträgliche Umstellen auf einen Server ohne Namen wird abgelehnt', async () => {
  // Beim Ändern kommt das als Änderung an zwei unauffälligen Feldern an. Geprüft
  // wird der zusammengesetzte Workflow, nicht die Änderung für sich.
  const service = new TransferJobService(new InMemoryTransferJobRepository());
  await service.create(job);

  await assert.rejects(
    () => service.update('job-1', { destinationType: 'FTPS', destinationConfig: { type: 'FTPS', directory: '/x' } }),
    /kein Server eingetragen/
  );
});

test('ein Server ohne Zugang bleibt erlaubt', async () => {
  // Offene FTP-Server ohne Anmeldung sind selten, aber es gibt sie. Sie zu
  // verbieten wäre eine Regel, die mehr kostet als sie einbringt.
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const gespeichert = await service.create({
    ...job,
    destinationType: 'FTPS',
    destinationConfig: { type: 'FTPS', directory: '/eingang', host: 'ftp.example.de' },
  });

  assert.equal(gespeichert.destinationConfig?.host, 'ftp.example.de');
});

test('eine Freigabe ohne Netzwerkpfad wird beim Speichern abgelehnt', async () => {
  // Sonst trüge der Workflow einen Zugang mit sich, den nichts benutzt: Verbunden
  // wird nur, was über das Netz führt. Er liefe scheinbar richtig und griffe die
  // ganze Zeit auf die eigene Platte zu.
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create({ ...job, sourceType: 'SHARE', sourceDirectory: String.raw`D:\Daten\eingang` }),
    /kein Netzwerkpfad/
  );

  await assert.rejects(
    () => service.create({ ...job, destinationType: 'SHARE', destinationDirectory: String.raw`D:\Daten\ziel` }),
    /kein Netzwerkpfad/
  );
});

test('eine Freigabe ohne Zugang wird beim Speichern abgelehnt', async () => {
  /*
   * Ohne Zugang würde die Freigabe mit dem Konto erreicht, unter dem der Dienst
   * gerade läuft — nicht mit dem der Person, die den Workflow anlegt. Beim
   * Einrichten fällt das nicht auf, weil Unikom dann oft in deren Sitzung
   * läuft; nach der Dienstinstallation findet derselbe Workflow nichts mehr und
   * sieht dabei aus wie ein Netzproblem.
   */
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create({
        ...job,
        sourceType: 'SHARE',
        sourceDirectory: String.raw`\\SERVER01\Austausch\Eingang`,
        sourceConfig: { type: 'SHARE', directory: String.raw`\\SERVER01\Austausch\Eingang` },
      }),
    /kein Zugang hinterlegt/
  );

  await assert.rejects(
    () =>
      service.create({
        ...job,
        destinationType: 'SHARE',
        destinationDirectory: String.raw`\\SERVER01\Austausch\Ziel`,
      }),
    /kein Zugang hinterlegt/
  );
});

test('eine Freigabe mit Netzwerkpfad und Zugang wird angenommen', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const gespeichert = await service.create({
    ...job,
    sourceType: 'SHARE',
    sourceDirectory: String.raw`\\SERVER01\Austausch\Eingang`,
    sourceConfig: { type: 'SHARE', directory: String.raw`\\SERVER01\Austausch\Eingang` },
    credentialId: 'zugang-dateiserver',
  });

  assert.equal(gespeichert.sourceType, 'SHARE');
});
