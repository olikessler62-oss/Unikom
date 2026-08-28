import { randomUUID } from 'node:crypto';

import type { Logger } from '../../domain/logging/LogEntry.js';
import type { Ergebnisbestand, Ergebnisstand } from '../../domain/result/Ergebnisstand.js';
import { istGueltig } from '../../domain/result/Ergebnisstand.js';
import { zurUebergabe, type Modulzugang, type Uebergabe } from '../../domain/result/Uebergabe.js';
import {
  beurteileFreigabe,
  darfManuellFreigeben,
  type Bedingungsstand,
  type Freigabebedingungen,
  type Freigabeurteil,
  type Freigabevermerk,
} from '../../domain/result/Freigabe.js';
import {
  pruefeErgebnis,
  type Ergebnispruefung,
  type Pruefauftrag,
  type Pruefmassstaebe,
  type Zielfeld,
} from '../../domain/result/Ergebnispruefung.js';
import type { Schluessel } from '../../domain/consolidation/Schluessel.js';
import type { Qualitaetsregel } from '../../domain/quality/Regeln.js';
import type { Region } from '../../domain/tenants/Region.js';
import type { Konsolidierungsbericht } from '../consolidation/ConsolidationService.js';

/**
 * Validierung und Freigabe (Etappe 7, SPEC-08 §10 bis §13).
 *
 * ```text
 * Bericht  →  prüfen  →  beurteilen  ─┬─ nichts dagegen  →  freigegeben
 *                                     └─ etwas dagegen   →  WAITING_FOR_RELEASE
 * ```
 *
 * Der Dienst legt für jeden Lauf **einen eigenen Ergebnisstand** an und ändert
 * keinen bestehenden. Auch die Wiederherstellung eines früheren erzeugt einen
 * neuen — sonst verschwände die Zwischenzeit aus der Geschichte.
 */
export interface Abschlussauftrag {
  tenantId: string;
  laufId: string;
  /** Der Workflow, aus dem der Lauf stammt — er bleibt am Ergebnisstand. */
  jobId: string;
  /** Der Lauf, auf dem dieser aufsetzt. */
  ausLauf?: string;
  bericht: Konsolidierungsbericht;
  /** Was hineinging — für den Vergleich mit dem Ergebnis. */
  eingang: { felder: readonly string[]; zeilen: readonly (readonly string[])[] };
  zielstruktur?: readonly Zielfeld[];
  schluessel?: Schluessel;
  region: Region;
  nullWerte?: readonly string[];
  jahrhundertGrenze?: number;
  qualitaet?: readonly Qualitaetsregel[];
  massstaebe?: Pruefmassstaebe;
  bedingungen?: Freigabebedingungen;
  /** Offene Konfliktfälle aus SPEC-07. */
  konflikte?: { offen: number; kritischOffen: number };
  jetzt?: Date;
}

export interface Abschluss {
  stand: Ergebnisstand;
  urteil: Freigabeurteil;
}

export class ResultService {
  constructor(
    private readonly bestand: Ergebnisbestand,
    private readonly logger?: Logger
  ) {}

  /**
   * Einen Lauf abschließen: prüfen, beurteilen, gegebenenfalls selbst freigeben.
   *
   * Die drei Schritte in einem Aufruf, weil sie zusammengehören: Eine Prüfung
   * ohne Urteil ist ein Bericht, den niemand liest, und ein Urteil ohne Prüfung
   * ist eine Behauptung.
   */
  async schliesseAb(auftrag: Abschlussauftrag): Promise<Abschluss> {
    const jetzt = auftrag.jetzt ?? new Date();
    const pruefung = this.pruefe(auftrag);
    const urteil = beurteileFreigabe({ pruefung, konflikte: auftrag.konflikte, bedingungen: auftrag.bedingungen });

    const stand: Ergebnisstand = {
      id: randomUUID(),
      tenantId: auftrag.tenantId,
      laufId: auftrag.laufId,
      jobId: auftrag.jobId,
      ausLauf: auftrag.ausLauf,
      felder: [...auftrag.bericht.felder],
      zeilen: auftrag.bericht.zeilen.map((zeile) => [...zeile.werte]),
      pruefung,
      status: urteil.status,
      /*
       * Die automatische Freigabe wird **hier** vermerkt und nicht später:
       * Ein Ergebnis, das freigegeben gilt, ohne dass ein Vermerk dazu
       * existiert, ist genau die stille Entscheidung, die SPEC-08 ausschließt.
       */
      freigabe: urteil.frei ? this.vermerk('AUTOMATISCH', urteil.bedingungen, pruefung, jetzt) : undefined,
      entstanden: jetzt.toISOString(),
    };

    await this.bestand.save(stand);

    this.logger?.log({
      timestamp: jetzt,
      level: urteil.frei ? 'INFO' : 'WARNING',
      message:
        `Ergebnis von Lauf ${auftrag.laufId}: ${stand.zeilen.length} Datensätze, ` +
        `${pruefung.befunde.length} Befund(e), Status ${urteil.status}. ${urteil.erklaerung}`,
    });

    return { stand, urteil };
  }

