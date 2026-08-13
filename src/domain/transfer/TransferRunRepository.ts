export interface TransferRunRepository {
  list(): Promise<TransferRun[]>;
  getById(id: string): Promise<TransferRun | undefined>;
  save(run: TransferRun): Promise<TransferRun>;
}

export interface TransferRun {
  id: string;
  jobId: string;
  status: string;
  startedAt: Date;
  completedAt?: Date;
  filesFound: number;
  filesProcessed: number;
  filesSucceeded: number;
  filesSkipped: number;
  filesFailed: number;
}
