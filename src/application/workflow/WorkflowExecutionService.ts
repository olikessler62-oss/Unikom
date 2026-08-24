import {
  einstellungenDesMandanten,
  regionAus,
  wirksameEinstellungen,
  type WirksameEinstellungen,
} from '../../domain/consolidation/Einstellungen.js';
import { beurteileMenge, datensaetzeIn } from '../../domain/consolidation/Menge.js';
import type { Quelle } from '../../domain/consolidation/Quellen.js';
import type { FeatureSet } from '../../domain/licensing/Feature.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import type { Konsolidierungsregeln } from '../../domain/transfer/Konsolidierungsschritt.js';
import { STANDARDREGELN } from '../../domain/transfer/Konsolidierungsschritt.js';
import type {
  ShareConnections,
  ShareCredentials,
} from '../../infrastructure/filesystem/ShareConnectionService.js';
import {
  pruefeStapel,
  stapelgruppen,
  stapelmeldung,
  type Stapeldatei,
  type Stapelgruppe,
} from '../../domain/transfer/Stapel.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { FileTransferStatus, TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import { durchgaenge, stageIsActive, type Konsolidierungsdurchgang } from '../../domain/transfer/WorkflowStages.js';
import { pruefeFolge } from '../../domain/transfer/Schrittfolge.js';
import type { Referenzbestand, Referenzregel } from '../../domain/consolidation/Referenz.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import { schreibeFixedWidth } from '../../infrastructure/formats/FixedWidthSchreiben.js';
import { Schemapruefer } from './Schemapruefer.js';

/** Wie viele Überläufe einzeln ins Protokoll gehen, bevor gezählt wird. */
const ZEIGE_UEBERLAEUFE = 20;
import { wendeUmformungAn, type Umformungspruefall } from '../mapping/Umformungslauf.js';
import type { BackgroundService } from '../background/BackgroundService.js';
import type { BlockweiseKonsolidierung } from '../consolidation/BlockweiseKonsolidierung.js';
import type { ConflictService } from '../conflicts/ConflictService.js';
import type {
  ConsolidationService,
  Konsolidierungsauftrag,
  Konsolidierungsbericht,
} from '../consolidation/ConsolidationService.js';
import type { ResultService } from '../result/ResultService.js';
import type { TransferExecutionOptions, TransferRunResult } from '../transfer/TransferExecutionService.js';
import type { JobExecutor } from '../transfer/TransferOrchestratorService.js';
import type { Dateiablage, Verzeichniseintrag } from './Dateiablage.js';
import { istLesbar, liesDatei, passt, passtEndung, type Lesewunsch } from './Eingang.js';

/**
 * Der Workflow als **ein** Lauf (SPEC-01, Abschnitt 13 und 32).
 *
 * ```text
 * Daten übertragen  →  Daten konsolidieren  →  Ergebnisstand
 *      Modul 1               Modul 2             in der Datenbank
 * ```
 *
 * ## Warum es diesen Dienst gibt
 *
 * Die Konsolidierung lief bis hierher ausschließlich über die Schnittstelle:
 * Ein Mensch schickte Quellen und Regeln, bekam einen Bericht und entschied.
 * Ein Workflow um drei Uhr nachts hat keinen Menschen. Er hat einen Worker, und
 * der kannte bisher nur das Übertragen — die Etappen 5 bis 7 lagen daneben und
 * warteten darauf, dass jemand auf einen Knopf drückt.
 *
 * Der Dienst legt sich deshalb **um** die Übertragung, statt sie zu ersetzen:
 * Er ruft sie auf, sieht sich an, was sie gebracht hat, und macht damit weiter.
 * Zeitplan, Sperre gegen Doppelläufe, Lauf-Eintrag und Historie bleiben, wo sie
 * waren.
 *
 * ## Was der zweite Schritt nicht tut
 *
 * Er liefert nichts aus. Das Ergebnis geht in den Ergebnisbestand, und dorthin
 * gehört es: „In fremde Datenbanken schreibt ausschließlich Modul 3." Die
 * Ergebnisdatei, die dieser Dienst schreiben kann, ist Modul 2 eigenes
 * Arbeitsergebnis in einem Verzeichnis des Kunden — nicht der Export in ein
 * fremdes System. Und sie entsteht nur aus einem **freigegebenen** Stand.
 *
 * ## Ein Fehler hier beendet keinen Lauf ohne Spur
 *
 * Was in der Konsolidierung schiefgeht, wird zu einem Lauf mit Begründung und
 * einer kritischen Meldung — nicht zu einer Ausnahme, die der Orchestrator zu
 * „fehlgeschlagen" ohne Text macht. Genau diese Textlosigkeit ist es, die eine
 * Ferndiagnose unmöglich macht.
 */
export const SYSTEMBENUTZER = { id: 'system', name: 'Automatischer Lauf' } as const;

export interface Konsolidierungsumgebung {
  consolidation: ConsolidationService;
  /**
   * Die blockweise Verarbeitung (SPEC-06, Abschnitt 15).
   *
   * Fehlt sie, läuft jede Menge in einem Zug — so war es, bevor es Schritte
   * gab. Bei kleinen Mengen ist das ohnehin derselbe Weg; erst oberhalb eines
   * Blocks macht sie einen Unterschied.
   */
  blockweise?: BlockweiseKonsolidierung;
  conflicts: ConflictService;
  results: ResultService;
  tenants: TenantRepository;
  ablage: Dateiablage;
  /**
   * Liest die verwalteten Referenzquellen zum Lauf (SPEC-04 §8).
   *
   * Fehlt er, wird nicht abgeglichen — und der Lauf sagt es, statt still ohne
   * Referenz zu rechnen.
   */
  referenzen?: { fuerLauf(id: string, wunsch: Lesewunsch): Promise<Referenzbestand> };
  /**
   * Verbindungen zu Windows-Freigaben und die Zugänge dazu (SPEC-01 §14).
   *
   * Die Konsolidierung liest auf dem Dateisystem dieses Rechners; ein UNC-Pfad
   * ist ein solcher Pfad, nur einer über das Netz. Ohne eigene Sitzung würde er
   * mit der Identität des Dienstes erreicht — beim Kunden selten das richtige
   * Konto, und der Fehler zeigt sich erst nachts.
   *
   * Fehlt die Verdrahtung, läuft alles wie zuvor: örtlich. Ein Durchgang, der
   * ausdrücklich eine Freigabe verlangt, sagt dann im Protokoll, dass er sie
   * ohne eigenen Zugang liest — still darüber hinwegzugehen wäre der Fehler,
   * den niemand findet.
   */
  freigaben?: ShareConnections;
  freigabezugang?: {
    forShare(
      job: Pick<TransferJob, 'name' | 'tenantId'>,
      credentialId: string | undefined,
      seite: 'Quelle' | 'Ziel'
    ): Promise<ShareCredentials | undefined>;
  };
  /** Fehlt sie, entstehen keine Meldungen — das ist die Verdrahtung für Tests. */
  background?: BackgroundService;
  logger?: Logger;
  features?: FeatureSet;
  /**
   * Wie viele Datensätze ein Lauf höchstens umfasst.
   *
   * Fehlt sie, gilt `HOECHSTMENGE`. Sie beschreibt den Rechner und nicht den
   * Kunden — zwei Mandanten auf derselben Maschine teilen sich denselben
   * Arbeitsspeicher.
   */
  hoechstmenge?: number;
}

/**
 * Was die Quellensuche zurückgibt.
 *
 * `uebernommen` steht nur dort, wo ein Stapel aus dem Abholverzeichnis
 * herausgenommen wurde. Es ist die Anweisung an den Durchgang, hinterher
 * aufzuräumen — und der Grund, warum das Aufräumen nicht raten muss, welche
 * Dateien gemeint waren.
 */