  /**
   * Nur prüfen — für die Vorschau, die nichts anlegt (SPEC-08, Abschnitt 11).
   *
   * Ohne `jobId`: Ein Testlauf legt keinen Ergebnisstand an, also gibt es auch
   * nichts, dem der Workflow später anhaften müsste. Ihn hier zu verlangen
   * hieße, für eine Ansicht einen Workflow zu erfinden.
   */
  pruefe(auftrag: Omit<Abschlussauftrag, 'jobId'>): Ergebnispruefung {
    /*
     * Die Verbleibsrechnung: Wie viele Eingangsdatensätze sind in einer
     * Ergebniszeile aufgegangen? Gezählt werden **verschiedene** Herkünfte —
     * ein Datensatz kann bei einem Mehrfachtreffer in mehreren Zeilen stehen,
     * und dann wäre die Summe größer als der Eingang.
     */
    const herkuenfte = new Set<string>();

    for (const zeile of auftrag.bericht.zeilen) {
      for (const herkunft of zeile.herkunft) {
        herkuenfte.add(`${herkunft.quelle}:${herkunft.zeile}`);
      }
    }

    const pruefauftrag: Pruefauftrag = {
      eingang: auftrag.eingang,
      ergebnis: { felder: auftrag.bericht.felder, zeilen: auftrag.bericht.zeilen.map((zeile) => zeile.werte) },
      zielstruktur: auftrag.zielstruktur,
      schluessel: auftrag.schluessel,
      verbleib: {
        herkuenfte: herkuenfte.size,
        zurueckgestellt: auftrag.bericht.zurueckgestellt.length,
        nichtVerarbeitet: auftrag.bericht.nichtVerarbeitet.length,
      },
      referenzen: auftrag.bericht.referenzen.map((referenz) => ({
        bestand: referenz.bestand,
        ohneTreffer: referenz.ohneTreffer,
        mehrdeutig: referenz.mehrdeutig,
      })),
      qualitaet: auftrag.qualitaet,
      region: auftrag.region,
      nullWerte: auftrag.nullWerte,
      jahrhundertGrenze: auftrag.jahrhundertGrenze,
      massstaebe: auftrag.massstaebe,
      jetzt: auftrag.jetzt,
    };

    return pruefeErgebnis(pruefauftrag);
  }

  /**
   * Die Übergabe an Modul 3 (SPEC-10, Abschnitt 1).
   *
   * Der einzige Weg, auf dem Daten die Konsolidierung verlassen. Was nicht
   * freigegeben ist, kommt hier nicht durch — und es gibt keinen zweiten
   * Ausgang, an dem sich das umgehen ließe.
   */
  async uebergabe(id: string, zugang: Modulzugang): Promise<Uebergabe & { geprueft: string[] }> {
    const pruefung = zurUebergabe(await this.holen(id), zugang);

    if (!pruefung.ok) {
      throw new ErgebnisFehler(409, pruefung.grund);
    }

    return { ...pruefung.uebergabe, geprueft: pruefung.geprueft };
  }

  async liste(tenantId: string, laufId?: string): Promise<Ergebnisstand[]> {
    return this.bestand.list(tenantId, laufId);
  }

  async stand(id: string): Promise<Ergebnisstand | undefined> {
    return this.bestand.byId(id);
  }

