import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { RunControl, RunControlState } from '../../domain/transfer/RunControl.js';

/** A run that is in flight — what the control room shows. */
export interface ActiveRun {
  runId: string;
  jobId: string;
  jobName: string;
  tenantId: string;
  startedAt: Date;
  state: RunControlState;
}

/**
 * The control of exactly one run.
 *
 * It lives in memory rather than in the database, because it applies to a run
 * inside this one process. If the process dies the run is over anyway, and a
 * stored "paused" would wait after a restart for a transfer that no longer
 * exists.
 */
export class RunController implements RunControl {
  private current: RunControlState = 'RUNNING';
  /** Whoever is waiting for the run to be resumed. */
  private waiting: (() => void)[] = [];

  state(): RunControlState {
    return this.current;
  }

  pause(): void {
    if (this.current === 'RUNNING') {
      this.current = 'PAUSED';
    }
  }

  resume(): void {
    if (this.current === 'PAUSED') {
      this.current = 'RUNNING';
      this.wake();
    }
  }

  /** Final: a cancelled run cannot be resumed. */
  cancel(): void {
    this.current = 'CANCELLED';
    // The waiters have to be woken too, or a paused run would hang forever on
    // the very cancellation that was meant to end it.
    this.wake();
  }

  async beforeFile(): Promise<boolean> {
    while (this.current === 'PAUSED') {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    return this.current !== 'CANCELLED';
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = [];

    for (const resume of waiting) {
      resume();
    }
  }
}

/**
 * Which runs are in flight and how they can be steered.
 *
 * The registry is also the answer to "what is running right now": it keeps that
 * book anyway, and a second list beside it would drift apart eventually.
 */
export class RunControlRegistry {
  private readonly running = new Map<string, { controller: RunController; run: ActiveRun }>();

  open(runId: string, job: TransferJob, startedAt: Date): RunController {
    const controller = new RunController();

    this.running.set(runId, {
      controller,
      run: {
        runId,
        jobId: job.id,
        jobName: job.name,
        tenantId: job.tenantId,
        startedAt,
        state: 'RUNNING',
      },
    });

    return controller;
  }

  get(runId: string): RunController | undefined {
    return this.running.get(runId)?.controller;
  }

  close(runId: string): void {
    this.running.delete(runId);
  }

  /** Newest first: what just started is what somebody is looking for. */
  active(): ActiveRun[] {
    return [...this.running.values()]
      .map(({ controller, run }) => ({ ...run, state: controller.state() }))
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  }
}
