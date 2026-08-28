import type { Logger } from '../../domain/logging/LogEntry.js';
import type { Paketbestand } from '../../domain/transfer/Archivpaket.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { Vorentscheidung } from '../../domain/consolidation/Vorentscheidung.js';
import type { Archivdienst } from '../workflow/Archivdienst.js';
import type { Korrekturauftrag } from '../workflow/WorkflowExecutionService.js';

/**
 * Der Rückweg: aus entschiedenen Fällen wird ein Lauf (SPEC-07, Abschnitt 13).
 *
 * ```text
 * 1. die bereinigten Fälle holen        →  Entscheidungen und Fallnummern
 * 2. das Archivpaket des Laufs öffnen   →  die Lieferung von damals
 * 3. den Korrekturlauf rechnen          →  ein vollständiges Ergebnis
 * 4. bei Erfolg abschließen             →  ERFOLGREICH VERARBEITET
 * ```
 *
 * ## Warum das hier steht und nicht in der Route
 *
 * Weil es vier Schritte sind und der dritte fehlschlagen darf. Eine Route, die
 * das enthielte, müsste entscheiden, was bei einem halben Durchlauf geschieht —
 * und diese Entscheidung gehört nicht in eine Zeile HTTP-Verarbeitung.
 *
 * ## Der vierte Schritt ist keine Formsache
 *
 * „Ein bearbeiteter Konflikt gilt erst dann als erfolgreich verarbeitet, wenn
 * die anschließende Verarbeitung erfolgreich abgeschlossen wurde." Misslingt
 * der Lauf, bleiben die Fälle auf `ERNEUT_VERARBEITET` stehen — sie sind aus
 * der Bearbeitung heraus, aber nicht durch. Wer sie vorher abschlösse, hätte
 * einen Bestand, in dem alles erledigt aussieht und nichts geliefert wurde.
 */
export interface Korrekturergebnis {
  /** Ob der Lauf durchgegangen ist. */
  gelungen: boolean;
  /** Die Kennung des Korrekturlaufs. */
  laufId: string;
  /** Wie viele Fälle mitgingen. */
  faelle: number;
  /** Wie viele davon jetzt als erfolgreich verarbeitet gelten. */
  abgeschlossen: number;
  /** Was der Lauf zu sagen hat — auch, wenn er misslang. */
  meldung: string;
  /**
   * Die Konfliktzieldatei — der **Nachweis**, nicht der Weg.
   *
   * SPEC-07 verlangt sie im Dateimodell: „Ausleitung der bereinigten Fälle für
   * die erneute Verarbeitung." Gerechnet wird nicht aus ihr, sondern aus den
   * Entscheidungen im Bestand; sie ist das, was man einem Lieferanten hinlegt
   * oder in drei Monaten nachsieht.
   *
   * Wohin sie geschrieben wird, entscheidet nicht dieser Dienst — das ist eine
   * Frage an den, der die Freigabe auslöst.
   */
  zieldatei: { felder: string[]; zeilen: string[][] };
}

/** Was der Dienst über Läufe wissen muss, um den Korrekturlauf zu starten. */
export interface Laufausfuehrung {
  korrigiere(job: TransferJob, auftrag: Korrekturauftrag): Promise<{ status: TransferRunStatus; message: string }>;
}

export interface Fallakte {
  zurVerarbeitung(
    tenantId: string,
    benutzer: { id: string; name?: string },
    optionen: { laufId?: string; neuerLaufId: string; jetzt?: Date }
  ): Promise<{ felder: string[]; zeilen: string[][]; ids: string[]; vorentscheidungen: Vorentscheidung[] }>;
  abschliessen(
    ids: readonly string[],
    benutzer: { id: string; name?: string },
    optionen: { laufId: string; jetzt?: Date }
  ): Promise<number>;
}

export class KorrekturFehler extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'KorrekturFehler';
  }
}

export class Korrekturdienst {
  constructor(
    private readonly faelle: Fallakte,
    private readonly pakete: Paketbestand,
    private readonly archiv: Archivdienst,
    private readonly jobs: { getById(id: string): Promise<TransferJob | undefined> },
    private readonly ausfuehrung: Laufausfuehrung,
    private readonly logger?: Logger
  ) {}