/** Die Eingangsdateien eines Durchgangs, und ob ein Stapel übernommen wurde. */
interface Eingang {
  dateien: { name: string; pfad: string; geaendert?: string }[];
  uebernommen?: { verzeichnis: string; namen: string[] };
}

interface Quellenfund {
  quellen: Quelle[];
  hinweise: string[];
  uebernommen?: { verzeichnis: string; namen: string[] };
}

export class WorkflowExecutionService implements JobExecutor {
  constructor(
    private readonly uebertragung: JobExecutor,
    private readonly umgebung: Konsolidierungsumgebung
  ) {}

  async execute(job: TransferJob, options: TransferExecutionOptions = {}): Promise<TransferRunResult> {
    const uebertragen = await this.uebertragung.execute(job, options);

    if (!stageIsActive(job, 'CONSOLIDATE')) {
      return uebertragen;
    }

    try {
      return await this.konsolidiere(job, uebertragen, options);
    } catch (fehler) {
      const grund = fehler instanceof Error ? fehler.message : String(fehler);

      await this.melde(job, 'LAUF_FEHLER', {
        titel: `Konsolidierung fehlgeschlagen (${job.name})`,
        text: `Die Konsolidierung brach ab: ${grund}. Die übertragenen Dateien liegen unverändert an ihrem Platz`,
        ziel: { art: 'LAUF', id: uebertragen.runId },
      });

      this.protokoll(job, uebertragen.runId, 'ERROR', `Konsolidierung fehlgeschlagen: ${grund}`);

      return {
        ...uebertragen,
        status: TransferRunStatus.COMPLETED_WITH_ERRORS,
        message: `${uebertragen.message} — Konsolidierung fehlgeschlagen: ${grund}`,
      };
    }
  }

  private async konsolidiere(
    job: TransferJob,
    uebertragen: TransferRunResult,
    options: TransferExecutionOptions
  ): Promise<TransferRunResult> {
    const jetzt = options.now ?? new Date();
    const laufId = uebertragen.runId;

    if (this.umgebung.features && !this.umgebung.features.isEnabled('CONSOLIDATION')) {
      return this.abgebrochen(
        job,
        uebertragen,
        'Der Workflow hat einen Konsolidierungsschritt, aber diese Installation enthält das Modul ' +
          '„Daten konsolidieren" nicht'
      );
    }

    /*
     * Was der vorige Schritt nicht geliefert hat, kann der nächste nicht
     * verarbeiten. Trotzdem zu konsolidieren hieße, den Bestand des letzten
     * Laufs ein zweites Mal zu verarbeiten — und das Ergebnis sähe frisch aus.
     *
     * Ohne Ausnahme für Workflows ohne Übertragungsschritt: Ein `FAILED` sagt
     * dort, dass die Vorbereitung des Laufs selbst misslang, und auch darauf
     * ist nicht aufzubauen.
     */
    if (uebertragen.status === TransferRunStatus.FAILED) {
      this.protokoll(job, laufId, 'WARNING', 'Konsolidierung übersprungen: Die Übertragung ist fehlgeschlagen');

      return uebertragen;
    }

    const mandant = await this.umgebung.tenants.getById(job.tenantId);
    const wirksam = wirksameEinstellungen(einstellungenDesMandanten(mandant ?? {}), undefined);

    /*
     * Mehrere Durchgänge in Folge (SPEC-06, Abschnitt 7): erst die
     * Filialdateien zusammenlegen, dann das Ergebnis anreichern.
     *
     * Die Reihenfolge ist die Liste und wird nicht hergeleitet — eine
     * hergeleitete Reihenfolge ersetzte eine fachliche Entscheidung. Was daran
     * trotzdem mehrdeutig sein kann, steht vor dem ersten Durchgang im
     * Protokoll: Ein Durchgang, der aus einem Verzeichnis liest, in das ein
     * späterer erst schreibt, läuft beim ersten Mal ins Leere und danach auf
     * den Resten des Vortages. Das sieht monatelang richtig aus.
     */
    const folge = durchgaenge(job.consolidation);

    for (const mangel of pruefeFolge(folge)) {
      this.protokoll(job, laufId, 'WARNING', `Reihenfolge der Konsolidierung: ${mangel.hinweis}`);
    }

    let ergebnis = uebertragen;
    let vorlage: Uebergabe | undefined;

    for (const [stelle, durchgang] of folge.entries()) {
      const durchlaufen = await this.einDurchgang(job, durchgang, {
        uebertragen,
        vorlage,
        laufId,
        jetzt,
        wirksam,
        stelle,
        von: folge.length,
      });

      ergebnis = durchlaufen.lauf;

      /*
       * Ein Durchgang ohne Ergebnis beendet die Folge. Den nächsten trotzdem
       * laufen zu lassen hieße, ihn auf dem zu rechnen, was zufällig noch in
       * seinem Verzeichnis liegt — und das wäre der Bestand von gestern.
       */
      if (!durchlaufen.weiter) {
        break;
      }

      vorlage = durchlaufen.uebergabe;
    }

    return ergebnis;
  }

  /**
   * Ein einzelner Durchgang.
   *
   * Er unterscheidet sich vom nächsten nur darin, woher er liest und wohin er
   * schreibt. Deshalb steht hier kein Sonderfall „der erste": Ein Sonderfall
   * wäre die Stelle, an der eine Regel für den ersten gilt und für die übrigen
   * vergessen wird.
   */
  private async einDurchgang(
    job: TransferJob,
    durchgang: Konsolidierungsdurchgang,
    lage: {
      uebertragen: TransferRunResult;
      vorlage?: Uebergabe;
      laufId: string;
      jetzt: Date;
      wirksam: WirksameEinstellungen;
      stelle: number;
      von: number;
    }
  ): Promise<{ lauf: TransferRunResult; weiter: boolean; uebergabe?: Uebergabe }> {
    const eingang = durchgang.input;

    if (eingang.from !== 'DIRECTORY' || eingang.art !== 'SHARE') {
      return this.durchgangIntern(job, durchgang, lage);
    }

    /*
     * Die Sitzung umschließt den **ganzen** Durchgang und nicht nur das
     * Auflisten: Gelesen werden die Dateien danach, und eine Verbindung, die
     * zwischendurch fällt, ergäbe eine Liste ohne Inhalte.
     */
    if (!this.umgebung.freigaben) {
      this.protokoll(
        job,
        lage.laufId,
        'WARNING',
        `Der Durchgang liest die Freigabe „${eingang.directory}" ohne eigenen Zugang: Es ist keine ` +
          'Freigabeverwaltung eingerichtet. Erreicht wird sie mit dem Konto, unter dem Unikom läuft.'
      );

      return this.durchgangIntern(job, durchgang, lage);
    }

    const zugang = await this.umgebung.freigabezugang?.forShare(job, eingang.credentialId, 'Quelle');

    if (!zugang) {
      this.protokoll(
        job,
        lage.laufId,
        'WARNING',
        `Der Durchgang liest die Freigabe „${eingang.directory}" ohne hinterlegten Zugang. Erreicht wird sie ` +
          'mit dem Konto, unter dem Unikom läuft — beim Kunden selten das gewünschte.'
      );
    }

    return this.umgebung.freigaben.withConnection(eingang.directory, zugang, undefined, () =>
      this.durchgangIntern(job, durchgang, lage)
    );
  }

