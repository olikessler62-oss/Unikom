import type { LogEntry, LogLevel, TransferLogRepository } from '../../domain/logging/LogEntry.js';
import type { TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';
import { FileTransferStatus, TransferRunStatus, type TransferRun } from '../../domain/transfer/TransferRun.js';

/** One row of the per-job history table from spec section 69. */
export interface RunSummary {
  runId: string;
  jobId: string;
  status: TransferRunStatus;
  startedAt: Date;
  completedAt?: Date;
  /** Undefined while the run is still going. */
  durationMs?: number;
  filesFound: number;
  filesProcessed: number;
  filesSucceeded: number;
  filesSkipped: number;
  filesFailed: number;
}

/** What opening a run shows (spec section 70). */
export interface RunDetail extends RunSummary {
  jobName?: string;
  files: TransferFile[];
  logs: LogEntry[];
}

/** Dashboard figures from spec section 94. */
export interface DashboardStatistics {
  activeJobs: number;
  runsToday: number;
  filesTransferredToday: number;
  filesFailedToday: number;
  runningJobs: string[];
  nextExecutions: { jobId: string; jobName: string; nextExecutionAt: Date }[];
}

function durationOf(run: TransferRun): number | undefined {
  return run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : undefined;
}

function toSummary(run: TransferRun): RunSummary {
  return {
    runId: run.id,
    jobId: run.jobId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: durationOf(run),
    filesFound: run.filesFound,
    filesProcessed: run.filesProcessed,
    filesSucceeded: run.filesSucceeded,
    filesSkipped: run.filesSkipped,
    filesFailed: run.filesFailed,
  };
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Read side of the transfer history (spec sections 69-70) and the figures the
 * dashboard needs (section 94). It only queries; nothing here changes state.
 */
export class TransferHistoryService {
  constructor(
    private readonly runRepository: TransferRunRepository,
    private readonly transferFileRepository: TransferFileRepository,
    private readonly logRepository: TransferLogRepository,
    private readonly jobRepository: TransferJobRepository
  ) {}

  async listRuns(jobId: string, limit?: number): Promise<RunSummary[]> {
    const runs = (await this.runRepository.listByJob(jobId)).map(toSummary);
    return limit === undefined ? runs : runs.slice(0, Math.max(0, limit));
  }

  /**
   * Runs across all jobs, newest first — the history without a single job
   * picked. Optionally narrowed to one tenant, which has to happen here and not
   * in the browser: filtering a page of the newest runs afterwards would show
   * nothing for a tenant whose runs are older than that page.
   *
   * The limit is not optional the way it is for a single job. This list grows
   * with every job times every run, and a history view needs the newest ones,
   * not all of them.
   */
  async listRecentRuns(options: { tenantId?: string; limit?: number } = {}): Promise<RunSummary[]> {
    const limit = Math.max(0, options.limit ?? 200);
    let runs = await this.runRepository.list();

    if (options.tenantId) {
      const jobs = await this.jobRepository.list();
      const wanted = new Set(
        jobs.filter((job) => job.tenantId === options.tenantId).map((job) => job.id)
      );

      runs = runs.filter((run) => wanted.has(run.jobId));
    }

    // Sorted here rather than trusted from the store: SQLite orders by
    // started_at, the in-memory one does not, and the order is a promise this
    // method makes.
    return [...runs]
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
      .slice(0, limit)
      .map(toSummary);
  }

  async getRun(runId: string, minimumLevel: LogLevel = 'INFO'): Promise<RunDetail | undefined> {
    const run = await this.runRepository.getById(runId);
    if (!run) {
      return undefined;
    }

    const [files, logs, job] = await Promise.all([
      this.transferFileRepository.listByRun(runId),
      this.logRepository.list({ runId, minimumLevel }),
      this.jobRepository.getById(run.jobId),
    ]);

    return { ...toSummary(run), jobName: job?.name, files, logs };
  }

  async statistics(now: Date = new Date()): Promise<DashboardStatistics> {
    const jobs = await this.jobRepository.list();
    const since = startOfDay(now);

    const runsToday: TransferRun[] = [];
    for (const job of jobs) {
      const runs = await this.runRepository.listByJob(job.id);
      runsToday.push(...runs.filter((run) => run.startedAt.getTime() >= since.getTime()));
    }

    return {
      activeJobs: jobs.filter((job) => job.enabled).length,
      runsToday: runsToday.length,
      filesTransferredToday: runsToday.reduce((total, run) => total + run.filesSucceeded, 0),
      filesFailedToday: runsToday.reduce((total, run) => total + run.filesFailed, 0),
      runningJobs: runsToday.filter((run) => run.status === TransferRunStatus.RUNNING).map((run) => run.jobId),
      nextExecutions: jobs
        .filter((job) => job.enabled && job.nextExecutionAt)
        .map((job) => ({ jobId: job.id, jobName: job.name, nextExecutionAt: job.nextExecutionAt! }))
        .sort((left, right) => left.nextExecutionAt.getTime() - right.nextExecutionAt.getTime()),
    };
  }

  /** Files of a job that never made it, for the "what went wrong" view. */
  async listFailures(jobId: string): Promise<TransferFile[]> {
    return (await this.transferFileRepository.listByJob(jobId)).filter(
      (file) => file.status === FileTransferStatus.FAILED
    );
  }

  /** Retention; log volume grows with every scheduler run. */
  async pruneLogs(olderThan: Date): Promise<number> {
    return this.logRepository.deleteOlderThan(olderThan);
  }
}
