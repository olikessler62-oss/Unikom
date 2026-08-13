import { randomUUID } from 'node:crypto';

import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { JobSchedulerService } from '../scheduling/JobSchedulerService.js';
import type { TransferExecutionOptions, TransferRunResult } from './TransferExecutionService.js';

/** Anything that can run a job through the shared pipeline. */
export interface JobExecutor {
  execute(job: TransferJob, options?: TransferExecutionOptions): Promise<TransferRunResult>;
}

export interface SchedulerTickResult {
  started: number;
  skippedBecauseRunning: number;
  notDue: number;
  runs: TransferRun[];
  errors: string[];
}

/**
 * Drives the scheduled side of the application: it decides which jobs are due,
 * prevents a job from running twice at the same time and records every run.
 * The transfer itself always goes through the shared pipeline.
 */
export class TransferOrchestratorService {
  private readonly runningJobIds = new Set<string>();

  constructor(
    private readonly jobRepository: TransferJobRepository,
    private readonly jobExecutionService: JobExecutor,
    private readonly runRepository: TransferRunRepository,
    private readonly scheduler: JobSchedulerService = new JobSchedulerService()
  ) {}

  /** True while a run for this job is in flight (spec section 29). */
  isRunning(jobId: string): boolean {
    return this.runningJobIds.has(jobId);
  }

  async runDueJobs(now: Date): Promise<SchedulerTickResult> {
    const result: SchedulerTickResult = {
      started: 0,
      skippedBecauseRunning: 0,
      notDue: 0,
      runs: [],
      errors: [],
    };

    for (const stored of await this.jobRepository.list()) {
      // A job that has no next execution yet gets one instead of being replayed.
      const job = JobSchedulerService.ensureNextExecution(stored, now);
      if (job !== stored) {
        await this.jobRepository.save(job);
      }

      if (!this.scheduler.isDue(job, now)) {
        result.notDue += 1;
        continue;
      }

      if (this.runningJobIds.has(job.id)) {
        result.skippedBecauseRunning += 1;
        result.errors.push(
          `Scheduled execution skipped because previous execution is still running (job ${job.name})`
        );
        // The schedule still moves on, otherwise the job would fire again immediately.
        await this.jobRepository.save(this.withNextExecution(job, now));
        continue;
      }

      result.started += 1;
      const run = await this.runJob(job, now);
      result.runs.push(run);

      if (run.status === TransferRunStatus.FAILED) {
        result.errors.push(`Job ${job.name} failed`);
      }
    }

    return result;
  }

  /** Manual start from UI, CLI or API; uses the very same pipeline. */
  async runJobNow(jobId: string, now: Date = new Date()): Promise<TransferRun | undefined> {
    const job = await this.jobRepository.getById(jobId);
    if (!job) {
      return undefined;
    }

    if (this.runningJobIds.has(job.id)) {
      throw new Error(`Job ${job.name} is already running`);
    }

    return this.runJob(job, now);
  }

  private async runJob(job: TransferJob, now: Date): Promise<TransferRun> {
    const runId = `TR-${randomUUID()}`;
    const startedAt = new Date();

    this.runningJobIds.add(job.id);

    let run: TransferRun = {
      id: runId,
      jobId: job.id,
      status: TransferRunStatus.RUNNING,
      startedAt,
      filesFound: 0,
      filesProcessed: 0,
      filesSucceeded: 0,
      filesSkipped: 0,
      filesFailed: 0,
    };
    await this.runRepository.save(run);

    try {
      const outcome: TransferRunResult = await this.jobExecutionService.execute(job, { runId, now });

      run = {
        ...run,
        status: outcome.status,
        completedAt: new Date(),
        filesFound: outcome.filesFound,
        filesProcessed: outcome.filesSelected,
        filesSucceeded: outcome.filesSucceeded,
        filesSkipped: outcome.filesSkipped,
        filesFailed: outcome.filesFailed,
      };
    } catch (error) {
      run = {
        ...run,
        status: TransferRunStatus.FAILED,
        completedAt: new Date(),
        filesFailed: 1,
      };
      void error;
    } finally {
      this.runningJobIds.delete(job.id);
    }

    await this.runRepository.save(run);
    await this.jobRepository.save({ ...this.withNextExecution(job, now), lastExecutionAt: startedAt });

    return run;
  }

  private withNextExecution(job: TransferJob, now: Date): TransferJob {
    if (!job.schedule) {
      return job;
    }

    return { ...job, nextExecutionAt: JobSchedulerService.calculateNextExecution(now, job.schedule) };
  }
}
