import { randomUUID } from 'node:crypto';
import os from 'node:os';

import {
  ANLASS_STUFE,
  erneutZeigen,
  istOffen,
  KANAELE,
  type Benachrichtigung,
  type Benachrichtigungsbestand,
  type Meldeanlass,
} from '../../domain/background/Benachrichtigung.js';
import {
  ALS_ABGEBROCHEN_NACH_MS,
  HERZSCHLAG_ALLE_MS,
  istVerstummt,
  seit,
  type Herzschlag,
  type Herzschlagbestand,
} from '../../domain/background/Heartbeat.js';
import {
  alsNachricht,
  empfaengerFuer,
  type Meldeeinstellungen,
  type Postbote,
} from '../../domain/background/Postausgang.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import type { Versaeumnis } from '../../domain/scheduling/Ausbleiben.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { TransferRunRepository } from '../../domain/transfer/TransferRunRepository.js';

/**
 * Der Hintergrundbetrieb (Etappe 8, SPEC-01 §13 bis §22; SPEC-02 §49 bis §52).
 *
 * ```text
 * [Worker]  schlägt  ──> unikom.db <──  liest  [Server]
 *    │                                            │
 *    └── läuft weiter, wenn der Browser zugeht     └── erkennt, wenn der Worker still wird
 * ```
 *
 * ## Der Prozess, der den Fehler eintragen müsste, ist der verschwundene
 *
 * Ein Lauf, dem der Strom ausging, kann sich nicht selbst auf `FAILED` setzen.
 * Deshalb schreibt der Worker regelmäßig ein Lebenszeichen, und **ein anderer**
 * liest es: Bleibt es aus, während ein Lauf auf `RUNNING` steht, wird der Lauf
 * als abgebrochen erkannt (SPEC-02, Abschnitt 52: „Der Status darf nicht
 * dauerhaft auf RUNNING stehen bleiben").
 *
 * ## Wer meldet, meldet nicht alles
 *
 * Eine erfolgreiche Verarbeitung geht ins Benachrichtigungscenter und sonst
 * nirgends. Wer jeden Erfolg als Popup bekommt, klickt auch das Konfliktfenster
 * weg, ohne es gelesen zu haben.
 */
export interface Prozessangabe {
  /** Eindeutig je Prozess und Start — ein Neustart ist ein anderer Prozess. */
  id: string;
  host: string;
  pid: number;
  gestartet: string;
}

export function dieserProzess(jetzt = new Date()): Prozessangabe {
  return { id: `${os.hostname()}-${process.pid}`, host: os.hostname(), pid: process.pid, gestartet: jetzt.toISOString() };
}

/**
 * Der Weg nach draußen.
 *
 * Zwei Teile, weil sie zwei verschiedene Dinge sind: **wer** zustellt (immer
 * derselbe) und **wohin** (je Mandant verschieden). Fehlt der Zugriff, bleibt
 * jede Meldung im Center — und das ist der Normalzustand einer Installation, in
 * der niemand einen Postausgang eingetragen hat.
 */
export interface Postfachzugriff {
  postbote: Postbote;
  einstellungen(tenantId: string): Promise<Meldeeinstellungen | undefined>;
}

export interface Abbruchbefund {
  laufId: string;
  jobId: string;
  prozess?: string;
  /** Warum der Lauf als abgebrochen gilt — in Worten. */
  grund: string;
}

export class BackgroundService {
  private schlagtimer?: NodeJS.Timeout;

  constructor(
    private readonly herzschlaege: Herzschlagbestand,
    private readonly meldungen: Benachrichtigungsbestand,
    private readonly laeufe: TransferRunRepository,
    private readonly logger?: Logger,
    private readonly frist = ALS_ABGEBROCHEN_NACH_MS,
    private readonly post?: Postfachzugriff
  ) {}

  /* ---------- Herzschlag ---------- */