  private async durchgangIntern(
    job: TransferJob,
    durchgang: Konsolidierungsdurchgang,
    lage: {
      uebertragen: TransferRunResult;
      vorlage?: Uebergabe;
      laufId: string;
      jetzt: Date;
      wirksam: WirksameEinstellungen;
      stelle: number;
      von: number;
    }
  ): Promise<{ lauf: TransferRunResult; weiter: boolean; uebergabe?: Uebergabe }> {
    const { uebertragen, laufId, jetzt, wirksam } = lage;
    const benennung = durchgangsname(durchgang, lage.stelle, lage.von);
    const gefunden = await this.quellen(job, durchgang, lage.vorlage, uebertragen, wirksam, jetzt, laufId);

    /*
     * Was übernommen wurde, wird hinterher weggeräumt — wie der Durchgang auch
     * ausgeht. Sonst bliebe der Stapel im Arbeitsverzeichnis liegen, und beim
     * nächsten Mal stünde dort ein zweiter daneben.
     *
     * Deshalb um den ganzen Durchgang und nicht an jedem Ausgang einzeln: Ein
     * Ausgang, den jemand später hinzufügt, ist genau der, an dem das
     * Wegräumen vergessen wird.
     */
    if (!gefunden.uebernommen) {
      return this.rechne(job, durchgang, lage, gefunden, benennung);
    }

    const uebernommen = gefunden.uebernommen;

    try {
      const ergebnis = await this.rechne(job, durchgang, lage, gefunden, benennung);

      await this.raeumeAus(
        job,
        laufId,
        uebernommen.verzeichnis,
        uebernommen.namen,
        gelungen(ergebnis.lauf) ? durchgang.dateien?.abholung?.erledigt : durchgang.dateien?.abholung?.gescheitert
      );

      return ergebnis;
    } catch (fehler) {
      // Ein Wurf ist der klarste Fehlschlag, den es gibt.
      await this.raeumeAus(
        job,
        laufId,
        uebernommen.verzeichnis,
        uebernommen.namen,
        durchgang.dateien?.abholung?.gescheitert
      );

      throw fehler;
    }
  }

  /** Der Durchgang selbst, ohne das Aufräumen darum. */
  private async rechne(
    job: TransferJob,
    durchgang: Konsolidierungsdurchgang,
    lage: {
      uebertragen: TransferRunResult;
      vorlage?: Uebergabe;
      laufId: string;
      jetzt: Date;
      wirksam: WirksameEinstellungen;
      stelle: number;
      von: number;
    },
    gefunden: Quellenfund,
    benennung: string
  ): Promise<{ lauf: TransferRunResult; weiter: boolean; uebergabe?: Uebergabe }> {
    const { uebertragen, laufId, jetzt, wirksam } = lage;

    for (const hinweis of gefunden.hinweise) {
      this.protokoll(job, laufId, 'INFO', hinweis);
    }

    if (gefunden.quellen.length === 0) {
      return { lauf: await this.ohneQuellen(job, uebertragen, gefunden.hinweise), weiter: false };
    }

    /*
     * Bevor gerechnet wird. Ein Lauf, dem unterwegs der Speicher ausgeht, endet
     * ohne Protokolleintrag — erkannt wird er dann von der
     * Herzschlagüberwachung, die sagen kann, dass ein Prozess fort ist, aber
     * nicht warum.
     */
    const menge = beurteileMenge(datensaetzeIn(gefunden.quellen), this.umgebung.hoechstmenge);

    if (!menge.traegt) {
      return { lauf: await this.abgebrochen(job, uebertragen, menge.grund as string), weiter: false };
    }

    /*
     * Vor dem Konsolidieren: putzen, aufteilen, zusammenführen (SPEC-09 §8, §9).
     *
     * Vorher und nicht nachher — ein Schlüssel über „ Meier" und „Meier" fände
     * zwei Kunden, wo einer ist, und die Zusammenführung, die das hätte heilen
     * sollen, fände dann gar nicht erst statt.
     */
    const umgeformt = wendeUmformungAn(gefunden.quellen, durchgang.umformung);

    for (const hinweis of umgeformt.hinweise) {
      this.protokoll(job, laufId, 'INFO', hinweis);
    }

    const regeln = durchgang.regeln ?? STANDARDREGELN;

    /*
     * Die Referenzquellen zum Lauf lesen (SPEC-04 §6, §8).
     *
     * Sie stehen nicht im Workflow, sondern werden verwaltet — hier steht nur
     * ihre Kennung. Eine Quelle, die sich nicht lesen lässt, hält den Lauf
     * nicht an: Der Abgleich unterbleibt, und **das steht im Protokoll**. Still
     * ohne Referenz weiterzurechnen hieße, dass niemand mehr sieht, warum kein
     * einziger Wert ergänzt wurde.
     */
    const referenzen = await this.referenzenFuer(job, durchgang, laufId, wirksam, jetzt);
    const auftrag = { ...auftragAus(umgeformt.quellen, regeln, wirksam), referenzen };

    /*
     * Blockweise, wo die Menge es verlangt — und in einem Zug, wo nicht. Die
     * Entscheidung trifft der Plan, nicht der Workflow: Sie hängt am
     * Arbeitsspeicher dieser Maschine und nicht daran, was jemand eingestellt
     * hat.
     */
    const bericht = this.umgebung.blockweise
      ? await this.umgebung.blockweise.konsolidiere(auftrag, {
          laufId,
          melde: (stand) => this.protokoll(job, laufId, 'INFO', stand.text),
        })
      : this.umgebung.consolidation.konsolidiere(auftrag);

    /*
     * Was sich nicht umformen ließ, wird ein Konflikt und kein Nebensatz.
     * „Bei nicht eindeutig interpretierbaren Strukturen muss UniCom … den Fall
     * zur Prüfung vorlegen" — und ein Prüffall, der nur im Protokoll steht,
     * wird niemandem vorgelegt.
     */
    mitPruefaellen(bericht, umgeformt.pruefaelle);

    for (const hinweis of bericht.hinweise) {
      this.protokoll(job, laufId, 'INFO', hinweis);
    }

    const faelle = await this.umgebung.conflicts.ausBericht(bericht, {
      tenantId: job.tenantId,
      laufId,
      benutzer: SYSTEMBENUTZER,
      jetzt,
    });

    const kritisch = faelle.filter((fall) => fall.kritikalitaet === 'KRITISCH').length;

    const { stand, urteil } = await this.umgebung.results.schliesseAb({
      tenantId: job.tenantId,
      laufId,
      jobId: job.id,
      bericht,
      eingang: alsEingang(umgeformt.quellen),
      schluessel: regeln.schluessel,
      region: regionAus(wirksam),
      nullWerte: wirksam.nullWerte,
      jahrhundertGrenze: wirksam.jahrhundertGrenze,
      konflikte: { offen: faelle.length, kritischOffen: kritisch },
      jetzt,
    });

    const geschrieben = urteil.frei
      ? await this.schreibeErgebnis(job, durchgang, bericht, jetzt, laufId)
      : undefined;

    await this.meldeErgebnis(job, laufId, stand.id, { faelle: faelle.length, kritisch, frei: urteil.frei, urteil });

    this.protokoll(
      job,
      laufId,
      urteil.frei ? 'INFO' : 'WARNING',
      `${benennung}: ${umgeformt.quellen.length} Quelle(n), ${bericht.zusammenfassung.gelesen} gelesen, ` +
        `${bericht.zeilen.length} im Ergebnis, ${faelle.length} Konfliktfall/-fälle. ${urteil.erklaerung}` +
        (geschrieben ? ` Ergebnisdatei: ${geschrieben}` : '')
    );

    /*
     * Weiter nur aus einem freigegebenen Stand. Ein Ergebnis, das auf eine
     * Entscheidung wartet, darf nicht schon der Eingang des nächsten Durchgangs
     * sein — die Freigabe wäre sonst eine Formalität über etwas, das längst
     * weiterverarbeitet ist.
     */
    return {
      lauf: {
        ...uebertragen,
        status: erfolgsstatus(uebertragen),
        message:
          `${uebertragen.message} — ${lage.von <= 1 ? 'konsolidiert' : benennung}: ` +
          `${bericht.zeilen.length} Datensatz/Datensätze` +
          (faelle.length > 0 ? `, ${faelle.length} Konfliktfall/-fälle` : '') +
          (urteil.frei ? ', freigegeben' : ', wartet auf Freigabe'),
      },
      weiter: urteil.frei,
      uebergabe: geschrieben ? { name: basisname(geschrieben), pfad: geschrieben } : undefined,
    };
  }

