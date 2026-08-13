import type { ProcessedFileIdentity, TransferFile } from './TransferFile.js';

export interface TransferFileRepository {
  save(file: TransferFile): Promise<TransferFile>;
  listByRun(transferRunId: string): Promise<TransferFile[]>;
  listByJob(jobId: string): Promise<TransferFile[]>;

  /**
   * An earlier run that already settled this exact source file, either by
   * transferring it or by recognising it as a duplicate (spec sections 39-40).
   */
  findResolvedByIdentity(identity: ProcessedFileIdentity): Promise<TransferFile | undefined>;

  /** Successful earlier transfer of the same content under any name (spec section 108). */
  findSuccessfulByHash(jobId: string, sha256: string): Promise<TransferFile | undefined>;

  /**
   * Removes records of one job that started before the cutoff. These records
   * are also the duplicate registry, so deleting them makes the files they
   * describe unknown again — see `RetentionConfig.historyDays`.
   */
  deleteOlderThan(cutoff: Date, jobId: string): Promise<number>;
}
