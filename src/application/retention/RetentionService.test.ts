import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createInMemoryApplication, type UnikomApplication } from '../runtime/UnikomApplication.js';
import { DEFAULT_LOG_RETENTION_DAYS, RetentionService } from './RetentionService.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferLogStore } from '../../infrastructure/persistence/InMemoryTransferLogStore.js';
import type { LogEntry } from '../../domain/logging/LogEntry.js';
import type { RetentionConfig } from '../../domain/transfer/TransferJob.js';

const ORDER = 'customer;amount\nA;42\n';
const DAY = 24 * 60 * 60 * 1000;

async function scenario(retention?: RetentionConfig) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-retention-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'ORDER_001.csv'), ORDER);

  const application = createInMemoryApplication({ stagingRoot: path.join(root, 'application-data') });

  await application.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory, retention })
  );

  return { application, root, sourceDirectory, destinationDirectory };
}

/** Ages what is stored, since the run itself always happens now. */
async function ageEverything(application: UnikomApplication, jobId: string, days: number): Promise<void> {
  for (const file of await application.transferFileRepository.listByJob(jobId)) {
    await application.transferFileRepository.save({
      ...file,
      startedAt: new Date(file.startedAt.getTime() - days * DAY),
    });
  }
}

/*
 * Der Aufbewahrungsdienst für sich, an einer Ablage, die sich wie die
 * Datenbank verhält: Sie behält, was hineingeschrieben wird, und löscht nach
 * Alter. Genau darauf beruht die Zusage, dass ein Protokoll nicht ewig liegt.
 */
async function retentionOver(store: InMemoryTransferLogStore, retention?: RetentionConfig) {
  const jobs = new InMemoryTransferJobRepository();
  await jobs.save(createTransferJob({ id: 'customer-a', retention }));

  return new RetentionService(jobs, store, new InMemoryTransferFileRepository());
}

function entry(jobId: string, age: number): LogEntry {
  return {
    timestamp: new Date(Date.now() - age * DAY),
    level: 'INFO',
    message: `Zeile von vor ${age} Tagen`,
    jobId,
  };
}

test('the log is pruned after ninety days by default', async () => {
  const store = new InMemoryTransferLogStore();
  store.log(entry('customer-a', DEFAULT_LOG_RETENTION_DAYS + 1));
  store.log(entry('customer-a', 1));

  const [outcome] = await (await retentionOver(store)).apply(new Date());

  assert.equal(outcome.logEntriesDeleted, 1);
  assert.equal((await store.list({ jobId: 'customer-a' })).length, 1);
});

test('a shorter period configured on the job wins', async () => {
  const store = new InMemoryTransferLogStore();
  store.log(entry('customer-a', 8));

  await (await retentionOver(store, { logDays: 7 })).apply(new Date());

  assert.equal((await store.list({ jobId: 'customer-a' })).length, 0);
});

test('das Protokoll eines Laufs wird nach seiner Frist wirklich aufgeräumt', async () => {
  // Am ganzen Bauwerk und nicht nur am Dienst: Ein Lauf schreibt sein
  // Protokoll, die Frist läuft ab, und danach ist es fort. Ohne diese Prüfung
  // könnte die Ablage alles behalten, ohne dass irgendwo etwas auffiele — die
  // Zusage „neunzig Tage" wäre dann in Wahrheit „für immer".
  const { application } = await scenario({ logDays: 1 });
  await application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const before = (await application.logRepository.list({ jobId: 'customer-a' })).length;
  assert.ok(before > 0);

  const [outcome] = await application.retentionService.apply(new Date(Date.now() + 400 * DAY));

  assert.equal(outcome.logEntriesDeleted, before);
  assert.equal((await application.logRepository.list({ jobId: 'customer-a' })).length, 0);
});

