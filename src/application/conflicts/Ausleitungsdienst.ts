import { randomUUID } from 'node:crypto';

import type { Konfliktfilter } from '../../domain/conflicts/Auswahl.js';
import {
  ausleitungsname,
  darfFortgeraeumtWerden,
  konfliktdatei,
  type Ausleitung,
  type Ausleitungsart,
  type Ausleitungsbestand,
  type Laufauskunft,
} from '../../domain/conflicts/Ausleitung.js';
import type { Konfliktbestand } from '../../domain/conflicts/Konfliktbestand.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import type { Dateiablage } from '../workflow/Dateiablage.js';

/**
 * Ausleitungen schreiben und nach Ablauf der Frist forträumen (SPEC-01,
 * Abschnitt 23; SPEC-07, Dateimodell und Abschnitt 5).
 *
 * ## Die Trennung, um die es geht
 *
 * Der `ConflictService` führt den Bestand: Er entscheidet, sperrt, ändert
 * Status und schreibt Historie. Dieser Dienst fasst davon nichts an — er macht
 * **Abschriften**. Zusammengelegt wäre die Ausleitung eine Handlung, die
 * nebenbei den Bestand verändert, und niemand wüsste mehr, ob ein Fall den
 * Status wechselte, weil jemand entschieden hat oder weil jemand eine Datei
 * wollte.
 *
 * Deshalb baut die **Konfliktzieldatei** hier auch nicht selbst: Die Fälle auf
 * `ERNEUT_VERARBEITET` zu setzen ist eine fachliche Handlung, und die gehört
 * dorthin, wo die Historie geschrieben wird. Von dort kommen Felder und Zeilen
 * fertig her, und hier wird nur noch geschrieben.
 */
export interface Ausleitungsauftrag {
  tenantId: string;
  verzeichnis: string;
  laufId?: string;
  wer?: { id: string; name?: string };
  jetzt?: Date;
}

export interface Bereinigung {
  /** Wie viele Dateien fortgeräumt wurden. */
  entfernt: number;
  /** Wie viele stehen blieben, weil ihr Lauf nicht durch ist. */
  geschuetzt: number;
  /** Was sich nicht löschen ließ — mit dem Grund, nicht verschwiegen. */
  fehler: { pfad: string; grund: string }[];
}

export class Ausleitungsdienst {
  constructor(
    private readonly bestand: Konfliktbestand,
    private readonly ausleitungen: Ausleitungsbestand,
    private readonly ablage: Dateiablage,
    private readonly logger: Logger,
    private readonly laeufe?: Laufauskunft,
    /**
     * Die Frist je Mandant (SPEC-07 §5).
     *
     * Fehlt sie, gilt für alle die Voreinstellung — die Bereinigung bleibt
     * damit brauchbar, auch wo niemand etwas eingestellt hat.
     */
    private readonly fristen?: { tage(tenantId: string): Promise<number | undefined> }
  ) {}

  /**
   * Die Konfliktdatei eines Laufs — zur Ansicht und zur Weitergabe.
   *
   * Ohne Lauf: der ganze offene Bestand des Mandanten. Das ist die Ausleitung,
   * die jemand braucht, der einem Lieferanten sagen will, was an seinen Daten
   * nicht stimmt.
   */
  async leiteKonflikteAus(auftrag: Ausleitungsauftrag & { filter?: Konfliktfilter }): Promise<Ausleitung> {
    const alle = await this.bestand.list(auftrag.tenantId, auftrag.filter);
    const faelle = auftrag.laufId ? alle.filter((fall) => fall.laufId === auftrag.laufId) : alle;

    return this.schreibe('KONFLIKTE', konfliktdatei(faelle), faelle.length, auftrag);
  }

  /**
   * Die Konfliktzieldatei — die bereinigten Fälle für die erneute Verarbeitung.
   *
   * Felder und Zeilen kommen von dort, wo der Statuswechsel protokolliert wird.
   * Die UUIDs reisen unverändert mit (SPEC-07, Dateimodell).
   */
  async leiteZielAus(
    inhalt: { felder: string[]; zeilen: string[][] },
    auftrag: Ausleitungsauftrag
  ): Promise<Ausleitung> {
    return this.schreibe('ZIEL', inhalt, inhalt.zeilen.length, auftrag);
  }

