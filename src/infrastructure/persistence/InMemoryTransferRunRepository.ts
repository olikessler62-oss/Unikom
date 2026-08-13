import type { TransferRun } from '../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';

export class InMemoryTransferRunRepository implements TransferRunRepository {
  private readonly runs = new Map<string, TransferRun>();

  async list(): Promise<TransferRun[]> {
    return [...this.runs.values()];
  }

  async listByJob(jobId: string): Promise<TransferRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.jobId === jobId)
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  }

  async getById(id: string): Promise<TransferRun | undefined> {
    return this.runs.get(id);
  }

  async save(run: TransferRun): Promise<TransferRun> {
    this.runs.set(run.id, { ...run });
    return { ...run };
  }
}
