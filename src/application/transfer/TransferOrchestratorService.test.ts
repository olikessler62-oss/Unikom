import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferOrchestratorService, type JobExecutor } from './TransferOrchestratorService.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { InMemoryTransferRunRepository } from '../../infrastructure/persistence/InMemoryTransferRunRepository.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferRunResult } from './TransferExecutionService.js';

const NOW = new Date('2026-08-13T06:15:00.000Z');

function successResult(job: TransferJob, overrides: Partial<TransferRunResult> = {}): TransferRunResult {
  return {
    runId: 'TR-inner',
    jobId: job.id,
    status: TransferRunStatus.SUCCESS,
    filesFound: 5,
    filesSelected: 3,
    filesSucceeded: 3,
    filesSkipped: 0,
    filesFailed: 0,
    outcomes: [],
    message: 'ok',
    ...overrides,
  };
}

function dueJob(overrides: Partial<TransferJob> = {}): TransferJob {
  return createTransferJob({
    schedule: { type: 'INTERVAL', intervalMinutes: 15, timezone: 'Europe/Berlin', missedRunPolicy: 'SKIP' },
    nextExecutionAt: new Date('2026-08-13T06:00:00.000Z'),
    executionMode: 'AUTOMATIC',
    ...overrides,
  });
}

async function harness(executor: JobExecutor, ...jobs: TransferJob[]) {
  const jobRepository = new InMemoryTransferJobRepository();
  const runRepository = new InMemoryTransferRunRepository();

  for (const job of jobs) {
    await jobRepository.save(job);
  }

  return {
    jobRepository,
    runRepository,
    orchestrator: new TransferOrchestratorService(jobRepository, executor, runRepository),
  };
}

test('a due job is started and its run is recorded', async () => {
  const { orchestrator, runRepository } = await harness({ async execute(job) { return successResult(job); } }, dueJob());

  const tick = await orchestrator.runDueJobs(NOW);

  assert.equal(tick.started, 1);
  const [run] = await runRepository.list();
  assert.equal(run.status, TransferRunStatus.SUCCESS);
  assert.equal(run.filesFound, 5);
  assert.equal(run.filesSucceeded, 3);
});

test('a job that is not due yet is left alone', async () => {
  const job = dueJob({ nextExecutionAt: new Date('2026-08-13T07:00:00.000Z') });
  const { orchestrator, runRepository } = await harness({ async execute(j) { return successResult(j); } }, job);

  const tick = await orchestrator.runDueJobs(NOW);

  assert.equal(tick.started, 0);
  assert.equal(tick.notDue, 1);
  assert.equal((await runRepository.list()).length, 0);
});

test('a disabled job is never started', async () => {
  const { orchestrator } = await harness(
    { async execute(job) { return successResult(job); } },
    dueJob({ enabled: false })
  );

  assert.equal((await orchestrator.runDueJobs(NOW)).started, 0);
});

test('the next execution is advanced after a run', async () => {
  const { orchestrator, jobRepository } = await harness(
    { async execute(job) { return successResult(job); } },
    dueJob()
  );

  await orchestrator.runDueJobs(NOW);
  const stored = await jobRepository.getById('job-customer-a');

  assert.equal(stored?.nextExecutionAt?.toISOString(), '2026-08-13T06:30:00.000Z');
  assert.ok(stored?.lastExecutionAt);
});

test('the same job does not run twice in parallel', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { orchestrator } = await harness(
    {
      async execute(job) {
        await gate;
        return successResult(job);
      },
    },
    dueJob()
  );

  const firstTick = orchestrator.runDueJobs(NOW);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const secondTick = await orchestrator.runDueJobs(NOW);
  assert.equal(secondTick.started, 0);
  assert.equal(secondTick.skippedBecauseRunning, 1);
  assert.match(secondTick.errors[0], /still running/);

  release();
  assert.equal((await firstTick).started, 1);
  assert.equal(orchestrator.isRunning('job-customer-a'), false);
});

test('a failing execution is recorded as a failed run', async () => {
  const { orchestrator, runRepository } = await harness(
    {
      async execute() {
        throw new Error('Connection reset');
      },
    },
    dueJob()
  );

  const tick = await orchestrator.runDueJobs(NOW);
  const [run] = await runRepository.list();

  assert.equal(tick.started, 1);
  assert.equal(run.status, TransferRunStatus.FAILED);
  assert.ok(run.completedAt);
});

test('a manual run uses the same pipeline and is recorded too', async () => {
  const { orchestrator, runRepository } = await harness(
    { async execute(job) { return successResult(job); } },
    createTransferJob({ executionMode: 'MANUAL' })
  );

  const run = await orchestrator.runJobNow('job-customer-a', NOW);

  assert.equal(run?.status, TransferRunStatus.SUCCESS);
  assert.equal((await runRepository.list()).length, 1);
});

test('a manual run for an unknown job yields nothing', async () => {
  const { orchestrator } = await harness({ async execute(job) { return successResult(job); } });

  assert.equal(await orchestrator.runJobNow('does-not-exist', NOW), undefined);
});
