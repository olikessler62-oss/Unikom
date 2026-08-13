import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { JobSchedulerService } from '../scheduling/JobSchedulerService.js';

/**
 * Startup sequence from spec section 31: load the active jobs, rebuild their
 * schedules and compute the next execution. Runs that were missed while the
 * application was down are deliberately not replayed (section 30).
 */
export class RuntimeBootstrapService {
  constructor(private readonly jobRepository: TransferJobRepository) {}

  async reconstructSchedules(now: Date): Promise<TransferJob[]> {
    const restored: TransferJob[] = [];

    for (const job of await this.jobRepository.list()) {
      if (!job.enabled || !job.schedule || job.executionMode === 'MANUAL') {
        continue;
      }

      const updated: TransferJob = {
        ...job,
        nextExecutionAt: JobSchedulerService.calculateNextExecution(now, job.schedule),
      };

      await this.jobRepository.save(updated);
      restored.push(updated);
    }

    return restored;
  }
}
