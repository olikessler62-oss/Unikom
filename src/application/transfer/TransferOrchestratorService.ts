import { randomUUID } from 'node:crypto';

import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { RunGate } from '../../domain/licensing/Licence.js';
import { JobSchedulerService } from '../scheduling/JobSchedulerService.js';
import type { RunProtocolWriter } from '../logging/RunProtocolWriter.js';
import type { RunControlRegistry } from './RunControlRegistry.js';
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
    private readonly scheduler: JobSchedulerService = new JobSchedulerService(),
    /**
     * Asked before anything starts. Absent means nothing to ask — the wiring
     * for tests and for an installation that checks no licence.
     */
    private readonly runGate?: RunGate,
    /**
     * Registers every run so it can be held or stopped while it is under way.
     * Absent means a run cannot be steered, which is what most tests want.
     */
    private readonly controls?: RunControlRegistry,
    /**
     * Legt das Protokoll eines Laufs als Datei ab, wenn der Workflow es
     * verlangt. Fehlt er, wird nichts abgelegt — so laufen die Tests, die von
     * Protokolldateien nichts wissen wollen.
     */
    private readonly protocols?: RunProtocolWriter
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

    // Asked once for the whole tick, before a single job is looked at. Asking
    // per job would write one failed run per job per minute into the history,
    // and the history should say what a transfer did, not that an invoice is
    // open. The due dates stay where they are, so the jobs run once the licence
    // is back rather than being silently skipped.
    try {
      await this.runGate?.assertMayRun(now);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }

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
    // Before the run is recorded, so the caller reads why nothing started
    // instead of finding a failed run without a reason.
    await this.runGate?.assertMayRun(now);

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
    // Registered before the first file, so the control room can hold or stop
    // this run from the moment it exists.
    const control = this.controls?.open(runId, job, startedAt);

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
      const outcome: TransferRunResult = await this.jobExecutionService.execute(job, { runId, now, control });

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
      this.controls?.close(runId);
    }

    await this.runRepository.save(run);
    await this.jobRepository.save({ ...this.withNextExecution(job, now), lastExecutionAt: startedAt });

    // Zuletzt, nachdem der Lauf gespeichert ist: Das Protokoll beschreibt den
    // Lauf, also muss der Lauf feststehen. Und es darf ihn nicht scheitern
    // lassen — eine volle Platte im Protokollverzeichnis wäre ein schlechter
    // Grund, eine gelungene Übertragung als Fehler zu melden.
    if (job.saveProtocol === true) {
      await this.protocols?.write(job, run).catch(() => {});
    }

    return run;
  }

  private withNextExecution(job: TransferJob, now: Date): TransferJob {
    if (!job.schedule) {
      return job;
    }

    return { ...job, nextExecutionAt: JobSchedulerService.calculateNextExecution(now, job.schedule) };
  }
}