  /**
   * Die Referenzbestände eines Durchgangs.
   *
   * Der Bericht nennt später Name und Version jeder benutzten Referenz. Ohne
   * sie wäre die Herkunft eines übernommenen Wertes „irgendeine Referenz" —
   * und ein Lauf, der sich nicht auf eine Version berufen kann, ist nicht
   * reproduzierbar (SPEC-06, Abschnitt 13).
   */
  private async referenzenFuer(
    job: TransferJob,
    durchgang: Konsolidierungsdurchgang,
    laufId: string,
    wirksam: WirksameEinstellungen,
    jetzt: Date
  ): Promise<{ bestand: Referenzbestand; regel: Referenzregel }[]> {
    const verweise = durchgang.regeln?.referenzen ?? [];

    if (verweise.length === 0) {
      return [];
    }

    if (!this.umgebung.referenzen) {
      this.protokoll(
        job,
        laufId,
        'WARNING',
        `${verweise.length} Referenzquelle(n) sind eingestellt, aber diese Installation kann sie nicht lesen. ` +
          'Es wird ohne Referenzabgleich gerechnet'
      );

      return [];
    }

    const wunsch = {
      region: regionAus(wirksam),
      threshold: wirksam.mindestKonfidenz,
      nullValues: wirksam.nullWerte,
      eingelesen: jetzt.toISOString(),
    };

    const geladen: { bestand: Referenzbestand; regel: Referenzregel }[] = [];

    for (const { quelleId, ...regel } of verweise) {
      try {
        const bestand = await this.umgebung.referenzen.fuerLauf(quelleId, wunsch);

        geladen.push({ bestand, regel });

        this.protokoll(
          job,
          laufId,
          'INFO',
          `Referenz „${bestand.name}"${bestand.version ? ` (Version ${bestand.version})` : ''}: ` +
            `${bestand.zeilen.length} Eintrag/Einträge über ${regel.felder.join(', ')}`
        );
      } catch (fehler) {
        this.protokoll(
          job,
          laufId,
          'WARNING',
          `Eine Referenzquelle ließ sich nicht lesen: ${fehler instanceof Error ? fehler.message : String(fehler)}. ` +
            'Dieser Abgleich unterbleibt'
        );
      }
    }

    return geladen;
  }

  /* ---------- Die Quellen ---------- */

  /**
   * Welche Dateien in den Lauf gehen — und woher man das weiß.
   *
   * ```text
   * PRECEDING   die Dateien, die dieser Lauf gerade abgelegt hat
   * DIRECTORY   was im Verzeichnis liegt und zum Muster passt
   * ```
   *
   * Die obere Zeile ist eine **Liste aus diesem Lauf** und keine Momentaufnahme
   * eines Verzeichnisses. Der Unterschied entscheidet: Im Zielverzeichnis liegen
   * auch die Dateien von gestern, und die noch einmal zu konsolidieren ergäbe
   * jede Nacht ein Ergebnis, das um einen Tag zu groß ist.
   */
  private async quellen(
    job: TransferJob,
    schritt: Konsolidierungsdurchgang,
    vorlage: Uebergabe | undefined,
    uebertragen: TransferRunResult,
    wirksam: WirksameEinstellungen,
    jetzt: Date,
    laufId: string
  ): Promise<Quellenfund> {
    const hinweise: string[] = [];
    const quellen: Quelle[] = [];

    const wunsch = {
      region: regionAus(wirksam),
      threshold: wirksam.mindestKonfidenz,
      nullValues: wirksam.nullWerte,
      blatt: schritt.dateien?.blatt,
      eingelesen: jetzt.toISOString(),
    };

    /*
     * Geprüft wird vor der Verarbeitung (SPEC-08, Abschnitt 2) und je Lauf mit
     * demselben Prüfer: Das Schema wird einmal gelesen und nicht je Datei.
     */
    /*
     * Nur bei einer Schemadatei. Ein Schritt, der ein **Eingangsprofil** nennt,
     * bekommt hier noch keinen Prüfer: Die Regeln des Profils wertet der Lauf
     * noch nicht aus. Einen Prüfer ohne Datei zu bauen hieße, ihn bei jeder
     * Datei melden zu lassen, dass sich das Schema „undefined" nicht lesen
     * lässt — eine Warnung je Datei und je Nacht, für eine Einstellung, die in
     * Ordnung ist.
     */
    const pruefer = schritt.schema?.datei
      ? new Schemapruefer(this.umgebung.ablage, { datei: schritt.schema.datei, bei: schritt.schema.bei })
      : undefined;

    const eingang = await this.dateien(job, schritt, vorlage, uebertragen, hinweise, laufId, jetzt);

    for (const datei of eingang.dateien) {
      try {
        const bytes = await this.umgebung.ablage.lies(datei.pfad);

        if (pruefer) {
          const befund = await pruefer.pruefe({ name: datei.name, bytes });

          hinweise.push(...befund.hinweise);

          if (!befund.brauchbar) {
            continue;
          }
        }

        const gelesen = liesDatei({ name: datei.name, bytes, geaendert: datei.geaendert }, wunsch);

        quellen.push(...gelesen.quellen);
        hinweise.push(...gelesen.hinweise);
      } catch (fehler) {
        /*
         * Eine unlesbare Datei macht die übrigen nicht wertlos — aber sie
         * verschwindet auch nicht. Sie steht im Protokoll, und die
         * Verbleibsrechnung der Ergebnisprüfung sieht am Ende, dass etwas fehlt.
         */
        hinweise.push(
          `„${datei.name}" ließ sich nicht lesen: ${fehler instanceof Error ? fehler.message : String(fehler)}`
        );
      }
    }

    return { quellen, hinweise, uebernommen: eingang.uebernommen };
  }