  /**
   * Regelmäßig ein Lebenszeichen schreiben, solange dieser Prozess lebt.
   *
   * `unref` sorgt dafür, dass der Zeitgeber den Prozess nicht am Leben hält:
   * Ein Worker, der nichts mehr zu tun hat, soll sich beenden können — und
   * nicht deshalb weiterlaufen, weil er noch schlagen will.
   */
  beginneHerzschlag(prozess: Prozessangabe, abstand = HERZSCHLAG_ALLE_MS): void {
    const schlagen = (): void => {
      void this.schlage(prozess);
    };

    schlagen();
    this.schlagtimer = setInterval(schlagen, abstand);
    this.schlagtimer.unref?.();
  }

  async schlage(prozess: Prozessangabe, laufId?: string, jetzt = new Date()): Promise<void> {
    await this.herzschlaege.melden({
      prozess: prozess.id,
      zuletzt: jetzt.toISOString(),
      laufId,
      host: prozess.host,
      pid: prozess.pid,
      gestartet: prozess.gestartet,
    });
  }

  /** Ein ordentliches Ende — es unterscheidet den Feierabend vom Absturz. */
  async beendeHerzschlag(prozess: Prozessangabe): Promise<void> {
    if (this.schlagtimer) {
      clearInterval(this.schlagtimer);
      this.schlagtimer = undefined;
    }

    await this.herzschlaege.abmelden(prozess.id);
  }

  async prozesse(jetzt = new Date()): Promise<{ schlag: Herzschlag; lebt: boolean; seit: string }[]> {
    return (await this.herzschlaege.alle()).map((schlag) => ({
      schlag,
      lebt: !istVerstummt(schlag, jetzt, this.frist),
      seit: seit(schlag, jetzt),
    }));
  }

  /* ---------- Abgebrochene Läufe ---------- */

  /**
   * Läufe, die auf `RUNNING` stehen, ohne dass noch jemand daran arbeitet.
   *
   * Zwei Fälle, und beide zählen: Der Prozess hat ein altes Lebenszeichen
   * hinterlassen, oder gar keins — nach einem Neustart des Rechners ist die
   * Tabelle leer und der Lauf steht trotzdem auf `RUNNING`. Wer nur den ersten
   * Fall prüfte, ließe genau die Läufe stehen, die ein Stromausfall erwischt hat.
   */
  async findeAbgebrochene(jetzt = new Date()): Promise<Abbruchbefund[]> {
    const laufende = (await this.laeufe.list()).filter((lauf) => lauf.status === TransferRunStatus.RUNNING);

    if (laufende.length === 0) {
      return [];
    }

    const lebende = new Set(
      (await this.herzschlaege.alle())
        .filter((schlag) => !istVerstummt(schlag, jetzt, this.frist))
        .map((schlag) => schlag.laufId)
        .filter((id): id is string => id !== undefined)
    );

    return laufende
      .filter((lauf) => !lebende.has(lauf.id))
      .map((lauf) => ({
        laufId: lauf.id,
        jobId: lauf.jobId,
        grund:
          `Der Lauf steht auf RUNNING, aber kein Prozess meldet sich mehr dafür. ` +
          `Ein Lebenszeichen gilt ${Math.round(this.frist / 1000)} Sekunden`,
      }));
  }