  /**
   * Die Freigabe durch einen Menschen.
   *
   * Sie darf über Hindernisse hinweggehen — sonst wäre sie sinnlos, denn sie
   * kommt gerade dann zum Zug, wenn etwas dagegen spricht. Aber nicht wortlos:
   * Wer ein Hindernis übergeht, sagt warum, und der Satz steht im Vermerk.
   */
  async gibFrei(
    id: string,
    benutzer: { id: string; name?: string },
    optionen: { begruendung?: string; bedingungen?: Freigabebedingungen; konflikte?: { offen: number; kritischOffen: number }; jetzt?: Date } = {}
  ): Promise<Ergebnisstand> {
    const stand = await this.holen(id);
    const jetzt = optionen.jetzt ?? new Date();

    if (stand.freigabe) {
      throw new ErgebnisFehler(
        409,
        `Dieser Ergebnisstand ist bereits ${stand.freigabe.art === 'AUTOMATISCH' ? 'automatisch' : `von ${stand.freigabe.benutzerName ?? stand.freigabe.benutzer}`} freigegeben worden`
      );
    }

    const urteil = beurteileFreigabe({
      pruefung: stand.pruefung,
      konflikte: optionen.konflikte,
      bedingungen: optionen.bedingungen,
    });

    const erlaubt = darfManuellFreigeben(urteil, stand.pruefung);

    if (!erlaubt.erlaubt) {
      throw new ErgebnisFehler(422, erlaubt.grund);
    }

    if (erlaubt.begruendungNoetig && !optionen.begruendung?.trim()) {
      throw new ErgebnisFehler(
        422,
        'Diese Freigabe geht über offene Punkte hinweg und braucht deshalb eine Begründung: ' +
          urteil.hindernisse.join('; ')
      );
    }

    const vermerk: Freigabevermerk = {
      ...this.vermerk('MANUELL', urteil.bedingungen, stand.pruefung, jetzt),
      benutzer: benutzer.id,
      benutzerName: benutzer.name,
      begruendung: optionen.begruendung,
    };

    /*
     * Der Status nach der manuellen Freigabe ist der, den das Urteil ohne die
     * Freigabefrage ergäbe — nur eben nicht mehr `WAITING_FOR_RELEASE`. Ein
     * Ergebnis mit Konflikten bleibt eines mit Konflikten, auch wenn ein Mensch
     * es durchgewinkt hat.
     */
    const status =
      stand.pruefung.zusammenfassung.KONFLIKT > 0 || (optionen.konflikte?.offen ?? 0) > 0
        ? 'COMPLETED_WITH_CONFLICTS'
        : stand.pruefung.zusammenfassung.WARNUNG > 0
          ? 'COMPLETED_WITH_WARNINGS'
          : 'COMPLETED';

    await this.bestand.freigabeVermerken(id, status, vermerk);

    this.logger?.log({
      timestamp: jetzt,
      level: 'INFO',
      userId: benutzer.id,
      username: benutzer.name,
      message:
        `Ergebnisstand ${id} von Hand freigegeben (Lauf ${stand.laufId}, Status ${status})` +
        (optionen.begruendung ? `: ${optionen.begruendung}` : ''),
    });

    return { ...stand, status, freigabe: vermerk };
  }

  /**
   * Einen früheren Ergebnisstand wiederherstellen (SPEC-06, Abschnitt 14).
   *
   * Es entsteht ein **neuer** Stand mit demselben Inhalt und einem Verweis auf
   * den alten. Der alte bleibt, wie er war, und der verworfene dazwischen auch:
   * Sonst verschwände aus der Geschichte, dass jemand zurückgehen musste — und
   * das ist meist die interessanteste Zeile darin.
   */
  async stelleWiederHer(
    id: string,
    benutzer: { id: string; name?: string },
    optionen: { neuerLaufId: string; jetzt?: Date }
  ): Promise<Ergebnisstand> {
    const alt = await this.holen(id);
    const jetzt = optionen.jetzt ?? new Date();

    if (!istGueltig(alt)) {
      throw new ErgebnisFehler(
        422,
        'Nur ein freigegebener Ergebnisstand lässt sich wiederherstellen. ' +
          'Dieser wartet noch auf eine Freigabe - und was nicht gültig war, wird es durch eine Kopie nicht'
      );
    }

    const neu: Ergebnisstand = {
      ...alt,
      id: randomUUID(),
      laufId: optionen.neuerLaufId,
      ausLauf: alt.laufId,
      wiederhergestelltAus: alt.id,
      // Die Freigabe wird **nicht** mitkopiert: Der neue Stand ist ein neuer
      // Lauf, und ob er hinausgeht, ist eine neue Entscheidung.
      freigabe: undefined,
      status: 'WAITING_FOR_RELEASE',
      entstanden: jetzt.toISOString(),
    };

    await this.bestand.save(neu);

    this.logger?.log({
      timestamp: jetzt,
      level: 'INFO',
      userId: benutzer.id,
      username: benutzer.name,
      message: `Ergebnisstand ${alt.id} (Lauf ${alt.laufId}) als ${neu.id} in Lauf ${optionen.neuerLaufId} wiederhergestellt`,
    });

    return neu;
  }

  private vermerk(
    art: 'AUTOMATISCH' | 'MANUELL',
    bedingungen: Bedingungsstand[],
    pruefung: Ergebnispruefung,
    jetzt: Date
  ): Freigabevermerk {
    return {
      zeitpunkt: jetzt.toISOString(),
      art,
      bedingungen,
      pruefstand: { ...pruefung.zusammenfassung, datensaetze: pruefung.zahlen.ergebnis },
    };
  }

  private async holen(id: string): Promise<Ergebnisstand> {
    const stand = await this.bestand.byId(id);

    if (!stand) {
      throw new ErgebnisFehler(404, `Den Ergebnisstand „${id}" gibt es nicht`);
    }

    return stand;
  }
}

export class ErgebnisFehler extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ErgebnisFehler';
  }
}