  /**
   * Der Stapel: prüfen, zugreifen, oder gar nichts.
   *
   * ## Das Verschieben ist der Zugriff
   *
   * Ist der Stapel vollständig, wandern **genau diese** Dateien in ein
   * Arbeitsverzeichnis, bevor eine davon gelesen wird. Was danach im
   * Abholverzeichnis ankommt, gehört zum nächsten Stapel und kann nicht halb
   * mitkommen. Ohne Arbeitsverzeichnis wird aus dem Abholverzeichnis gelesen —
   * das geht, ist aber ein offenes Risiko, und der Lauf sagt es.
   *
   * ## Alles oder nichts
   *
   * Scheitert das Verschieben einer Datei, wird nichts konsolidiert. Die schon
   * verschobenen bleiben im Arbeitsverzeichnis liegen; sie von Hand
   * zurückzulegen ist eine Minute Arbeit, ein Ergebnis aus zwei Dritteln eines
   * Stapels kostet einen Monatsabschluss.
   */
  private async stapelDateien(
    job: TransferJob,
    schritt: Konsolidierungsdurchgang,
    verzeichnis: string,
    genommen: Verzeichniseintrag[],
    hinweise: string[],
    laufId: string,
    jetzt: Date
  ): Promise<Eingang> {
    const bedingung = schritt.dateien!.stapel!;
    const reife = (schritt.dateien?.reifeSekunden ?? 0) * 1000;

    /*
     * Das Stapelmerkmal steht im Dateinamen — dort, wo `{stapel}` im Muster
     * steht. Es wird nichts aufgemacht: Ob eine Datei zu diesem Stapel gehört,
     * steht an ihr dran, und wer Tageslieferungen bekommt, hat das Datum
     * ohnehin im Namen.
     */
    const beschrieben: Stapeldatei[] = genommen.map((eintrag) => ({
      name: eintrag.name,
      geaendert: eintrag.geaendert ? new Date(eintrag.geaendert) : undefined,
      // Ohne Änderungszeitpunkt lässt sich die Reife nicht beurteilen; dann
      // gilt die Datei als fertig, so wie ohne Wartezeit.
      fertig: reife <= 0 || !eintrag.geaendert ? true : jetzt.getTime() - new Date(eintrag.geaendert).getTime() >= reife,
    }));

    const aufteilung = stapelgruppen(beschrieben, bedingung, jetzt);

    for (const mangel of aufteilung.maengel) {
      // Ein Einrichtungsfehler und keine ausgebliebene Lieferung: Er wird nicht
      // dadurch besser, dass jemand wartet.
      this.protokoll(job, laufId, 'WARNING', mangel);
    }

    if (aufteilung.ohneSchluessel.length > 0) {
      hinweise.push(
        'Keinem Stapel zugeordnet, weil aus dem Namen kein Merkmal zu lesen war: ' +
          aufteilung.ohneSchluessel.join(', ')
      );
    }

    /*
     * Je Lauf **eine** Gruppe. Zwei in einem Lauf zu nehmen hieße, sie in einem
     * Ergebnis zusammenzulegen — genau das, was der Schlüssel verhindern soll.
     * Die nächste kommt beim nächsten Blick des Workers.
     */
    const fertige = aufteilung.gruppen.find((gruppe) => gruppe.stand.vollstaendig);
    const stand = fertige ? fertige.stand : aufteilung.gruppen[0]?.stand;

    if (!stand) {
      hinweise.push('Im Abholverzeichnis liegt keine Datei, die zu einem Stapel gehört.');

      return { dateien: [] };
    }

    if (fertige && aufteilung.gruppen.length > 1) {
      hinweise.push(
        `${aufteilung.gruppen.length - 1} weitere(r) Stapel liegt/liegen im Abholverzeichnis und kommt/kommen ` +
          'in einem eigenen Lauf an die Reihe'
      );
    }

    if (!stand.vollstaendig) {
      const meldung =
        (fertigeGruppenname(aufteilung.gruppen[0]) ?? '') + stapelmeldung(stand);

      if (!stand.abgelaufen) {
        // Kein Fehler: Der Stapel ist noch im Entstehen. Beim nächsten Blick
        // des Workers sieht es anders aus.
        hinweise.push(`Der Stapel ist noch nicht vollständig — ${meldung}. Es wird gewartet.`);

        return { dateien: [] };
      }

      /*
       * Die Frist ist verstrichen. Der Stapel wird verworfen und nach
       * „Gescheitert" geräumt, damit das Abholverzeichnis für den nächsten frei
       * ist — eine liegengebliebene Datei würde sonst jeden folgenden Stapel
       * verunreinigen.
       */
      this.protokoll(
        job,
        laufId,
        'ERROR',
        `Der Stapel in „${verzeichnis}" ist nach Ablauf der Frist unvollständig — ${meldung}. ` +
          'Er wird verworfen und nicht verarbeitet.'
      );

      /*
       * Nur **dieser** Stapel, nicht das Verzeichnis. Liegt daneben ein
       * zweiter, dessen Frist noch laeuft, duerfen seine Dateien nicht
       * mitgehen — sonst naehme ein alter, nie fertig gewordener Stapel jede
       * Nacht einen frischen mit.
       */
      await this.raeumeAus(
        job,
        laufId,
        verzeichnis,
        stand.zugeordnet,
        schritt.dateien?.abholung?.gescheitert
      );

      await this.melde(job, 'STAPEL_VERWORFEN', {
        titel: `Unvollständiger Stapel verworfen (${job.name})`,
        text:
          `Im Abholverzeichnis „${verzeichnis}" war der Stapel nach Ablauf der Frist unvollständig: ` +
          `${meldung}. Er wurde nicht verarbeitet und liegt jetzt bei den gescheiterten Stapeln.`,
      });
      hinweise.push(`Stapel verworfen: ${meldung}`);

      return { dateien: [] };
    }

    for (const hinweis of [
      stand.fremd.length > 0 ? `Ohne Platz im Stapel und deshalb nicht dabei: ${stand.fremd.join(', ')}` : undefined,
      stand.unfertig.length > 0 ? `Noch im Schreiben und deshalb nicht dabei: ${stand.unfertig.join(', ')}` : undefined,
    ]) {
      if (hinweis) {
        hinweise.push(hinweis);
      }
    }

    const arbeit = schritt.dateien?.abholung?.arbeit;

    if (!arbeit) {
      hinweise.push(
        'Der Stapel wird aus dem Abholverzeichnis gelesen: Es ist kein Arbeitsverzeichnis eingetragen. ' +
          'Eine Datei, die während des Laufs ankommt, kann dann nicht sicher ausgeschlossen werden.'
      );

      /*
       * Ohne Arbeitsverzeichnis wird nicht übernommen — und deshalb hinterher
       * auch nichts weggeräumt. Dateien aus dem Abholverzeichnis zu räumen, die
       * man nie herausgenommen hat, wäre der Griff nach einem Stapel, der
       * inzwischen ein anderer sein kann.
       */
      return { dateien: this.alsQuellen(verzeichnis, stand.stapel, genommen) };
    }

    const ziel = this.umgebung.ablage.pfad(arbeit, laufId);

    for (const name of stand.stapel) {
      await this.umgebung.ablage.verschiebe(
        this.umgebung.ablage.pfad(verzeichnis, name),
        this.umgebung.ablage.pfad(ziel, name)
      );
    }

    hinweise.push(`Stapel vollständig (${stand.stapel.length} Datei(en)), zur Verarbeitung übernommen`);

    return {
      dateien: this.alsQuellen(ziel, stand.stapel, genommen),
      uebernommen: { verzeichnis: ziel, namen: [...stand.stapel] },
    };
  }

  /** Aus Namen werden Pfade — der Änderungszeitpunkt bleibt der der Quelle. */
  private alsQuellen(
    verzeichnis: string,
    namen: readonly string[],
    eintraege: readonly Verzeichniseintrag[]
  ): { name: string; pfad: string; geaendert?: string }[] {
    return namen.map((name) => ({
      name,
      pfad: this.umgebung.ablage.pfad(verzeichnis, name),
      geaendert: eintraege.find((eintrag) => eintrag.name === name)?.geaendert,
    }));
  }

  /**
   * Räumt Eingangsdateien fort.
   *
   * Ohne Zielverzeichnis bleiben sie liegen — und das wird gesagt. Still
   * liegenzulassen wäre der Fall, in dem derselbe Stapel morgen wieder
   * verworfen wird, und übermorgen auch.
   */
  private async raeumeAus(
    job: TransferJob,
    laufId: string,
    verzeichnis: string,
    namen: readonly string[],
    nach: string | undefined
  ): Promise<void> {
    if (!nach) {
      this.protokoll(
        job,
        laufId,
        'WARNING',
        `Die Dateien bleiben in „${verzeichnis}" liegen: Es ist kein Zielverzeichnis eingetragen. ` +
          'Beim nächsten Lauf stehen sie wieder da.'
      );

      return;
    }

    for (const name of namen) {
      try {
        await this.umgebung.ablage.verschiebe(
          this.umgebung.ablage.pfad(verzeichnis, name),
          this.umgebung.ablage.pfad(nach, name)
        );
      } catch (fehler) {
        // Eine Datei, die sich nicht wegräumen lässt, darf das Ergebnis nicht
        // mitreißen — es ist schon geschrieben.
        this.protokoll(
          job,
          laufId,
          'WARNING',
          `„${name}" ließ sich nicht nach „${nach}" verschieben: ${(fehler as Error).message}`
        );
      }
    }
  }

