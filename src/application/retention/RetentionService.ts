import type { TransferLogRepository } from '../../domain/logging/LogEntry.js';
import type { RetentionConfig, TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferFileRepository } from '../../domain/transfer/TransferFileRepository.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import { DEFAULT_PROTOCOL_RETENTION_DAYS, type ProtocolArchive } from '../logging/ProtocolArchive.js';

/**
 * How long a log is kept when a job says nothing about it. Long enough to
 * investigate what went wrong last quarter, short enough to be a period rather
 * than "forever" (Art. 5(1)(e) GDPR).
 */
export const DEFAULT_LOG_RETENTION_DAYS = 90;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RetentionOutcome {
  jobId: string;
  jobName: string;
  logEntriesDeleted: number;
  /** Abgelegte Protokolldateien, die zu alt geworden sind. */
  protocolFilesDeleted?: number;
  fileRecordsDeleted: number;
}

/**
 * Deletes what may no longer be kept: log entries and records of taken-over
 * files. Both hold file names, and file names are regularly personal data.
 *
 * The file history is also the duplicate registry, so deleting from it has a
 * visible consequence and therefore no default — see `RetentionConfig`.
 */
export class RetentionService {
  constructor(
    private readonly jobRepository: TransferJobRepository,
    private readonly logRepository: TransferLogRepository,
    private readonly transferFileRepository: TransferFileRepository,
    private readonly defaultLogRetentionDays: number = DEFAULT_LOG_RETENTION_DAYS,
    /**
     * Räumt abgelegte Protokolldateien auf. Fehlt er, gibt es keine — dann
     * gibt es auch nichts aufzuräumen.
     */
    private readonly protocols?: ProtocolArchive
  ) {}

  async apply(now: Date = new Date()): Promise<RetentionOutcome[]> {
    const jobs = await this.jobRepository.list();
    const outcomes: RetentionOutcome[] = [];

    for (const job of jobs) {
      outcomes.push(await this.applyToJob(job, now));
    }

    return outcomes;
  }

  private async applyToJob(job: TransferJob, now: Date): Promise<RetentionOutcome> {
    const retention: RetentionConfig = job.retention ?? {};
    const logDays = retention.logDays ?? this.defaultLogRetentionDays;

    const logEntriesDeleted =
      logDays > 0 ? await this.logRepository.deleteOlderThan(cutoff(now, logDays), job.id) : 0;

    // No default on purpose: removing these records makes files unknown again.
    const fileRecordsDeleted =
      retention.historyDays !== undefined && retention.historyDays > 0
        ? await this.transferFileRepository.deleteOlderThan(cutoff(now, retention.historyDays), job.id)
        : 0;

    // Abgelegte Protokolle wachsen sonst ohne Ende: Wer das Ablegen
    // einschaltet, will nicht in einem Jahr ein Verzeichnis mit
    // achttausend Dateien vorfinden.
    const protocolFilesDeleted =
      job.saveProtocol === true && this.protocols
        ? await this.protocols.prune(
            cutoff(now, job.retention?.protocolDays ?? DEFAULT_PROTOCOL_RETENTION_DAYS),
            job.protocolDirectory
          )
        : 0;

    return { jobId: job.id, jobName: job.name, logEntriesDeleted, fileRecordsDeleted, protocolFilesDeleted };
  }
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
}
