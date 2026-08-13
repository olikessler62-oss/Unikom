import path from 'node:path';
import type { ProcessedFileIdentity, TransferFile } from '../../domain/transfer/TransferFile.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import { isResolved, isSuccessful, matchesIdentity } from '../../domain/transfer/TransferFileMatching.js';
import { JsonFileStore, optionalDate, requiredDate } from './JsonFileStore.js';

function reviveTransferFile(raw: Record<string, unknown>): TransferFile {
  return {
    ...(raw as unknown as TransferFile),
    sourceLastModified: optionalDate(raw.sourceLastModified),
    startedAt: requiredDate(raw.startedAt, 'startedAt'),
    completedAt: optionalDate(raw.completedAt),
  };
}

/**
 * Durable per-file history. This is also the processed-file registry duplicate
 * detection queries, which is what stops a restarted application from
 * transferring everything again (spec section 39).
 */
export class FileTransferFileRepository implements TransferFileRepository {
  private readonly store: JsonFileStore<TransferFile>;

  constructor(dataDirectory: string) {
    this.store = new JsonFileStore(path.join(dataDirectory, 'transfer-files.json'), reviveTransferFile);
  }

  async save(file: TransferFile): Promise<TransferFile> {
    await this.store.mutate((files) => {
      const index = files.findIndex((existing) => existing.id === file.id);
      if (index === -1) {
        return [...files, file];
      }

      const copy = [...files];
      copy[index] = file;
      return copy;
    });

    return file;
  }

  async listByRun(transferRunId: string): Promise<TransferFile[]> {
    return (await this.store.readAll()).filter((file) => file.transferRunId === transferRunId);
  }

  async listByJob(jobId: string): Promise<TransferFile[]> {
    return (await this.store.readAll()).filter((file) => file.jobId === jobId);
  }

  async findResolvedByIdentity(identity: ProcessedFileIdentity): Promise<TransferFile | undefined> {
    return (await this.store.readAll()).find((file) => isResolved(file) && matchesIdentity(file, identity));
  }

  async findSuccessfulByHash(jobId: string, sha256: string): Promise<TransferFile | undefined> {
    return (await this.store.readAll()).find(
      (file) => isSuccessful(file) && file.jobId === jobId && file.sha256 === sha256
    );
  }
}