  private async dateien(
    job: TransferJob,
    schritt: Konsolidierungsdurchgang,
    vorlage: Uebergabe | undefined,
    uebertragen: TransferRunResult,
    hinweise: string[],
    laufId: string,
    jetzt: Date
  ): Promise<Eingang> {
    const muster = schritt.dateien?.muster;
    const endungen = schritt.dateien?.endungen;

    /*
     * Der Vorgänger ist ab dem zweiten Durchgang die Datei, die der Durchgang
     * davor geschrieben hat — und nicht mehr das, was die Übertragung abgelegt
     * hat. Sonst rechnete jeder Durchgang wieder auf dem Rohbestand, und die
     * Folge wäre keine.
     */
    if (schritt.input.from === 'PRECEDING' && vorlage) {
      return { dateien: [vorlage] };
    }

    if (schritt.input.from === 'DIRECTORY') {
      const verzeichnis = schritt.input.directory;
      const eintraege = await this.umgebung.ablage.liste(verzeichnis);
      const genommen = eintraege.filter(
        (eintrag) =>
          istLesbar(eintrag.name) && passtEndung(eintrag.name, endungen) && passt(eintrag.name, muster)
      );

      if (genommen.length < eintraege.length) {
        /*
         * Der Grund steht im Protokoll, und zwar der, den der Einrichter
         * eingetragen hat. „Kein lesbares Format" bei einer CSV, die nur nicht
         * zur Auswahl gehört, schickte die Ferndiagnose in die falsche Ecke.
         */
        const gruende = [
          endungen?.length ? `sind nicht ${endungen.join(', ')}` : undefined,
          muster ? `passen nicht zu „${muster}"` : undefined,
          'haben kein lesbares Format',
        ].filter((grund): grund is string => grund !== undefined);

        hinweise.push(
          `${eintraege.length - genommen.length} Datei(en) in „${verzeichnis}" wurden übergangen: ` +
            `Sie ${gruende.join(' oder ')}`
        );
      }

      /*
       * Ein Zusammenführen mit Stapelbedingung beginnt erst, wenn der Stapel
       * vollständig ist. Ohne Bedingung bleibt es beim Bisherigen: Was da ist,
       * wird genommen.
       */
      if (schritt.dateien?.stapel) {
        return this.stapelDateien(job, schritt, verzeichnis, genommen, hinweise, laufId, jetzt);
      }

      return {
        dateien: genommen.map((eintrag) => ({
          name: eintrag.name,
          pfad: this.umgebung.ablage.pfad(verzeichnis, eintrag.name),
          geaendert: eintrag.geaendert,
        })),
      };
    }

    /*
     * Aus dem vorangehenden Schritt. Liegt dessen Ziel auf einem fremden Server,
     * gibt es hier nichts zu lesen: Die Konsolidierung arbeitet auf dem
     * Dateisystem dieses Rechners. Das ist eine Grenze und keine Panne — sie
     * gehört benannt, statt in einem leeren Ergebnis zu enden.
     */
    if (job.destinationType === 'SFTP' || job.destinationType === 'FTPS') {
      hinweise.push(
        `Der vorangehende Schritt legt seine Dateien auf einem entfernten Server ab (${job.destinationType}). ` +
          'Die Konsolidierung liest örtlich — trage ihr ein Verzeichnis ein, statt sie an den Schritt davor zu hängen'
      );

      return { dateien: [] };
    }

    return {
      dateien: uebertragen.outcomes
        .filter((ergebnis) => ergebnis.status === FileTransferStatus.SUCCESS && ergebnis.destinationPath)
        .filter((ergebnis) => istLesbar(ergebnis.filename) && passt(ergebnis.filename, muster))
        .map((ergebnis) => ({ name: ergebnis.filename, pfad: ergebnis.destinationPath as string })),
    };
  }

  /* ---------- Das Ergebnis ---------- */

  /**
   * Die Ergebnisdatei — und nur aus einem freigegebenen Stand.
   *
   * Ein Ergebnis, das auf eine Entscheidung wartet, darf nicht schon als Datei
   * im Verzeichnis liegen: Von dort holt es der Nächste ab, und die Freigabe
   * wäre eine Formalität über etwas, das längst unterwegs ist.
   */
  private async schreibeErgebnis(
    job: TransferJob,
    durchgang: Konsolidierungsdurchgang,
    bericht: Konsolidierungsbericht,
    jetzt: Date,
    laufId: string
  ): Promise<string | undefined> {
    const ausgabe = durchgang.output;

    if (ausgabe?.to !== 'DIRECTORY') {
      return undefined;
    }

    const zeilen = bericht.zeilen.map((zeile) => zeile.werte);
    const name = ergebnisdateiname(job.name, jetzt, durchgang.format === 'FESTBREITEN' ? '.txt' : '.csv');
    const pfad = this.umgebung.ablage.pfad(ausgabe.directory, name);

    if (durchgang.format !== 'FESTBREITEN') {
      await this.umgebung.ablage.schreibe(pfad, alsBytes(schreibeCsv(bericht.felder, zeilen)));

      return pfad;
    }

    /*
     * Feste Feldbreiten, weil die Gegenseite es so liest (SPEC-03, Abschnitt 6).
     *
     * Ohne Feldbeschreibung wird **nicht** geschrieben und auch nicht auf CSV
     * ausgewichen: Ein Empfänger, der eine Datei fester Breite erwartet und
     * eine CSV bekommt, liest sie als eine einzige, sehr breite Spalte — und
     * das sieht nach kaputten Daten aus, nicht nach einer falschen Einstellung.
     */
    const felder = durchgang.festbreiten?.felder ?? [];

    if (felder.length === 0) {
      this.protokoll(
        job,
        laufId,
        'WARNING',
        'Für die Ausgabe mit festen Feldbreiten fehlt die Feldbeschreibung. Es wurde keine Datei geschrieben — ' +
          'das Ergebnis liegt im Ergebnisstand und lässt sich von dort holen'
      );

      return undefined;
    }

    const gebaut = schreibeFixedWidth(bericht.felder, zeilen, {
      felder,
      kopfzeile: durchgang.festbreiten?.kopfzeile,
    });

    /*
     * Ein Wert, der nicht ins Feld passt, wird nicht heimlich gekürzt — er
     * fehlt in der Datei und steht hier. Aus „Meiersheimer-Krüger" würde sonst
     * „Meiersheimer-Kr", und das sähe der Empfänger als vollständigen Namen an.
     */
    for (const ueberlauf of gebaut.ueberlaeufe.slice(0, ZEIGE_UEBERLAEUFE)) {
      this.protokoll(
        job,
        laufId,
        'WARNING',
        `Zeile ${ueberlauf.zeile}, Feld „${ueberlauf.feld}": „${ueberlauf.wert}" ist ${ueberlauf.laenge} Zeichen ` +
          `lang, das Feld fasst ${ueberlauf.erlaubt}. Das Feld bleibt leer`
      );
    }

    if (gebaut.ueberlaeufe.length > ZEIGE_UEBERLAEUFE) {
      this.protokoll(
        job,
        laufId,
        'WARNING',
        `${gebaut.ueberlaeufe.length} Werte passten nicht in ihr Feld; die ersten ${ZEIGE_UEBERLAEUFE} stehen oben`
      );
    }

    await this.umgebung.ablage.schreibe(pfad, alsBytes(gebaut.text));

    return pfad;
  }