  /**
   * Sie als unterbrochen eintragen und melden.
   *
   * Läuft beim Start des Servers **und** des Workers: Nach einem Stromausfall
   * kommt einer von beiden zuerst hoch, und welcher es ist, darf keine Rolle
   * spielen. Zweimal auszuführen schadet nicht — beim zweiten Mal steht der Lauf
   * nicht mehr auf `RUNNING`.
   */
  async markiereAbgebrochene(tenantId: string, jetzt = new Date()): Promise<Abbruchbefund[]> {
    const befunde = await this.findeAbgebrochene(jetzt);

    for (const befund of befunde) {
      const lauf = await this.laeufe.getById(befund.laufId);

      if (lauf) {
        /*
         * `FAILED` und nicht `SUCCESS`: „Ein Neustart des Rechners darf nicht
         * dazu führen, dass eine Verarbeitung fälschlicherweise als erfolgreich
         * abgeschlossen betrachtet wird" (SPEC-01, Abschnitt 15). Was wirklich
         * geschah, steht im Protokoll — der Status sagt nur, dass es kein
         * ordentliches Ende gab.
         */
        await this.laeufe.save({ ...lauf, status: TransferRunStatus.FAILED, completedAt: jetzt });
      }

      await this.melde(tenantId, 'LAUF_ABGEBROCHEN', {
        titel: `Verarbeitung unerwartet beendet (${befund.jobId})`,
        text:
          `${befund.grund}. Der Lauf wurde nicht abgeschlossen; was bereits geschrieben wurde, steht im ` +
          'Protokoll. Ein erneuter Lauf beginnt von vorn und bekommt eine eigene Verarbeitungs-ID',
        ziel: { art: 'LAUF', id: befund.laufId },
      }, jetzt);

      this.logger?.log({
        timestamp: jetzt,
        level: 'ERROR',
        runId: befund.laufId,
        jobId: befund.jobId,
        message: `Lauf als unterbrochen erkannt: ${befund.grund}`,
      });
    }

    return befunde;
  }

  /* ---------- Ausgebliebene Verarbeitung ---------- */

  /**
   * Was schon gemeldet wurde.
   *
   * Ohne dieses Gedächtnis meldete sich derselbe versäumte Termin bei jedem
   * Tick erneut, solange ihn etwas am Nachholen hindert — eine abgelaufene
   * Lizenz zum Beispiel. Zwölf gleiche Meldungen pro Stunde sind keine Warnung
   * mehr, sondern der Grund, warum jemand die Glocke nicht mehr ansieht.
   *
   * Im Arbeitsspeicher und nicht im Bestand: Ein Neustart des Workers meldet
   * einen weiterhin offenen Termin noch einmal, und das ist richtig so — nach
   * einem Neustart weiß niemand, ob die erste Meldung jemanden erreicht hat.
   */
  private readonly gemeldeteVersaeumnisse = new Set<string>();

  /**
   * Termine melden, die verstrichen sind, ohne dass etwas geschah.
   *
   * Gibt zurück, was wirklich gemeldet wurde — die Wiederholungen fallen
   * stillschweigend heraus.
   */
  async meldeAusbleiben(versaeumt: readonly Versaeumnis[], jetzt = new Date()): Promise<Versaeumnis[]> {
    const neue = versaeumt.filter((eintrag) => !this.gemeldeteVersaeumnisse.has(eintrag.kennung));

    for (const eintrag of neue) {
      this.gemeldeteVersaeumnisse.add(eintrag.kennung);

      await this.melde(
        eintrag.tenantId,
        'VERARBEITUNG_AUSGEBLIEBEN',
        {
          titel: `Erwartete Verarbeitung nicht erfolgt (${eintrag.name})`,
          text:
            `Der Workflow war für ${eintrag.erwartetLokal} vorgesehen und ist seit ${eintrag.ueberfaellig} überfällig. ` +
            'Die häufigste Ursache ist ein Worker, der nicht läuft; danach kommen eine abgelaufene Lizenz und ' +
            'ein vorheriger Lauf, der noch nicht fertig ist. Was zutrifft, steht im Protokoll',
          ziel: { art: 'LAUF', id: eintrag.jobId },
        },
        jetzt
      );

      this.logger?.log({
        timestamp: jetzt,
        level: 'ERROR',
        jobId: eintrag.jobId,
        message:
          `Erwartete Verarbeitung nicht erfolgt: „${eintrag.name}" war für ${eintrag.erwartetLokal} vorgesehen ` +
          `und ist seit ${eintrag.ueberfaellig} überfällig`,
      });
    }

    return neue;
  }

