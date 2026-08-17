import type { TransferLogRepository } from '../../domain/logging/LogEntry.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferRun } from '../../domain/transfer/TransferRun.js';
import type { RunDetail } from '../transfer/TransferHistoryService.js';
import type { ProtocolArchive } from './ProtocolArchive.js';

/**
 * Legt das Protokoll eines beendeten Laufs ab.
 *
 * Es steht zwischen dem Lauf und der Ablage, damit der Lauf weder die Ablage
 * noch das Protokollformat kennen muss: Er sagt „dieser Lauf ist fertig", und
 * was daraus wird, entscheidet sich hier.
 *
 * Geholt wird aus dem Memo, das den Lauf gerade mitgeschrieben hat — mit
 * jedem Detailgrad, den der Workflow verlangt hat. Der Zeitpunkt ist knapp
 * hinter dem Ende des Laufs und muss es sein: Danach kann ein neuer Lauf das
 * Memo verdrängen.
 */
export class RunProtocolWriter {
  constructor(
    private readonly logRepository: TransferLogRepository,
    private readonly archive: ProtocolArchive
  ) {}

  async write(job: TransferJob, run: TransferRun): Promise<string | undefined> {
    const entries = await this.logRepository.list({ runId: run.id, limit: 1_000_000 });

    if (entries.length === 0) {
      // Ein Lauf ohne eine einzige Zeile hinterlässt keine leere Datei: Ein
      // Verzeichnis voller leerer Protokolle sieht nach Betrieb aus und ist
      // keiner.
      return undefined;
    }

    const detail: RunDetail = { ...toSummary(run), jobName: job.name, files: [], logs: [] };
    const written = await this.archive.save(detail, entries, job.protocolDirectory);

    return written.path;
  }
}

/** Der Lauf in der Form, die der Protokollkopf braucht. */
function toSummary(run: TransferRun): RunDetail {
  return {
    runId: run.id,
    jobId: run.jobId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : undefined,
    filesFound: run.filesFound,
    filesProcessed: run.filesProcessed,
    filesSucceeded: run.filesSucceeded,
    filesSkipped: run.filesSkipped,
    filesFailed: run.filesFailed,
    files: [],
    logs: [],
  };
}
