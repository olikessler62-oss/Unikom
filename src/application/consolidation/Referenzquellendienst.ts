import { randomUUID } from 'node:crypto';

import type { Referenzbestand } from '../../domain/consolidation/Referenz.js';
import {
  maengel,
  versionVon,
  type Referenzquelle,
  type Referenzquellenbestand,
  type Referenzstand,
} from '../../domain/consolidation/Referenzquelle.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import type { Dateiablage } from '../workflow/Dateiablage.js';
import { liesDatei, type Lesewunsch } from '../workflow/Eingang.js';
import { waehleVorschaudatei, VorschauFehler } from '../workflow/Vorschaudatei.js';

/**
 * Referenzquellen verwalten und zum Lauf einlesen (SPEC-04, Abschnitt 6 und 8).
 *
 * ## Der Eintrag verwaltet, die Datei trägt
 *
 * Hier liegt kein Datenbestand, sondern ein Verweis: Name, Verzeichnis, Datei,
 * Version. Gelesen wird zum Lauf. Die Kundenliste in die Datenbank zu kopieren
 * hieße, sie zweimal zu haben — und beim nächsten Umzug wüsste niemand, welcher
 * Stand gilt.
 *
 * ## Nachsehen ist eine eigene Handlung
 *
 * `pruefe` liest die Datei **jetzt** und schreibt fest, was darin stand:
 * Felder, Zeilen, Änderungsdatum, die Anmerkungen des Lesers. Damit kann jemand
 * beim Einrichten sehen, ob die Referenz die Felder hat, über die er
 * nachschlagen will — statt es im Nachtlauf zu erfahren, wenn kein Treffer
 * zustande kommt und niemand weiß, warum.
 */
export class ReferenzquellenFehler extends Error {}

export class Referenzquellendienst {
  constructor(
    private readonly bestand: Referenzquellenbestand,
    private readonly ablage: Dateiablage,
    private readonly logger: Logger
  ) {}

  async liste(tenantId?: string): Promise<Referenzquelle[]> {
    return this.bestand.list(tenantId);
  }

  async lege(
    angaben: Omit<Referenzquelle, 'id' | 'angelegt' | 'gesehen'> & { id?: string },
    wer?: { id: string; name?: string }
  ): Promise<Referenzquelle> {
    const fehlt = maengel(angaben);

    if (fehlt.length > 0) {
      throw new ReferenzquellenFehler(fehlt.join(' '));
    }

    const vorhanden = angaben.id ? await this.bestand.byId(angaben.id) : undefined;

    const quelle: Referenzquelle = {
      ...angaben,
      id: vorhanden?.id ?? angaben.id ?? randomUUID(),
      /* Der frühere Stand bleibt stehen, bis jemand wieder nachsieht. */
      gesehen: vorhanden?.gesehen,
      angelegt: vorhanden?.angelegt ?? new Date().toISOString(),
      angelegtVonName: vorhanden?.angelegtVonName ?? wer?.name,
    };

    await this.bestand.save(quelle);

    this.logger.log({
      timestamp: new Date(),
      level: 'INFO',
      userId: wer?.id,
      username: wer?.name,
      message:
        `Referenzquelle ${vorhanden ? 'geändert' : 'angelegt'}: „${quelle.name}" ` +
        `aus „${quelle.datei ? this.ablage.pfad(quelle.verzeichnis, quelle.datei) : quelle.verzeichnis}"` +
        (quelle.version ? ` (Version ${quelle.version})` : ''),
    });

    return quelle;
  }