test('retention stops at the job it belongs to', async () => {
  // Zwei Workflows, zwei Aufbewahrungszeiten: Was für den einen gilt, darf den
  // anderen nicht treffen.
  const store = new InMemoryTransferLogStore();
  store.log(entry('customer-a', 8));
  store.log(entry('customer-b', 8));

  const jobs = new InMemoryTransferJobRepository();
  await jobs.save(createTransferJob({ id: 'customer-a', retention: { logDays: 7 } }));
  await jobs.save(createTransferJob({ id: 'customer-b', retention: { logDays: 3650 } }));

  await new RetentionService(jobs, store, new InMemoryTransferFileRepository()).apply(new Date());

  assert.equal((await store.list({ jobId: 'customer-a' })).length, 0);
  assert.equal((await store.list({ jobId: 'customer-b' })).length, 1);
});

test('the file history is kept indefinitely unless a period is configured', async () => {
  const { application } = await scenario();
  await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  await ageEverything(application, 'customer-a', 4000);

  const [outcome] = await application.retentionService.apply(new Date());

  assert.equal(outcome.fileRecordsDeleted, 0);
  assert.equal((await application.transferFileRepository.listByJob('customer-a')).length, 1);
});

test('a configured history period deletes the records', async () => {
  const { application } = await scenario({ historyDays: 30 });
  await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  await ageEverything(application, 'customer-a', 31);

  const [outcome] = await application.retentionService.apply(new Date());

  assert.equal(outcome.fileRecordsDeleted, 1);
  assert.equal((await application.transferFileRepository.listByJob('customer-a')).length, 0);
});

test('deleting the history makes a kept source file be fetched again', async () => {
  // The consequence the setting has to be honest about: the history is the
  // duplicate registry, so pruning it forgets what was already taken over.
  const { application, destinationDirectory } = await scenario({ historyDays: 30 });

  await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  assert.deepEqual(await fs.readdir(destinationDirectory), ['ORDER_001.csv']);

  // While the history knows the file, a second run does not even fetch it.
  const second = await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  assert.equal(second?.filesSkipped, 1);

  await ageEverything(application, 'customer-a', 31);
  await application.retentionService.apply(new Date());

  // Now it is unknown again and gets downloaded and hashed a second time. Here
  // the conflict strategy catches it: SKIP sees the file already sitting in the
  // destination, so the cost is wasted transfer, not a duplicate.
  const third = await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  assert.equal(third?.filesSkipped, 1);
  assert.deepEqual(await fs.readdir(destinationDirectory), ['ORDER_001.csv']);
});

test('with RENAME the forgotten file really does land a second time', async () => {
  // This is where pruning the history costs more than a transfer: nothing is
  // left that recognises the file, and RENAME has no reason to refuse it.
  const { application, destinationDirectory } = await scenario({ historyDays: 30 });
  const job = await application.jobRepository.getById('customer-a');
  await application.jobRepository.save({ ...job!, conflictStrategy: 'RENAME' });

  await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  await ageEverything(application, 'customer-a', 31);
  await application.retentionService.apply(new Date());
  await application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const stored = await fs.readdir(destinationDirectory);
  assert.equal(stored.length, 2, `the same content now lies in the destination twice: ${stored.join(', ')}`);
});

test('the scheduler applies retention once a day, not on every tick', async () => {
  const { application } = await scenario({ logDays: 7 });
  await application.runtime.orchestrator.runJobNow('customer-a', new Date());

  let applied = 0;
  const service = application.retentionService;
  const original = service.apply.bind(service);
  service.apply = async (now?: Date) => {
    applied += 1;
    return original(now);
  };

  const day = new Date('2026-11-20T08:00:00.000Z');
  await application.runtime.runOnce(day);
  await application.runtime.runOnce(new Date('2026-11-20T08:01:00.000Z'));
  await application.runtime.runOnce(new Date('2026-11-20T23:59:00.000Z'));
  assert.equal(applied, 1, 'three ticks on one day are one retention run');

  await application.runtime.runOnce(new Date('2026-11-21T00:01:00.000Z'));
  assert.equal(applied, 2, 'the next day runs it again');
});

test('a failing retention does not stop the scheduler', async () => {
  const { application } = await scenario();
  application.retentionService.apply = async () => {
    throw new Error('database is locked');
  };

  const result = await application.runtime.runOnce(new Date('2026-11-22T08:00:00.000Z'));

  assert.ok(result, 'the tick has to complete regardless');
});
