import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistentApplication } from './UnikomApplication.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { JobSchedule } from '../../domain/transfer/TransferJob.js';

const SCHEDULE: JobSchedule = {
  type: 'DAILY',
  executionTime: '06:30',
  timezone: 'Europe/Berlin',
  missedRunPolicy: 'SKIP',
};

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-restart-'));
  const dataDirectory = path.join(root, 'application-data');
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');

  await fs.mkdir(sourceDirectory, { recursive: true });

  return { root, dataDirectory, sourceDirectory, destinationDirectory };
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

test('an automatic job and its schedule survive a restart', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();

  // First process: the user configures the job.
  const first = createPersistentApplication(dataDirectory);
  await first.jobRepository.save(
    createTransferJob({
      id: 'customer-a',
      sourceDirectory,
      destinationDirectory,
      executionMode: 'AUTOMATIC',
      schedule: SCHEDULE,
    })
  );

  // Second process: nothing is carried over in memory.
  // 05:00 in Berlin, so today's 06:30 run is still ahead.
  const second = createPersistentApplication(dataDirectory);
  const [restored] = await second.runtime.bootstrap.reconstructSchedules(new Date('2026-08-13T05:00:00+02:00'));

  assert.equal(restored.id, 'customer-a');
  assert.equal(restored.name, 'Customer A Orders');
  assert.equal(restored.schedule?.executionTime, '06:30');
  assert.ok(restored.createdAt instanceof Date, 'stored dates must come back as Date objects');
  assert.equal(restored.nextExecutionAt?.toISOString(), '2026-08-13T04:30:00.000Z');
});

test('a file transferred before the restart is not transferred again', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const job = createTransferJob({
    id: 'customer-a',
    sourceDirectory,
    destinationDirectory,
    executionMode: 'MANUAL_AND_AUTOMATIC',
    schedule: SCHEDULE,
  });

  const first = createPersistentApplication(dataDirectory);
  await first.jobRepository.save(job);
  const firstRun = await first.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  assert.equal(firstRun?.status, TransferRunStatus.SUCCESS);
  assert.equal(firstRun?.filesSucceeded, 1);
  assert.equal(await exists(path.join(destinationDirectory, 'ORDER_001.csv')), true);

  // Restart: a completely fresh application on the same data directory.
  const second = createPersistentApplication(dataDirectory);
  const secondRun = await second.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T07:00:00.000Z'));

  assert.equal(secondRun?.filesSucceeded, 0, 'the file was already taken over before the restart');
  assert.equal(secondRun?.filesSkipped, 1);

  // Both runs are in the persisted history.
  const history = await second.runRepository.listByJob('customer-a');
  assert.equal(history.length, 2);
  assert.ok(history[0].startedAt instanceof Date);
});

test('the processed file registry survives the restart', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const first = createPersistentApplication(dataDirectory);
  await first.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory })
  );
  await first.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const second = createPersistentApplication(dataDirectory);
  const [registered] = await second.transferFileRepository.listByJob('customer-a');

  assert.equal(registered.status, FileTransferStatus.SUCCESS);
  assert.equal(registered.sourceFilename, 'ORDER_001.csv');
  assert.equal(registered.sha256?.length, 64);
  assert.ok(registered.startedAt instanceof Date);
});

test('the data directory holds the database and a clean staging area', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const application = createPersistentApplication(dataDirectory);
  await application.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory })
  );
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const stored = await fs.readdir(dataDirectory);

  assert.ok(stored.includes('unikom.db'));
  // The staging root stays, but no run leftovers may remain inside it.
  assert.deepEqual(await fs.readdir(path.join(dataDirectory, 'staging')), []);
  application.close();
});

// This is the pattern the content check exists for: a source system that
// rewrites its files nightly without changing anything. Same name, new
// modification time - the repeat protection cannot see that they are the same.
test('a file whose timestamp changed is downloaded once, not on every run', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();
  const sourceFile = path.join(sourceDirectory, 'ORDER_001.csv');
  await fs.writeFile(sourceFile, 'customer;amount\nA;42\n');

  const application = createPersistentApplication(dataDirectory);
  await application.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory, detectContentDuplicates: true })
  );

  const first = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));
  assert.equal(first?.filesSucceeded, 1);

  // Same content, new modification time — as if the source system rewrote it.
  const later = new Date('2026-08-13T07:00:00.000Z');
  await fs.utimes(sourceFile, later, later);

  // The identity no longer matches, so this run has to download and hash it.
  const second = createPersistentApplication(dataDirectory);
  const secondRun = await second.runtime.orchestrator.runJobNow('customer-a', later);
  assert.equal(secondRun?.filesSkipped, 1);

  const [afterSecond] = await second.transferFileRepository.listByRun(secondRun?.id ?? '');
  assert.equal(afterSecond.resolution, 'DUPLICATE');
  assert.ok(afterSecond.sha256, 'the content check needs the hash, so this run downloaded the file');

  // From now on the file is settled and must be recognised before any download.
  const third = createPersistentApplication(dataDirectory);
  const thirdRun = await third.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T07:15:00.000Z'));
  assert.equal(thirdRun?.filesSkipped, 1);

  const [afterThird] = await third.transferFileRepository.listByRun(thirdRun?.id ?? '');
  assert.equal(afterThird.resolution, 'DUPLICATE');
  assert.equal(afterThird.sha256, undefined, 'no hash means the file was recognised before any download');
});

