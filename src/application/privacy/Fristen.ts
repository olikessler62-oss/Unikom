import { DEFAULT_LOG_RETENTION_DAYS } from '../retention/RetentionService.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';

/**
 * Die geltenden Aufbewahrungsfristen, je Mandant an einer Stelle (FR_009,
 * Abschnitt 4).
 *
 * Sie stehen verstreut in den Workflows, und genau das ist das Problem: Wer sie
 * beauskunften soll, müsste dreißig Editoren aufmachen und hoffen, keinen
 * übersehen zu haben. Hier werden sie gelesen, nicht gepflegt — was hier steht,
 * ist der tatsächliche Zustand und keine zweite Wahrheit, die veraltet.
 *
 * Eine Frist, die nur als Voreinstellung gilt, ist als solche gekennzeichnet.
 * Der Unterschied ist keine Feinheit: Beim einen hat jemand entschieden, beim
 * anderen hat niemand hingesehen — und ein Datenschutzbeauftragter fragt genau
 * danach.
 */
export interface Frist {
  /** Der Bestand, um den es geht — wie in FR_009, Abschnitt 2. */
  was: string;
  /** Die Frist in Worten. */
  wert: string;
  /** Ob sie eingestellt wurde oder nur die Voreinstellung ist. */
  voreingestellt: boolean;
  /** Was daran auffällt, sofern etwas auffällt. */
  hinweis?: string;
}

export interface Workflowfristen {
  jobId: string;
  name: string;
  enabled: boolean;
  fristen: Frist[];
}

export interface Mandantsfristen {
  tenantId: string;
  name: string;
  /** Was für den Mandanten als Ganzes gilt, unabhängig vom einzelnen Workflow. */
  fristen: Frist[];
  workflows: Workflowfristen[];
}

const QUELLE: Record<string, string> = {
  KEEP: 'bleibt liegen',
  MOVE: 'wird verschoben',
  DELETE: 'wird entfernt',
};

function tage(anzahl: number): string {
  return anzahl === 1 ? '1 Tag' : `${anzahl} Tage`;
}

export function fristenEines(job: TransferJob, voreinstellung = DEFAULT_LOG_RETENTION_DAYS): Workflowfristen {
  const retention = job.retention ?? {};

  return {
    jobId: job.id,
    name: job.name,
    enabled: job.enabled,
    fristen: [
      {
        was: 'Laufprotokoll',
        wert: tage(retention.logDays ?? voreinstellung),
        voreingestellt: retention.logDays === undefined,
      },
      {
        was: 'Verarbeitungshistorie',
        wert: retention.historyDays === undefined ? 'unbegrenzt' : tage(retention.historyDays),
        voreingestellt: retention.historyDays === undefined,
        /*
         * Die Historie ist zugleich das Verzeichnis dessen, was bereits
         * übernommen wurde. Wer sie kürzt, während die Quelldatei liegen
         * bleibt, holt dieselbe Datei irgendwann ein zweites Mal — das gehört
         * neben die Frist und nicht in eine Fußnote am Ende der Seite.
         */
        hinweis:
          retention.historyDays === undefined
            ? 'Ohne Frist, weil diese Einträge zugleich verhindern, dass dieselbe Datei zweimal übernommen wird'
            : job.sourceSuccessAction === 'KEEP'
              ? 'Achtung: Die Quelldatei bleibt liegen. Nach Ablauf der Frist gilt sie wieder als unbekannt und wird erneut übernommen'
              : undefined,
      },
      {
        was: 'Eingangsdatei nach erfolgreicher Verarbeitung',
        wert: QUELLE[job.sourceSuccessAction] ?? job.sourceSuccessAction,
        voreingestellt: false,
        hinweis:
          job.sourceSuccessAction === 'KEEP'
            ? 'Eine Eingangsdatei, die liegen bleibt, ist ein Bestand, den niemand verwaltet (FR_009, Abschnitt 4)'
            : job.sourceSuccessAction === 'MOVE'
              ? `Verschoben nach ${job.sourceArchiveDirectory ?? '- kein Verzeichnis eingetragen'}; dort gilt keine Frist`
              : undefined,
      },
    ],
  };
}

export async function fristenJeMandant(
  tenants: TenantRepository,
  jobs: TransferJobRepository,
  voreinstellung = DEFAULT_LOG_RETENTION_DAYS
): Promise<Mandantsfristen[]> {
  const alle = await jobs.list();

  return (await tenants.list()).map((mandant) => ({
    tenantId: mandant.id,
    name: mandant.name,
    fristen: [
      {
        was: 'Ergebnisbestand',
        wert: 'unbegrenzt',
        voreingestellt: true,
        hinweis:
          'Für das, was Unikom ausliefert, gibt es heute keine Frist. Es liegt unter ' +
          (mandant.rootDirectory ?? 'dem Zielverzeichnis der Workflows') +
          ' und wird von dort aus verwaltet',
      },
    ],
    workflows: alle
      .filter((job) => job.tenantId === mandant.id)
      .map((job) => fristenEines(job, voreinstellung)),
  }));
}