  /* ---------- Benachrichtigungen ---------- */

  async melde(
    tenantId: string,
    anlass: Meldeanlass,
    teile: { titel: string; text: string; ziel?: Benachrichtigung['ziel'] },
    jetzt = new Date()
  ): Promise<Benachrichtigung> {
    const meldung: Benachrichtigung = {
      id: randomUUID(),
      tenantId,
      anlass,
      stufe: ANLASS_STUFE[anlass],
      entstanden: jetzt.toISOString(),
      ...teile,
    };

    await this.meldungen.anlegen(meldung);
    await this.versende(meldung);

    return meldung;
  }

  /**
   * Die Meldung auch hinausschicken, wo das eingestellt ist.
   *
   * **Nach dem Anlegen und niemals stattdessen.** Der Bestand ist die Wahrheit;
   * der Versand ist eine Zustellung, die scheitern darf. Ein Postfach, das
   * nicht antwortet, ist kein Grund, eine Verarbeitung anzuhalten — und schon
   * gar keiner, die Meldung zu verlieren.
   *
   * Gewartet wird trotzdem: Ein Versand, der nur angestoßen wird, geht mit dem
   * Prozess unter, der sich gleich darauf beendet. Was misslingt, steht im
   * Protokoll, samt Grund.
   */
  private async versende(meldung: Benachrichtigung): Promise<void> {
    if (!this.post) {
      return;
    }

    try {
      const einstellungen = await this.post.einstellungen(meldung.tenantId);
      const an = empfaengerFuer(meldung.stufe, einstellungen);
      const ausgang = einstellungen?.postausgang;

      if (an.length === 0 || !ausgang) {
        return;
      }

      await this.post.postbote.sende(alsNachricht(meldung, ausgang.absender, an, `${meldung.id}@unikom`), ausgang);

      this.logger?.log({
        timestamp: new Date(),
        level: 'INFO',
        message: `Meldung „${meldung.titel}" an ${an.length} Empfänger versandt`,
      });
    } catch (fehler) {
      this.logger?.log({
        timestamp: new Date(),
        level: 'WARNING',
        message:
          `Die Meldung „${meldung.titel}" ließ sich nicht versenden: ` +
          `${fehler instanceof Error ? fehler.message : String(fehler)}. ` +
          'Sie steht unverändert im Benachrichtigungscenter',
      });
    }
  }

  async offene(tenantId: string): Promise<Benachrichtigung[]> {
    return this.meldungen.list(tenantId, true);
  }

  async alle(tenantId: string): Promise<Benachrichtigung[]> {
    return this.meldungen.list(tenantId, false);
  }

  /**
   * Was der Notification Agent beim Start noch einmal zeigen soll.
   *
   * Nur die dringenden: Eine Information von vorgestern noch einmal
   * aufzuklappen, erzieht dazu, alles wegzuklicken.
   */
  async nachzuholen(tenantId: string): Promise<Benachrichtigung[]> {
    return (await this.meldungen.list(tenantId, true)).filter(erneutZeigen);
  }

  async gesehen(id: string, jetzt = new Date()): Promise<void> {
    await this.meldungen.gesehen(id, jetzt.toISOString());
  }

  async bestaetigen(id: string, benutzer: string, jetzt = new Date()): Promise<void> {
    await this.meldungen.bestaetigen(id, benutzer, jetzt.toISOString());
  }

  /** Die Zahlen für das Glockensymbol: offen insgesamt, und wie viele davon drängen. */
  async stand(tenantId: string): Promise<{ offen: number; draengend: number }> {
    const offene = (await this.meldungen.list(tenantId, true)).filter(istOffen);

    return { offen: offene.length, draengend: offene.filter((meldung) => KANAELE[meldung.stufe].popup).length };
  }
}