  /* ---------- Melden und protokollieren ---------- */

  private async meldeErgebnis(
    job: TransferJob,
    laufId: string,
    standId: string,
    stand: { faelle: number; kritisch: number; frei: boolean; urteil: { erklaerung: string; hindernisse: string[] } }
  ): Promise<void> {
    if (stand.faelle > 0) {
      await this.melde(job, 'KONFLIKTE_ENTSTANDEN', {
        titel: `${stand.faelle} Konfliktdatensatz/-sätze müssen bearbeitet werden (${job.name})`,
        text:
          `Der Lauf hat ${stand.faelle} Fall/Fälle hinterlassen, davon ${stand.kritisch} kritisch. ` +
          'Sie stehen in der Konfliktbearbeitung; das Ergebnis bleibt bis dahin unverändert',
        ziel: { art: 'KONFLIKTE', id: laufId },
      });
    }

    if (!stand.frei) {
      await this.melde(job, 'FREIGABE_ERFORDERLICH', {
        titel: `Ergebnis wartet auf Freigabe (${job.name})`,
        text: `${stand.urteil.erklaerung} Offen: ${stand.urteil.hindernisse.join('; ') || 'siehe Ergebnisansicht'}`,
        ziel: { art: 'ERGEBNIS', id: standId },
      });
    }

    /*
     * Nur, wenn wirklich nichts anliegt. Wer neben zwölf Konflikten auch noch
     * „erfolgreich abgeschlossen" liest, lernt, die Glocke zu übersehen.
     *
     * Beide Bedingungen stehen hier und nicht als vorzeitiges Verlassen weiter
     * oben: Ein Mandant kann einstellen, dass Konflikte die Freigabe nicht
     * aufhalten (`konflikteBlockieren: false`). Dann ist ein Lauf freigegeben
     * **und** hat offene Fälle — und genau dieser Fall verschwände hinter einem
     * `return`, das nur an die Freigabe denkt.
     */
    if (stand.frei && stand.faelle === 0) {
      await this.melde(job, 'LAUF_ERFOLGREICH', {
        titel: `Verarbeitung erfolgreich abgeschlossen (${job.name})`,
        text: stand.urteil.erklaerung,
        ziel: { art: 'ERGEBNIS', id: standId },
      });
    }
  }

  private async melde(
    job: TransferJob,
    anlass: Parameters<BackgroundService['melde']>[1],
    teile: Parameters<BackgroundService['melde']>[2]
  ): Promise<void> {
    await this.umgebung.background?.melde(job.tenantId, anlass, teile);
  }

  private protokoll(job: TransferJob, laufId: string, level: 'INFO' | 'WARNING' | 'ERROR', message: string): void {
    this.umgebung.logger?.log({ timestamp: new Date(), level, runId: laufId, jobId: job.id, message });
  }

  private async abgebrochen(
    job: TransferJob,
    uebertragen: TransferRunResult,
    grund: string
  ): Promise<TransferRunResult> {
    this.protokoll(job, uebertragen.runId, 'ERROR', grund);

    await this.melde(job, 'LAUF_FEHLER', {
      titel: `Konsolidierung nicht ausgeführt (${job.name})`,
      text: grund,
      ziel: { art: 'LAUF', id: uebertragen.runId },
    });

    return {
      ...uebertragen,
      status: TransferRunStatus.COMPLETED_WITH_ERRORS,
      message: `${uebertragen.message} — ${grund}`,
    };
  }

  /**
   * Kein Lauf ohne Quelle.
   *
   * Das ist ausdrücklich **kein** Fehler: Ein Workflow, der jede Nacht in ein
   * Verzeichnis sieht, findet dort oft nichts. Eine kritische Meldung dafür wäre
   * eine Meldung, die jede Nacht kommt — und die man nach einer Woche
   * wegklickt, ohne sie zu lesen.
   */
  private async ohneQuellen(
    job: TransferJob,
    uebertragen: TransferRunResult,
    hinweise: string[]
  ): Promise<TransferRunResult> {
    this.protokoll(job, uebertragen.runId, 'INFO', 'Konsolidierung: keine Quelle gefunden, nichts zu tun');

    return {
      ...uebertragen,
      status:
        uebertragen.status === TransferRunStatus.FAILED ? uebertragen.status : TransferRunStatus.SUCCESS_NO_FILES,
      message: `${uebertragen.message} — konsolidiert wurde nichts: keine lesbare Quelle${
        hinweise.length > 0 ? ` (${hinweise[0]})` : ''
      }`,
    };
  }
}

/**
 * Der Status nach einer gelungenen Konsolidierung.
 *
 * Ein Lauf, dessen Übertragung nichts fand, dessen Konsolidierung aber ein
 * Verzeichnis abgearbeitet hat, ist nicht „ohne Dateien" — er hat gearbeitet.
 * Was die Übertragung an Fehlern hinterließ, bleibt dagegen stehen: Die
 * Konsolidierung kann sie nicht heilen.
 */
function erfolgsstatus(uebertragen: TransferRunResult): TransferRunStatus {
  const bleibt = [
    TransferRunStatus.FAILED,
    TransferRunStatus.COMPLETED_WITH_ERRORS,
    TransferRunStatus.CANCELLED,
  ];

  return bleibt.includes(uebertragen.status) ? uebertragen.status : TransferRunStatus.SUCCESS;
}

/**
 * Der Auftrag aus den gespeicherten Regeln.
 *
 * Die Mindestkonfidenz kommt aus der Hierarchie und nicht aus den Regeln. Wer
 * sie am Workflow senken dürfte, könnte sich eine automatische Entscheidung
 * bestellen, die im Prüflauf noch ein Konflikt war.
 */
export function auftragAus(
  quellen: readonly Quelle[],
  regeln: Konsolidierungsregeln,
  wirksam: WirksameEinstellungen
): Konsolidierungsauftrag {
  return {
    quellen,
    betriebsart: regeln.betriebsart,
    art: regeln.art,
    fuehrend: kennungFuer(quellen, regeln.fuehrend),
    schluessel: regeln.schluessel,
    zielfelder: regeln.zielfelder,
    entscheidung: {
      ...regeln.entscheidung,
      quellen: regeln.entscheidung?.quellen?.map((name) => kennungFuer(quellen, name) as string),
      jeFeld: jeFeldMitKennungen(quellen, regeln.entscheidung?.jeFeld),
      mindestKonfidenz: wirksam.mindestKonfidenz,
    },
    dubletten: regeln.dubletten,
    mehrfachtreffer: regeln.mehrfachtreffer,
    ohneHauptsatz: regeln.ohneHauptsatz,
    ergaenzung: regeln.ergaenzung,
    aehnlichkeit: regeln.aehnlichkeit,
  };
}

/** Dieselbe Übersetzung für die feldweisen Rangfolgen. */
function jeFeldMitKennungen(
  quellen: readonly Quelle[],
  jeFeld?: Readonly<Record<string, readonly string[]>>
): Record<string, string[]> | undefined {
  if (!jeFeld) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(jeFeld).map(([feld, reihenfolge]) => [
      feld,
      reihenfolge.map((name) => kennungFuer(quellen, name) as string),
    ])
  );
}

/**
 * Im Workflow stehen **Dateinamen**, im Auftrag **Quellenkennungen**.
 *
 * Bei einer CSV sind das dieselben Zeichenketten; bei einem Blatt einer
 * Arbeitsmappe heißt die Quelle `Filialen.xlsx#Nord`. Ohne diese Übersetzung
 * liefe jede Rangfolge, die auf eine Mappe zeigt, ins Leere — und zwar
 * stillschweigend: Eine Quelle, die in keiner Reihenfolge vorkommt, ist einfach
 * die letzte.
 *
 * Findet sich der Name nicht, wird er unverändert weitergereicht. Bei der
 * führenden Quelle meldet die Konsolidierung das als fehlende Hauptdatei mit
 * Ursache und nächsten Schritten; ihn hier fallen zu lassen, machte aus einem
 * Anreichern ein Sammeln — und das Ergebnis sähe richtig aus.
 */
