import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInMemoryApplication } from '../runtime/UnikomApplication.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { JobLogLevel } from '../../domain/transfer/TransferJob.js';

const ORDER = 'customer;amount\nA;42\n';

async function scenario(files: Record<string, string> = { 'ORDER_001.csv': ORDER }, logLevel?: JobLogLevel) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-history-'));
  const sourceDirectory = path.join(root, 'source');
  const destinationDirectory = path.join(root, 'incoming');
  await fs.mkdir(sourceDirectory, { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(sourceDirectory, name), content);
  }

  const application = createInMemoryApplication({
    stagingRoot: path.join(root, 'application-data'),
  });

  // Der Detailgrad steht am Workflow. Ihn an der Installation zu setzen wirkte
  // einmal, weil ein Workflow ohne eigene Angabe erbte — diese Erbschaft ist
  // gestrichen, und mit ihr die Möglichkeit, dreißig Workflows auf einmal
  // lauter zu stellen, ohne es an einem einzigen zu sehen.
  await application.jobRepository.save(
    createTransferJob({ id: 'customer-a', sourceDirectory, destinationDirectory, logLevel })
  );

  return { root, application };
}

test('a finished run appears in the history with its duration', async () => {
  const { application } = await scenario();
  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const [summary] = await application.historyService.listRuns('customer-a');

  assert.equal(summary.runId, run?.id);
  assert.equal(summary.status, TransferRunStatus.SUCCESS);
  assert.equal(summary.filesFound, 1);
  assert.equal(summary.filesSucceeded, 1);
  assert.ok(summary.durationMs !== undefined && summary.durationMs >= 0);
});

test('the history is newest first and can be limited', async () => {
  const { application } = await scenario();
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:00:00.000Z'));
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T07:00:00.000Z'));
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T08:00:00.000Z'));

  const all = await application.historyService.listRuns('customer-a');
  const latest = await application.historyService.listRuns('customer-a', 2);

  assert.equal(all.length, 3);
  assert.equal(latest.length, 2);
  assert.ok(latest[0].startedAt.getTime() >= latest[1].startedAt.getTime());
});

test('opening a run shows its files and its log', async () => {
  const { application } = await scenario();
  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const detail = await application.historyService.getRun(run?.id ?? '');

  assert.equal(detail?.jobName, 'Customer A Orders');
  assert.equal(detail?.files.length, 1);
  assert.equal(detail?.files[0].sourceFilename, 'ORDER_001.csv');
  assert.ok((detail?.logs.length ?? 0) > 0);
});

test('the run log follows the sequence from the spec', async () => {
  const { application } = await scenario();
  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:45:00.000Z'));

  const detail = await application.historyService.getRun(run?.id ?? '');
  const messages = (detail?.logs ?? []).map((entry) => entry.message);

  assert.ok(messages.some((message) => /Lauf gestartet/.test(message)));
  assert.ok(messages.some((message) => /Übertragung abgeschlossen/.test(message)));
  assert.ok(messages.some((message) => /Prüfung bestanden/.test(message)));
  assert.ok(messages.some((message) => /Datei erfolgreich abgelegt/.test(message)));
  assert.ok(messages.some((message) => /STEP_1_COMPLETED/.test(message)));
});

test('voreingestellt steht jeder Schritt im Protokoll, und wer will, stellt leiser', async () => {
  /*
   * Voreingestellt ist jeder Schritt, und die Zwischenstufe „Das Wesentliche"
   * gibt es nicht mehr: Was an der Nacht, in der etwas schieflief, das
   * Wesentliche war, entscheidet sich erst hinterher. Die Frage, die dann
   * zählt, ist „warum hat er die Datei nicht genommen" — und die beantwortet
   * nur eine Zeile, die auch geschrieben wurde.
   */
  const laut = await scenario({ 'ORDER_001.csv': ORDER, 'INVOICE_001.csv': 'ignored\n' });
  const lauterLauf = await laut.application.runtime.orchestrator.runJobNow('customer-a', new Date());
  const lauteZeilen = await laut.application.logRepository.list({ runId: lauterLauf?.id });

  assert.ok(
    lauteZeilen.some((entry) => entry.level === 'DEBUG' && /wird nicht genommen/.test(entry.message)),
    'ohne eigene Angabe muss im Protokoll stehen, warum eine Datei abgelehnt wurde'
  );

  // Der Workflow, der jede Minute läuft, darf trotzdem leise sein.
  const leise = await scenario({ 'ORDER_001.csv': ORDER, 'INVOICE_001.csv': 'ignored\n' }, 'WARNING');
  const leiserLauf = await leise.application.runtime.orchestrator.runJobNow('customer-a', new Date());
  const leiseZeilen = await leise.application.logRepository.list({ runId: leiserLauf?.id });

  assert.equal(
    leiseZeilen.some((entry) => entry.level === 'DEBUG' || entry.level === 'INFO'),
    false
  );
});