  async fuehreAus(auftrag: {
    tenantId: string;
    /** Der Lauf, dessen Konflikte entschieden wurden. */
    laufId: string;
    neuerLaufId: string;
    benutzer: { id: string; name?: string };
    jetzt?: Date;
  }): Promise<Korrekturergebnis> {
    const jetzt = auftrag.jetzt ?? new Date();

    /*
     * Erst das Paket, dann der Statuswechsel.
     *
     * Andersherum stünden die Fälle auf `ERNEUT_VERARBEITET`, und dann fiele
     * auf, dass es keine Lieferung gibt, auf die man sie anwenden könnte — sie
     * wären aus der Bearbeitung heraus und hätten keinen Weg zurück.
     */
    const paket = await this.pakete.zuLauf(auftrag.laufId);

    if (!paket) {
      throw new KorrekturFehler(
        409,
        `Zu Lauf ${auftrag.laufId} gibt es kein Archivpaket. Der Korrekturlauf rechnet auf der ` +
          'ursprünglichen Lieferung, und ohne sie gibt es nichts zu rechnen. ' +
          'Läufe von vor der Archivpflicht haben keines - deren Fälle lassen sich nur von Hand nacharbeiten'
      );
    }

    const job = await this.jobs.getById(paket.jobId);

    if (!job) {
      throw new KorrekturFehler(
        409,
        `Den Workflow „${paket.jobId}" gibt es nicht mehr. Ohne ihn ist nicht bekannt, mit welchen Regeln ` +
          'die Lieferung zu rechnen wäre'
      );
    }

    const inhalt = await this.archiv.oeffne(paket.pfad);

    /*
     * Jetzt erst: Die Fälle wechseln auf `ERNEUT_VERARBEITET`, und ihre
     * Entscheidungen kommen in einem Zug mit. Sie ein zweites Mal zu lesen
     * hieße, sie nach dem Statuswechsel zu lesen — und dann wären es keine
     * bereinigten Fälle mehr.
     */
    const freigabe = await this.faelle.zurVerarbeitung(auftrag.tenantId, auftrag.benutzer, {
      laufId: auftrag.laufId,
      neuerLaufId: auftrag.neuerLaufId,
      jetzt,
    });

    this.logger?.log({
      timestamp: jetzt,
      level: 'INFO',
      userId: auftrag.benutzer.id,
      username: auftrag.benutzer.name,
      message:
        `Korrekturlauf ${auftrag.neuerLaufId} zu Lauf ${auftrag.laufId}: ${freigabe.ids.length} Fall/Fälle, ` +
        `${inhalt.dateien.length} Datei(en) aus „${paket.pfad}"`,
    });

    const lauf = await this.ausfuehrung.korrigiere(job, {
      ausLauf: auftrag.laufId,
      laufId: auftrag.neuerLaufId,
      lieferung: inhalt.dateien,
      vorentscheidungen: freigabe.vorentscheidungen,
      jetzt,
    });

    const gelungen =
      lauf.status === TransferRunStatus.SUCCESS || lauf.status === TransferRunStatus.SUCCESS_NO_FILES;

    if (!gelungen) {
      /*
       * Die Fälle bleiben auf `ERNEUT_VERARBEITET`. Sie sind aus der
       * Bearbeitung heraus, aber nicht durch — und genau so steht es im
       * Bestand, statt dass alles erledigt aussieht.
       */
      this.logger?.log({
        timestamp: jetzt,
        level: 'ERROR',
        message:
          `Korrekturlauf ${auftrag.neuerLaufId} misslungen: ${lauf.message}. ` +
          `${freigabe.ids.length} Fall/Fälle bleiben auf „zur erneuten Verarbeitung gegeben"`,
      });

      return {
        gelungen: false,
        laufId: auftrag.neuerLaufId,
        faelle: freigabe.ids.length,
        abgeschlossen: 0,
        meldung: lauf.message,
        zieldatei: { felder: freigabe.felder, zeilen: freigabe.zeilen },
      };
    }

    const abgeschlossen = await this.faelle.abschliessen(freigabe.ids, auftrag.benutzer, {
      laufId: auftrag.neuerLaufId,
      jetzt,
    });

    return {
      gelungen: true,
      laufId: auftrag.neuerLaufId,
      faelle: freigabe.ids.length,
      abgeschlossen,
      meldung: lauf.message,
      zieldatei: { felder: freigabe.felder, zeilen: freigabe.zeilen },
    };
  }
}