test('a new file after the restart is still picked up', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const first = createPersistentApplication(dataDirectory);
  await first.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory })
  );
  await first.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  await fs.writeFile(path.join(sourceDirectory, 'ORDER_002.csv'), 'customer;amount\nB;17\n');

  const second = createPersistentApplication(dataDirectory);
  const run = await second.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T07:00:00.000Z'));

  assert.equal(run?.filesSucceeded, 1);
  assert.equal(run?.filesSkipped, 1);
  assert.equal(await exists(path.join(destinationDirectory, 'ORDER_002.csv')), true);
});

/*
 * Das Protokoll ist der einzige Zeuge dessen, was ein Lauf getan hat, und
 * gebraucht wird er fast immer später: Was um drei Uhr nachts schiefging, sieht
 * jemand um acht — und dazwischen kann der Rechner neu gestartet haben. Steht
 * das Protokoll nur im Arbeitsspeicher, ist es genau dann fort, wenn es
 * gebraucht wird, und ein Kunde, der keinen Zugang zu seinem System gewährt,
 * hat nichts, was er schicken könnte.
 */
test('das Protokoll eines Laufs übersteht den Neustart', async () => {
  const { dataDirectory, sourceDirectory, destinationDirectory } = await workspace();
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), 'customer;amount\nA;42\n');

  const first = createPersistentApplication(dataDirectory);
  await first.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory })
  );
  const run = await first.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T03:45:00.000Z'));
  first.close();

  assert.equal(run?.filesSucceeded, 1);

  // Neustart: eine ganz neue Anwendung auf demselben Datenverzeichnis.
  const second = createPersistentApplication(dataDirectory);
  const protokoll = await second.logRepository.list({ runId: run?.id ?? '' });

  assert.ok(protokoll.length > 0, 'ohne Zeilen wäre nach dem Neustart nicht mehr zu klären, was der Lauf tat');
  assert.ok(
    protokoll.some((line) => line.filename === 'ORDER_001.csv'),
    'die Datei muss im Protokoll namentlich vorkommen'
  );
  assert.ok(protokoll[0].timestamp instanceof Date, 'gespeicherte Zeitpunkte müssen als Datum zurückkommen');
  second.close();
});

/*
 * Die Region eines Mandanten muss den Neustart überstehen.
 *
 * Sie steht in einer eigenen Spalte, und eine Spalte, die beim Schreiben
 * vergessen wird, fällt nirgends auf: Der Mandant lädt, sieht vollständig aus
 * und liest ab dem Neustart jedes Datum nach der Voreinstellung — also
 * womöglich Monat statt Tag zuerst, ohne eine einzige Meldung.
 */
test('die Region eines Mandanten übersteht den Neustart', async () => {
  const { dataDirectory } = await workspace();

  const first = createPersistentApplication(dataDirectory);
  const angelegt = await first.tenantService.create({
    name: 'Kunde USA',
    region: { locale: 'en-US', timeZone: 'America/New_York' },
  });
  first.close();

  const second = createPersistentApplication(dataDirectory);
  const wieder = await second.tenantService.getById(angelegt.id);

  assert.deepEqual(wieder?.region, { locale: 'en-US', timeZone: 'America/New_York' });

  // Und ein Mandant ohne eigene Angabe bleibt ohne — nicht mit einer erfundenen.
  const ohne = await second.tenantService.create({ name: 'Kunde ohne Angabe' });
  second.close();

  const third = createPersistentApplication(dataDirectory);
  assert.equal((await third.tenantService.getById(ohne.id))?.region, undefined);
  third.close();
});

/*
 * Die Kennung des Urhebers muss den Neustart überstehen.
 *
 * Sie steht in einer eigenen Spalte, und eine vergessene Spalte fällt hier
 * besonders spät auf: Das Protokoll sieht vollständig aus, nur die Antwort auf
 * „wer war das" fehlt — und gefragt wird sie erst, wenn es darauf ankommt.
 */
test('wer eine Änderung veranlasst hat, steht nach dem Neustart noch da', async () => {
  const { dataDirectory } = await workspace();

  const first = createPersistentApplication(dataDirectory);
  first.logger.log({
    timestamp: new Date(),
    level: 'INFO',
    userId: 'benutzer-4711',
    username: 'anna',
    message: 'PUT /api/tenants/default - geändert von anna',
  });
  first.close();

  const second = createPersistentApplication(dataDirectory);
  const [zeile] = await second.logRepository.list({});

  assert.equal(zeile.userId, 'benutzer-4711');
  assert.equal(zeile.username, 'anna');
  second.close();
});
