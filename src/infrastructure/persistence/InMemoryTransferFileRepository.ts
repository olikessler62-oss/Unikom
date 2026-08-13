import type { ProcessedFileIdentity, TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import { isResolved, isSuccessful, matchesIdentity } from '../../domain/transfer/TransferFileMatching.js';

export class InMemoryTransferFileRepository implements TransferFileRepository {
  private readonly files = new Map<string, TransferFile>();

  async save(file: TransferFile): Promise<TransferFile> {
    this.files.set(file.id, { ...file });
    return { ...file };
  }

  async listByRun(transferRunId: string): Promise<TransferFile[]> {
    return [...this.files.values()].filter((file) => file.transferRunId === transferRunId);
  }

  async listByJob(jobId: string): Promise<TransferFile[]> {
    return [...this.files.values()].filter((file) => file.jobId === jobId);
  }

  async findResolvedByIdentity(identity: ProcessedFileIdentity): Promise<TransferFile | undefined> {
    return [...this.files.values()].find((file) => isResolved(file) && matchesIdentity(file, identity));
  }

  async findSuccessfulByHash(jobId: string, sha256: string): Promise<TransferFile | undefined> {
    return [...this.files.values()].find(
      (file) => isSuccessful(file) && file.jobId === jobId && file.sha256 === sha256
    );
  }

  async deleteOlderThan(cutoff: Date, jobId: string): Promise<number> {
    const expired = [...this.files.values()].filter(
      (file) => file.jobId === jobId && file.startedAt.getTime() < cutoff.getTime()
    );

    for (const file of expired) {
      this.files.delete(file.id);
    }

    return expired.length;
  }
}