export function kennungFuer(quellen: readonly Quelle[], name?: string): string | undefined {
  if (!name) {
    return undefined;
  }

  return quellen.find((quelle) => quelle.id === name || quelle.name === name)?.id ?? name;
}

/**
 * Was hineinging — für die Verbleibsrechnung der Ergebnisprüfung.
 *
 * Die Felder sind die Vereinigung aller Quellfelder, und jede Zeile wird darauf
 * ausgerichtet. Einfach aneinanderzuhängen wäre falsch, sobald zwei Quellen ihre
 * Spalten in verschiedener Reihenfolge führen — und genau das ist der Normalfall
 * bei Dateien aus zwei Systemen.
 */
export function alsEingang(quellen: readonly Quelle[]): { felder: string[]; zeilen: string[][] } {
  const felder: string[] = [];

  for (const quelle of quellen) {
    for (const feld of quelle.felder) {
      if (!felder.includes(feld)) {
        felder.push(feld);
      }
    }
  }

  const zeilen: string[][] = [];

  for (const quelle of quellen) {
    const stellen = felder.map((feld) => quelle.felder.indexOf(feld));

    for (const zeile of quelle.zeilen) {
      zeilen.push(stellen.map((stelle) => (stelle === -1 ? '' : (zeile[stelle] ?? ''))));
    }
  }

  return { felder, zeilen };
}

/**
 * Zeichen, die in einem Windows-Dateinamen nichts zu suchen haben.
 *
 * Als Menge und nicht als regulärer Ausdruck: Ein Zeichenvorrat, in dem der
 * Rückstrich selbst maskiert werden muss, ist die Stelle, an der beim nächsten
 * Bearbeiten ein Zeichen verlorengeht.
 */
const VERBOTEN = new Set(['<', '>', ':', '"', '/', String.fromCharCode(92), '|', '?', '*']);

/**
 * Ein Dateiname, der den Lauf benennt und auf jedem Dateisystem entsteht.
 *
 * Der Zeitstempel gehört dazu: Ohne ihn überschriebe der Lauf von heute den von
 * gestern, und die Frage „was stand da eigentlich drin" wäre nicht mehr zu
 * beantworten.
 */
export function ergebnisdateiname(workflow: string, jetzt: Date, endung = '.csv'): string {
  const zwei = (wert: number): string => String(wert).padStart(2, '0');
  const stempel =
    `${jetzt.getFullYear()}${zwei(jetzt.getMonth() + 1)}${zwei(jetzt.getDate())}_` +
    `${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}${zwei(jetzt.getSeconds())}`;

  const sauber = [...workflow]
    .map((zeichen) => (VERBOTEN.has(zeichen) || zeichen.charCodeAt(0) < 32 ? '_' : zeichen))
    .join('')
    .trim();

  return `${sauber || 'Workflow'}_Ergebnis_${stempel}${endung}`;
}

/**
 * Die Umformungsfälle in den Bericht.
 *
 * Und die Zahl gleich mit: Ohne sie nennte der Bericht eine Konfliktzahl, die
 * kleiner ist als seine eigene Konfliktliste — und niemand wüsste, welche von
 * beiden gilt. Der Bericht wird dabei **verändert** und nicht kopiert; er ist
 * zu diesem Zeitpunkt schon groß, und eine zweite Fassung daneben wäre bei
 * einer Million Zeilen kein Detail mehr.
 */
export function mitPruefaellen(
  bericht: Konsolidierungsbericht,
  pruefaelle: readonly Umformungspruefall[]
): Konsolidierungsbericht {
  for (const fall of pruefaelle) {
    bericht.konflikte.push(alsKonflikt(fall));
  }

  bericht.zusammenfassung.konflikte = bericht.konflikte.length;

  return bericht;
}

/**
 * Ein Umformungsfall als Konflikt.
 *
 * Er trägt dieselben Felder wie jeder andere: betroffene Quelle, Zeile, Feld,
 * erwarteter Zustand, vorgefundener Zustand, Ursache, nächste Schritte. Ein
 * eigenes, ärmeres Format für Umformungen ergäbe eine Konfliktliste, in der die
 * Hälfte der Einträge weniger sagt als die andere.
 */
function alsKonflikt(fall: Umformungspruefall): Konsolidierungsbericht['konflikte'][number] {
  return {
    art: 'STRUKTUR',
    quelle: fall.quelle,
    zeile: fall.zeile,
    feld: fall.feld,
    erwartet: 'Der Wert lässt sich nach der eingestellten Regel umformen',
    vorgefunden: `„${fall.wert}"`,
    ursache: fall.hinweis,
    naechsteSchritte:
      'Die Umformungsregel am Konsolidierungsschritt anpassen oder den Wert in der Quelle berichtigen. ' +
      'Übernommen wurde nichts — abgeschnitten sähe das Ergebnis untadelig aus und wäre falsch',
  };
}

/**
 * Was ein Durchgang dem nächsten übergibt: die Datei, die er geschrieben hat.
 *
 * Nicht der Bericht und nicht der Ergebnisstand — der nächste Durchgang liest
 * mit demselben Leser wie der erste. Ein zweiter Weg in die Konsolidierung
 * hinein wäre einer, der eines Tages anders liest als der erste.
 */
interface Uebergabe {
  name: string;
  pfad: string;
}

/**
 * Wie ein Durchgang in Protokoll und Meldung heißt.
 *
 * Bei einem einzigen bleibt es bei „Konsolidierung" — eine Nummer, wo es nichts
 * zu nummerieren gibt, sieht nach einem Fehler aus.
 */
/**
 * Wie eine Gruppe in einer Meldung heißt.
 *
 * Ohne Schlüssel gibt es nur eine, und dann wäre ein Vorspann Lärm. Mit
 * Schlüssel gehört er davor: „Stapel 2026-08-20: es fehlt ‚Filiale Süd'" sagt
 * *welcher* Stapel — bei zwei Stapeln im Verzeichnis ist das die halbe Auskunft.
 */
function fertigeGruppenname(gruppe: Stapelgruppe | undefined): string | undefined {
  return gruppe?.schluessel ? `Stapel „${gruppe.schluessel}": ` : undefined;
}

/**
 * Ob ein Durchgang gelungen ist.
 *
 * Ein Teilerfolg zählt **nicht** als gelungen: Wenn ein Teil der Daten nicht
 * durchkam, gehören die Eingangsdateien dorthin, wo man sie wiederfindet und
 * erneut einspielen kann.
 */
function gelungen(lauf: TransferRunResult): boolean {
  return lauf.status === TransferRunStatus.SUCCESS || lauf.status === TransferRunStatus.SUCCESS_NO_FILES;
}

function durchgangsname(durchgang: Konsolidierungsdurchgang, stelle: number, von: number): string {
  if (von <= 1) {
    return 'Konsolidierung';
  }

  const eigen = durchgang.name?.trim();

  return `Durchgang ${stelle + 1} von ${von}${eigen ? ` (${eigen})` : ''}`;
}

/** Der Dateiname aus einem Pfad — mit beiden Trennzeichen, die vorkommen. */
function basisname(pfad: string): string {
  const trenner = Math.max(pfad.lastIndexOf('/'), pfad.lastIndexOf(String.fromCharCode(92)));

  return trenner === -1 ? pfad : pfad.slice(trenner + 1);
}
