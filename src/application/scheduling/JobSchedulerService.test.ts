import test from 'node:test';
import assert from 'node:assert/strict';
import { JobSchedulerService } from './JobSchedulerService.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { JobSchedule } from '../../domain/transfer/TransferJob.js';

const scheduler = new JobSchedulerService();

function schedule(overrides: Partial<JobSchedule> = {}): JobSchedule {
  return {
    type: 'DAILY',
    timezone: 'Europe/Berlin',
    missedRunPolicy: 'SKIP',
    ...overrides,
  } as JobSchedule;
}

test('an interval schedule adds the configured minutes', () => {
  const now = new Date('2026-08-13T06:00:00.000Z');
  const next = JobSchedulerService.calculateNextExecution(now, schedule({ type: 'INTERVAL', intervalMinutes: 15 }));

  assert.equal(next.toISOString(), '2026-08-13T06:15:00.000Z');
});

test('an hourly schedule runs at the next full hour', () => {
  const now = new Date('2026-08-13T05:23:45.000Z');
  const next = JobSchedulerService.calculateNextExecution(now, schedule({ type: 'HOURLY' }));

  assert.equal(next.toISOString(), '2026-08-13T06:00:00.000Z');
});

test('a daily schedule respects the configured timezone', () => {
  const now = new Date('2026-08-13T05:00:00+02:00');
  const next = JobSchedulerService.calculateNextExecution(now, schedule({ type: 'DAILY', executionTime: '06:30' }));

  // 06:30 in Berlin is 04:30 UTC during summer time.
  assert.equal(next.toISOString(), '2026-08-13T04:30:00.000Z');
});

test('a daily schedule moves to the next day once the time has passed', () => {
  const now = new Date('2026-08-13T10:00:00+02:00');
  const next = JobSchedulerService.calculateNextExecution(now, schedule({ type: 'DAILY', executionTime: '06:30' }));

  assert.equal(next.toISOString(), '2026-08-14T04:30:00.000Z');
});

test('a weekly schedule picks the next configured weekday', () => {
  // 2026-08-13 is a Thursday; 06:00 Berlin has already passed.
  const now = new Date('2026-08-13T08:00:00.000Z');
  const next = JobSchedulerService.calculateNextExecution(
    now,
    schedule({ type: 'WEEKLY', executionTime: '06:00', weekdays: [1, 2, 3, 4, 5] })
  );

  assert.equal(next.toISOString(), '2026-08-14T04:00:00.000Z');
});

test('a weekly schedule skips over the weekend', () => {
  // Friday after the execution time, so the next run is on Monday.
  const now = new Date('2026-08-14T08:00:00.000Z');
  const next = JobSchedulerService.calculateNextExecution(
    now,
    schedule({ type: 'WEEKLY', executionTime: '06:00', weekdays: [1, 2, 3, 4, 5] })
  );

  assert.equal(next.toISOString(), '2026-08-17T04:00:00.000Z');
});

test('an incomplete schedule is rejected instead of guessed', () => {
  const now = new Date('2026-08-13T06:00:00.000Z');

  assert.throws(() => JobSchedulerService.calculateNextExecution(now, schedule({ type: 'WEEKLY', weekdays: [] })));
  assert.throws(() =>
    JobSchedulerService.calculateNextExecution(now, schedule({ type: 'INTERVAL', intervalMinutes: 0 }))
  );
  assert.throws(() =>
    JobSchedulerService.calculateNextExecution(now, schedule({ type: 'CRON', cronExpression: '*/5 * * * *' })),
    /not supported yet/
  );
});

test('a job is due once its next execution has been reached', () => {
  const now = new Date('2026-08-13T06:00:00.000Z');
  const job = createTransferJob({
    schedule: schedule({ type: 'INTERVAL', intervalMinutes: 15 }),
    nextExecutionAt: new Date('2026-08-13T06:00:00.000Z'),
  });

  assert.equal(scheduler.isDue(job, now), true);
  assert.equal(scheduler.isDue({ ...job, nextExecutionAt: new Date('2026-08-13T06:15:00.000Z') }, now), false);
});

test('disabled and manual-only jobs are never started by the scheduler', () => {
  const now = new Date('2026-08-13T06:00:00.000Z');
  const base = createTransferJob({
    schedule: schedule({ type: 'INTERVAL', intervalMinutes: 15 }),
    nextExecutionAt: new Date('2026-08-13T05:00:00.000Z'),
  });

  assert.equal(scheduler.isDue({ ...base, enabled: false }, now), false);
  assert.equal(scheduler.isDue({ ...base, executionMode: 'MANUAL' }, now), false);
  assert.equal(scheduler.isDue({ ...base, schedule: undefined }, now), false);
});

test('a restart computes the next execution instead of replaying missed runs', () => {
  const now = new Date('2026-08-13T06:07:00.000Z');
  const job = createTransferJob({
    schedule: schedule({ type: 'INTERVAL', intervalMinutes: 15 }),
    // The application was down; the last planned run was hours ago.
    lastExecutionAt: new Date('2026-08-13T02:00:00.000Z'),
  });

  const restored = JobSchedulerService.ensureNextExecution(job, now);

  assert.equal(restored.nextExecutionAt?.toISOString(), '2026-08-13T06:22:00.000Z');
  assert.equal(scheduler.isDue(restored, now), false);
});

test('an existing next execution is not overwritten', () => {
  const now = new Date('2026-08-13T06:00:00.000Z');
  const nextExecutionAt = new Date('2026-08-13T06:15:00.000Z');
  const job = createTransferJob({ schedule: schedule({ type: 'INTERVAL', intervalMinutes: 15 }), nextExecutionAt });

  assert.equal(JobSchedulerService.ensureNextExecution(job, now).nextExecutionAt, nextExecutionAt);
});