  async entferne(id: string, wer?: { id: string; name?: string }): Promise<void> {
    const quelle = await this.bestand.byId(id);

    if (!quelle) {
      throw new ReferenzquellenFehler(`Eine Referenzquelle mit der Kennung ${id} gibt es nicht`);
    }

    await this.bestand.entferne(id);

    /*
     * Hier wird wirklich gelöscht, und das ist vertretbar: Der Eintrag ist ein
     * Verweis und keine Aufzeichnung. Die Datei bleibt liegen, und was ein Lauf
     * mit ihr getan hat, steht in seinem Bericht — samt Name und Version.
     */
    this.logger.log({
      timestamp: new Date(),
      level: 'WARNING',
      userId: wer?.id,
      username: wer?.name,
      message:
        `Referenzquelle entfernt: „${quelle.name}". Die Datei selbst bleibt liegen; ` +
        'Läufe, die sie benutzt haben, nennen sie weiterhin in ihrem Bericht',
    });
  }

  /** Sieht nach, was gerade in der Datei steht, und schreibt es an den Eintrag. */
  async pruefe(id: string, wunsch: Lesewunsch): Promise<Referenzquelle> {
    const quelle = await this.hole(id);
    const gelesen = await this.lies(quelle, wunsch);

    const gesehen: Referenzstand = {
      datei: gelesen.datei,
      felder: gelesen.bestand.felder,
      zeilen: gelesen.bestand.zeilen.length,
      geaendert: gelesen.geaendert,
      geprueft: new Date().toISOString(),
      hinweise: gelesen.hinweise.length > 0 ? gelesen.hinweise : undefined,
    };

    const aktualisiert = { ...quelle, gesehen };

    await this.bestand.save(aktualisiert);

    return aktualisiert;
  }

  /**
   * Der Bestand für einen Lauf.
   *
   * Er trägt Name und Version mit hinein — der Bericht nennt sie später, und
   * ohne sie wäre die Herkunft eines übernommenen Wertes „irgendeine Referenz".
   */
  async fuerLauf(id: string, wunsch: Lesewunsch): Promise<Referenzbestand> {
    const quelle = await this.hole(id);
    const gelesen = await this.lies(quelle, wunsch);

    return gelesen.bestand;
  }

  private async hole(id: string): Promise<Referenzquelle> {
    const quelle = await this.bestand.byId(id);

    if (!quelle) {
      throw new ReferenzquellenFehler(`Eine Referenzquelle mit der Kennung ${id} gibt es nicht`);
    }

    return quelle;
  }

  private async lies(
    quelle: Referenzquelle,
    wunsch: Lesewunsch
  ): Promise<{ bestand: Referenzbestand; datei: string; geaendert?: string; hinweise: string[] }> {
    let datei;

    try {
      datei = await waehleVorschaudatei(this.ablage, { verzeichnis: quelle.verzeichnis, datei: quelle.datei });
    } catch (fehler) {
      /*
       * Der Satz nennt die Quelle beim Namen. „Kein lesbarer Inhalt in
       * C:\daten\ref" schickt jemanden in ein Verzeichnis; „Die Referenzquelle
       * PLZ-Verzeichnis …" sagt ihm zugleich, welche Einstellung dahintersteht.
       */
      throw new ReferenzquellenFehler(
        `Die Referenzquelle „${quelle.name}" ließ sich nicht lesen: ` +
          (fehler instanceof VorschauFehler ? fehler.message : String(fehler))
      );
    }

    const gelesen = liesDatei(
      { name: datei.name, bytes: await this.ablage.lies(datei.pfad), geaendert: datei.geaendert },
      wunsch
    );

    const erste = gelesen.quellen[0];

    if (!erste) {
      throw new ReferenzquellenFehler(
        `Die Referenzquelle „${quelle.name}" ergab keine Daten: ${gelesen.hinweise.join(' ')}`.trim()
      );
    }

    return {
      bestand: {
        id: quelle.id,
        name: quelle.name,
        version: versionVon(quelle, datei.geaendert),
        stand: { geaendert: datei.geaendert, eingelesen: wunsch.eingelesen },
        felder: erste.felder,
        zeilen: erste.zeilen,
      },
      datei: datei.name,
      geaendert: datei.geaendert,
      hinweise: gelesen.hinweise,
    };
  }
}