  private async schreibe(
    art: Ausleitungsart,
    inhalt: { felder: string[]; zeilen: string[][] },
    faelle: number,
    auftrag: Ausleitungsauftrag
  ): Promise<Ausleitung> {
    const jetzt = auftrag.jetzt ?? new Date();
    const name = ausleitungsname(art, auftrag.laufId, jetzt);
    const pfad = this.ablage.pfad(auftrag.verzeichnis, name);

    await this.ablage.schreibe(pfad, alsBytes(schreibeCsv(inhalt.felder, inhalt.zeilen)));

    const ausleitung: Ausleitung = {
      id: randomUUID(),
      tenantId: auftrag.tenantId,
      art,
      laufId: auftrag.laufId,
      pfad,
      name,
      faelle,
      erstellt: jetzt.toISOString(),
      erstelltVonName: auftrag.wer?.name,
    };

    await this.ausleitungen.save(ausleitung);

    this.logger.log({
      timestamp: jetzt,
      level: 'INFO',
      userId: auftrag.wer?.id,
      username: auftrag.wer?.name,
      message:
        `${art === 'ZIEL' ? 'Konfliktzieldatei' : 'Konfliktdatei'} geschrieben: „${name}" mit ${faelle} Fall/Fällen` +
        `${auftrag.laufId ? ` aus Lauf ${auftrag.laufId}` : ' über den ganzen Bestand'}`,
    });

    return ausleitung;
  }

  async liste(tenantId?: string): Promise<Ausleitung[]> {
    return this.ausleitungen.list(tenantId);
  }

  /**
   * Räumt ab, was die Frist überschritten hat — **nur Dateien**.
   *
   * „Die Bereinigung trifft ausschließlich Dateien. Konfliktfall, UUID,
   * Entscheidungen und Bearbeitungshistorie liegen in der Datenbank und bleiben
   * davon unberührt." Deshalb steht hier kein Zugriff auf den Konfliktbestand.
   *
   * Eine Datei, die sich nicht löschen lässt, wird gemeldet und nicht
   * übergangen: Sonst hielte der Eintrag sie für fortgeräumt, und sie läge noch
   * jahrelang da.
   */
  async bereinige(optionen: { tage?: number; jetzt?: Date } = {}): Promise<Bereinigung> {
    const jetzt = optionen.jetzt ?? new Date();
    const ergebnis: Bereinigung = { entfernt: 0, geschuetzt: 0, fehler: [] };

    for (const ausleitung of await this.ausleitungen.list()) {
      /*
       * Ob eine Ausleitung fortgeräumt werden darf, entscheidet die Domäne —
       * hier steht keine zweite Abschrift derselben Bedingungen. Zwei Stellen,
       * die dasselbe prüfen, sind zwei Stellen, an denen es auseinanderläuft.
       */
      const lauf = ausleitung.laufId ? { abgeschlossen: await this.abgeschlossen(ausleitung.laufId) } : undefined;

      /*
       * Die Frist des Mandanten schlägt die Voreinstellung, und ein
       * ausdrücklich mitgegebener Wert schlägt beides — er kommt von einem
       * Menschen, der gerade zusieht.
       */
      const tage = optionen.tage ?? (await this.fristen?.tage(ausleitung.tenantId));

      if (!darfFortgeraeumtWerden(ausleitung, lauf, { tage, jetzt })) {
        if (ausleitung.laufId && lauf?.abgeschlossen === false) {
          ergebnis.geschuetzt += 1;
        }

        continue;
      }

      try {
        await this.ablage.entferne(ausleitung.pfad);
      } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message : String(fehler);

        ergebnis.fehler.push({ pfad: ausleitung.pfad, grund });

        this.logger.log({
          timestamp: jetzt,
          level: 'WARNING',
          message: `Die Ausleitung „${ausleitung.name}" ließ sich nicht forträumen: ${grund}`,
        });

        continue;
      }

      await this.ausleitungen.save({ ...ausleitung, entferntAm: jetzt.toISOString() });
      ergebnis.entfernt += 1;

      this.logger.log({
        timestamp: jetzt,
        level: 'INFO',
        message:
          `Ausleitung fortgeräumt: „${ausleitung.name}" (angelegt am ${ausleitung.erstellt.slice(0, 10)}). ` +
          'Konfliktfall, Entscheidungen und Historie bleiben im Bestand',
      });
    }

    return ergebnis;
  }

  /** Ohne Auskunft über die Läufe wird nichts fortgeräumt, was zu einem Lauf gehört. */
  private async abgeschlossen(laufId: string): Promise<boolean> {
    if (!this.laeufe) {
      return false;
    }

    return this.laeufe.abgeschlossen(laufId);
  }
}
