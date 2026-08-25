import type { Logger } from '../../domain/logging/LogEntry.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import type { Archivdienst } from './Archivdienst.js';

/**
 * Räumt abgelaufene Archivpakete fort (FR_006, Runde 10).
 *
 * ## Warum das nicht im Archivdienst steht
 *
 * Der Dienst kennt ein Verzeichnis und eine Frist. Welche Verzeichnisse es
 * überhaupt gibt und welche Frist für welches gilt, steht ganz woanders: an den
 * Workflows und am Mandanten. Diese Datei bringt beides zusammen und sonst
 * nichts.
 *
 * ## Wo die Verzeichnisse herkommen
 *
 * Aus den Workflows — dieselbe Ableitung, die auch der Bildschirm benutzt. Eine
 * eigene Liste von Archivverzeichnissen zu führen hieße, sie beim Umhängen
 * eines Workflows nachzupflegen; wer das einmal vergisst, hat ein Verzeichnis,
 * das keine Frist mehr kennt und ewig wächst.
 *
 * ## Was hier nicht geprüft wird
 *
 * Ob zu einem Paket noch offene Konflikte gehören. Die Ausleitungen tun das —
 * sie kennen ihren Lauf. Ein Archivpaket kennt seinen auch, aber nur über
 * seinen Dateinamen, und eine Aufbewahrungsentscheidung an einer Zeichenkette
 * festzumachen wäre die Art von Klugheit, die beim ersten umbenannten Workflow
 * Originaldaten kostet. Die Frist ist die Entscheidung des Kunden; sie genügt.
 */
export class Archivbereinigung {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly jobs: { list(): Promise<TransferJob[]> },
    private readonly dienst: Archivdienst,
    private readonly logger?: Logger
  ) {}

  async bereinige(jetzt = new Date()): Promise<{ entfernt: number; fehler: number }> {
    const alle = await this.jobs.list();
    let entfernt = 0;
    let fehler = 0;

    for (const mandant of await this.tenants.list()) {
      const tage = mandant.archivTage;

      for (const verzeichnis of archivverzeichnisse(alle, mandant.id)) {
        const ergebnis = await this.dienst.bereinige(verzeichnis, { tage, jetzt });

        for (const pfad of ergebnis.entfernt) {
          /*
           * Je Paket eine Zeile. Ein Archiv ist das Original einer Lieferung;
           * dass es fort ist, gehört einzeln ins Protokoll und nicht in eine
           * Summe am Ende des Tages.
           */
          this.logger?.log({
            timestamp: jetzt,
            level: 'INFO',
            message: `Archivpaket „${pfad}" ist abgelaufen und wurde fortgenommen`,
          });
        }

        for (const problem of ergebnis.fehler) {
          this.logger?.log({
            timestamp: jetzt,
            level: 'WARNING',
            message: `Das Archivpaket „${problem.pfad}" ließ sich nicht forträumen: ${problem.grund}`,
          });
        }

        entfernt += ergebnis.entfernt.length;
        fehler += ergebnis.fehler.length;
      }
    }

    return { entfernt, fehler };
  }
}

/**
 * Jedes Archivverzeichnis, das an einem Workflow dieses Mandanten steht.
 *
 * Doppelte fallen fort: Zwei Durchgänge dürfen dasselbe Archiv benutzen, und
 * es zweimal zu bereinigen hieße, im zweiten Durchgang über Dateien zu
 * stolpern, die der erste schon fortgenommen hat.
 */
export function archivverzeichnisse(jobs: readonly TransferJob[], tenantId: string): string[] {
  const gefunden = new Set<string>();

  for (const job of jobs) {
    if (job.tenantId !== tenantId) {
      continue;
    }

    const durchgaenge = [job.consolidation, ...(job.consolidation?.weitere ?? [])];

    for (const durchgang of durchgaenge) {
      const archiv = durchgang?.dateien?.abholung?.archiv;

      if (archiv) {
        gefunden.add(archiv);
      }
    }
  }

  return [...gefunden];
}
