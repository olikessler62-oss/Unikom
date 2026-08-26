import type { Laufauskunft } from '../../domain/conflicts/Ausleitung.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import { darfPaketFort, type Paketbestand } from '../../domain/transfer/Archivpaket.js';
import type { Dateiablage } from './Dateiablage.js';

/**
 * Räumt abgelaufene Archivpakete fort (FR_006, Runde 10 und 13).
 *
 * ## Warum über den Bestand und nicht über das Verzeichnis
 *
 * Bisher durchsuchte diese Bereinigung die Archivverzeichnisse der Workflows
 * und nahm fort, was auf die Archivendung endete und alt genug war. Das ging
 * ohne Bestand — und es war die stillste Art, Originaldaten zu verlieren:
 *
 * ```text
 * über das Verzeichnis   was so heißt, wird für unseres gehalten
 * über den Bestand       nur, was Unikom selbst vermerkt hat
 * ```
 *
 * Seit jedes Paket beim Anlegen eingetragen wird, gibt es die genauere Frage.
 * Ein Paket ohne Eintrag wird nie angefasst; das ist die unbequemere Antwort
 * und die richtige.
 *
 * ## Was der Eintrag zusätzlich beantwortet
 *
 * **Ob der Lauf durch ist.** Ein Paket ist das Original einer Lieferung;
 * solange sein Lauf offene Fälle hat, ist es genau das, woraus der
 * Korrekturlauf rechnen wird. Eine Frist, die es vorher fortnimmt, macht die
 * Konfliktbearbeitung wertlos — man entscheidet zwanzig Fälle und hat nichts
 * mehr, worauf man sie anwenden könnte.
 *
 * Dieselbe Bedingung, dieselbe Auskunft und dieselbe Begründung wie bei den
 * Ausleitungen: SPEC-07, Abschnitt 5, spricht von *Dateien* und nicht von einer
 * Art davon.
 *
 * ## Die Bereinigung trifft ausschließlich Dateien
 *
 * Der Eintrag bleibt stehen und trägt ab dann `entferntAm`. Wer im März wissen
 * will, warum ein Paket vom Januar nicht mehr da ist, findet hier die Antwort
 * und nicht eine Lücke, die nach einem Fehler aussieht.
 */
export interface Paketbereinigung {
  /** Wie viele Pakete fortgeräumt wurden. */
  entfernt: number;
  /** Wie viele stehen blieben, weil ihr Lauf nicht durch ist. */
  geschuetzt: number;
  /** Was sich nicht löschen ließ — mit dem Grund, nicht verschwiegen. */
  fehler: { pfad: string; grund: string }[];
}

export class Archivbereinigung {
  constructor(
    private readonly pakete: Paketbestand,
    private readonly ablage: Dateiablage,
    private readonly logger?: Logger,
    private readonly laeufe?: Laufauskunft,
    /**
     * Die Frist je Mandant (SPEC-07 §5).
     *
     * Fehlt sie, gilt für alle die Voreinstellung — die Bereinigung bleibt
     * damit brauchbar, auch wo niemand etwas eingestellt hat.
     */
    private readonly fristen?: { tage(tenantId: string): Promise<number | undefined> }
  ) {}

  async bereinige(optionen: { tage?: number; jetzt?: Date } = {}): Promise<Paketbereinigung> {
    const jetzt = optionen.jetzt ?? new Date();
    const ergebnis: Paketbereinigung = { entfernt: 0, geschuetzt: 0, fehler: [] };

    for (const paket of await this.pakete.list()) {
      /*
       * Ob ein Paket fortgeräumt werden darf, entscheidet die Domäne — hier
       * steht keine zweite Abschrift derselben Bedingungen. Zwei Stellen, die
       * dasselbe prüfen, sind zwei Stellen, an denen es auseinanderläuft.
       */
      const lauf = { abgeschlossen: await this.abgeschlossen(paket.laufId) };

      /*
       * Die Frist des Mandanten schlägt die Voreinstellung, und ein
       * ausdrücklich mitgegebener Wert schlägt beides — er kommt von einem
       * Menschen, der gerade zusieht.
       */
      const tage = optionen.tage ?? (await this.fristen?.tage(paket.tenantId));

      if (!darfPaketFort(paket, lauf, { tage, jetzt })) {
        if (paket.entferntAm === undefined && !lauf.abgeschlossen) {
          ergebnis.geschuetzt += 1;
        }

        continue;
      }

      try {
        await this.ablage.entferne(paket.pfad);
      } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message : String(fehler);

        ergebnis.fehler.push({ pfad: paket.pfad, grund });

        this.logger?.log({
          timestamp: jetzt,
          level: 'WARNING',
          message: `Das Archivpaket „${paket.name}" ließ sich nicht forträumen: ${grund}`,
        });

        continue;
      }

      await this.pakete.save({ ...paket, entferntAm: jetzt.toISOString() });
      ergebnis.entfernt += 1;

      /*
       * Je Paket eine Zeile. Ein Archiv ist das Original einer Lieferung; dass
       * es fort ist, gehört einzeln ins Protokoll und nicht in eine Summe am
       * Ende des Tages.
       */
      this.logger?.log({
        timestamp: jetzt,
        level: 'INFO',
        message:
          `Archivpaket fortgeräumt: „${paket.name}" (angelegt am ${paket.erstellt.slice(0, 10)}, ` +
          `${paket.dateien} Eingangsdatei(en)). Der Lauf ist abgeschlossen`,
      });
    }

    return ergebnis;
  }

  /** Ohne Auskunft über die Läufe wird nichts fortgeräumt. */
  private async abgeschlossen(laufId: string): Promise<boolean> {
    if (!this.laeufe) {
      return false;
    }

    return this.laeufe.abgeschlossen(laufId);
  }
}