test('a failed file is logged as an error and listed as a failure', async () => {
  const { application } = await scenario();

  const job = await application.jobRepository.getById('customer-a');
  await application.jobRepository.save({
    ...job!,
    encryptionConfig: { enabled: true, provider: 'AES_256_GCM', keyCredentialId: 'missing' },
  });

  const run = await application.runtime.orchestrator.runJobNow('customer-a', new Date());
  const detail = await application.historyService.getRun(run?.id ?? '');

  assert.ok(detail?.logs.some((entry) => entry.level === 'ERROR'));
  assert.equal((await application.historyService.listFailures('customer-a')).length, 1);
});

test('the dashboard figures summarise the day', async () => {
  const { application } = await scenario();
  const now = new Date();

  await application.runtime.orchestrator.runJobNow('customer-a', now);
  const statistics = await application.historyService.statistics(now);

  assert.equal(statistics.activeJobs, 1);
  assert.equal(statistics.runsToday, 1);
  assert.equal(statistics.filesTransferredToday, 1);
  assert.equal(statistics.filesFailedToday, 0);
  assert.deepEqual(statistics.runningJobs, []);
});

test('scheduled jobs appear in the dashboard ordered by their next run', async () => {
  const { application } = await scenario();
  await application.jobRepository.save(
    createTransferJob({
      id: 'later',
      schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'UTC', missedRunPolicy: 'SKIP' },
      nextExecutionAt: new Date('2026-08-13T09:00:00.000Z'),
    })
  );
  await application.jobRepository.save(
    createTransferJob({
      id: 'sooner',
      schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'UTC', missedRunPolicy: 'SKIP' },
      nextExecutionAt: new Date('2026-08-13T07:00:00.000Z'),
    })
  );

  const statistics = await application.historyService.statistics(new Date('2026-08-13T06:45:00.000Z'));

  assert.deepEqual(
    statistics.nextExecutions.map((entry) => entry.jobId),
    ['sooner', 'later']
  );
});

test('das Protokoll eines Laufs bleibt liegen und lässt sich nach Alter aufräumen', async () => {
  // Es wird aufbewahrt und nicht verdrängt: Wer am Morgen wissen will, was um
  // drei Uhr geschah, findet es noch vor. Fort ist es erst, wenn seine Frist
  // abgelaufen ist — und dann wirklich.
  const { application } = await scenario();
  await application.runtime.orchestrator.runJobNow('customer-a', new Date());

  const before = (await application.logRepository.list({})).length;
  assert.ok(before > 0);

  assert.equal((await application.logRepository.list({})).length, before, 'nichts wird von selbst verdrängt');
  assert.equal(await application.historyService.pruneLogs(new Date(Date.now() + 60_000)), before);
  assert.equal((await application.logRepository.list({})).length, 0);
});

test('the history without a single job picked spans them all, newest first', async () => {
  const { application, root } = await scenario();
  const second = path.join(root, 'source-b');
  await fs.mkdir(second, { recursive: true });
  await fs.writeFile(path.join(second, 'ORDER_009.csv'), ORDER);

  await application.jobRepository.save(
    createTransferJob({
      id: 'customer-b',
      tenantId: 'tenant-b',
      sourceDirectory: second,
      destinationDirectory: path.join(root, 'incoming-b'),
    })
  );

  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:00:00.000Z'));
  await application.runtime.orchestrator.runJobNow('customer-b', new Date('2026-08-13T07:00:00.000Z'));
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T08:00:00.000Z'));

  const all = await application.historyService.listRecentRuns();

  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((run) => run.jobId),
    ['customer-a', 'customer-b', 'customer-a']
  );
  assert.ok(all[0].startedAt.getTime() >= all[1].startedAt.getTime());
});

test('the history of all jobs can be narrowed to one tenant and limited', async () => {
  const { application, root } = await scenario();
  const second = path.join(root, 'source-b');
  await fs.mkdir(second, { recursive: true });
  await fs.writeFile(path.join(second, 'ORDER_009.csv'), ORDER);

  await application.jobRepository.save(
    createTransferJob({
      id: 'customer-b',
      tenantId: 'tenant-b',
      sourceDirectory: second,
      destinationDirectory: path.join(root, 'incoming-b'),
    })
  );

  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T06:00:00.000Z'));
  await application.runtime.orchestrator.runJobNow('customer-b', new Date('2026-08-13T07:00:00.000Z'));
  await application.runtime.orchestrator.runJobNow('customer-a', new Date('2026-08-13T08:00:00.000Z'));

  const forB = await application.historyService.listRecentRuns({ tenantId: 'tenant-b' });
  const newest = await application.historyService.listRecentRuns({ limit: 1 });

  assert.deepEqual(
    forB.map((run) => run.jobId),
    ['customer-b']
  );
  assert.equal(newest.length, 1);
  assert.equal(newest[0].jobId, 'customer-a');
});
