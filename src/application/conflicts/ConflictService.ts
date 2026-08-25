import { randomUUID } from 'node:crypto';

import { fallAus, type Regelverstoss } from '../../domain/conflicts/Regelverstoss.js';
import { aktuelleVersion, type ProfilRepository } from '../../domain/consolidation/Profil.js';

import type { Konsolidierungsbericht, Konsolidierungskonflikt } from '../consolidation/ConsolidationService.js';
import {
  filtere,
  gruppiere,
  sortiere,
  type Gruppierungsart,
  type Konfliktfilter,
  type Richtung,
  type Sortierart,
} from '../../domain/conflicts/Auswahl.js';
import {
  statusNach,
  wendeAn,
  type Anwendung,
  type Anwendungsoptionen,
  type Entscheidung,
} from '../../domain/conflicts/Entscheidung.js';
import { wiedereinstieg, type Bearbeitungsstand, type Wiedereinstieg } from '../../domain/conflicts/Fortschritt.js';
import { anfuegen, type Bearbeitungsschritt, type Schrittart } from '../../domain/conflicts/Historie.js';
import type { Konfliktbestand } from '../../domain/conflicts/Konfliktbestand.js';
import {
  darfWechseln,
  istErledigt,
  verhindertFreigabe,
  type Konfliktfall,
  type Konfliktstatus,
  type Kritikalitaet,
  type Streitfeld,
} from '../../domain/conflicts/Konfliktfall.js';
import { darfBearbeiten, geltendeSperre, pruefeFassung, SPERRE_VERFAELLT_NACH_MS } from '../../domain/conflicts/Sperre.js';
import type { Logger } from '../../domain/logging/LogEntry.js';

/**
 * Die Konfliktbearbeitung (Etappe 6, SPEC-07).
 *
 * ```text
 * Lauf  →  Konflikte anlegen  →  ansehen  →  sperren  →  entscheiden  →  freigeben
 *                                    ↑           ↓
 *                                    └── zurückstellen
 * ```
 *
 * ## Die Vorschau ist die Entscheidung ohne Speichern
 *
 * `vorschau` und `entscheide` rufen dieselbe Funktion. Der Unterschied ist eine
 * Zeile: Die eine schreibt, die andere nicht. Zwei getrennte Rechnungen wären
 * der sichere Weg zu einem Benutzer, der etwas anderes bestätigt hat als das,
 * was danach geschah.
 *
 * ## Nichts wird überschrieben
 *
 * Jede Änderung erzeugt einen Schritt in der Historie und hebt die Fassung.
 * Auch eine Korrektur einer früheren Entscheidung löscht die frühere nicht —
 * sie kommt dahinter (SPEC-07, Abschnitt 12).
 */
export interface Konfliktansicht {
  fall: Konfliktfall;
  historie: Bearbeitungsschritt[];
  /** Ob dieser Benutzer den Fall gerade bearbeiten darf. */
  bearbeitbar: boolean;
  /** Warum nicht, falls nicht. */
  grund?: string;
}

export interface Konfliktliste {
  faelle: Konfliktfall[];
  gruppen?: { name: string; anzahl: number; ids: string[] }[];
  /** Wo der Benutzer weitermachen kann. */
  einstieg: Wiedereinstieg;
  /** Die Zahlen zum Bestand, ungefiltert. */
  stand: Freigabestand;
}

/** Der Gesamtstatus vor der Freigabe (SPEC-07, Abschnitt 13). */
export interface Freigabestand {
  gesamt: number;
  bereinigt: number;
  offen: number;
  zurueckgestellt: number;
  akzeptiert: number;
  kritischOffen: number;
  erneutVerarbeitet: number;
  erfolgreich: number;
  /** Ob eine erneute Verarbeitung möglich ist. */
  freigabeMoeglich: boolean;
  /** Welche Fälle sie verhindern — mit Kennung und Grund. */
  hindernisse: { id: string; datensatz: string; kritikalitaet: Kritikalitaet; status: Konfliktstatus; ursache: string }[];
}

export interface Massenergebnis {
  /** Die Kennung des Vorgangs — sie steht an jedem betroffenen Schritt. */
  vorgang: string;
  betroffen: number;
  uebernommen: string[];
  /** Fälle, bei denen es nicht ging — mit Grund. */
  abgelehnt: { id: string; grund: string }[];
}

export interface Massenvorschau {
  vorgang?: undefined;
  betroffen: { id: string; datensatz: string; zulaessig: boolean; werte: Record<string, string>; grund?: string }[];
  /** Wie viele davon durchgingen. */
  moeglich: number;
}

export interface Benutzerangabe {
  id: string;
  name?: string;
}

export class ConflictService {
  constructor(
    private readonly bestand: Konfliktbestand,
    private readonly logger?: Logger,
    private readonly sperrfrist = SPERRE_VERFAELLT_NACH_MS,
    /**
     * Die Schemata — gebraucht für den Rückweg, nicht fürs Entstehen.
     *
     * Fehlt der Bestand, gilt beim Bereinigen nur, was der Aufrufer mitgibt.
     * Das ist der Stand von vorher und kein Fehler; die Verdrahtung für Tests
     * kommt ohne aus.
     */
    private readonly profile?: ProfilRepository
  ) {}

  /**
   * Die Regeln, gegen die eine Entscheidung geprüft wird.
   *
   * ## Warum die des Falls und nicht die des Mandanten
   *
   * Wer einen Fall bereinigt, tippt einen Wert ein. Er muss gegen dieselben
   * Regeln laufen, die den Fall überhaupt erzeugt haben — sonst ließe sich ein
   * leeres Pflichtfeld durch ein leeres Pflichtfeld „korrigieren", und der
   * Fall gälte danach als bereinigt.
   *
   * Der Aufrufer kennt das Schema nicht: Er hat eine Kennung und will
   * entscheiden. Bei einer Massenentscheidung sind es sogar mehrere, aus
   * verschiedenen Schemata. Deshalb wird hier je Fall nachgeschlagen und nicht
   * einmal vorne am Eingang.
   *
   * ## Zusammengelegt, nicht ersetzt
   *
   * Die mitgegebenen Regeln bleiben: Sie sind die ausgelieferten, und die
   * gelten überall. Bei gleicher Kennung gewinnt die des Schemas — sie ist
   * die genauere, und der Kunde hat sie ausdrücklich angelegt.
   */
  private async optionenFuer(fall: Konfliktfall, optionen: Anwendungsoptionen): Promise<Anwendungsoptionen> {
    if (!fall.profil || !this.profile) {
      return optionen;
    }

    const profil = await this.profile.getById(fall.profil);
    const eigene = profil ? (aktuelleVersion(profil).regeln ?? []) : [];

    if (eigene.length === 0) {
      return optionen;
    }

    const nach = new Map((optionen.qualitaet ?? []).map((regel) => [regel.id, regel]));

    for (const regel of eigene) {
      nach.set(regel.id, regel);
    }

    return { ...optionen, qualitaet: [...nach.values()] };
  }

  /* ---------- Entstehen ---------- */

  /**
   * Aus einem Konsolidierungsbericht werden Konfliktfälle.
   *
   * Die UUID entsteht **hier**, in der Datenbank (SPEC-07, Abschnitt 12) — und
   * nicht in der Konsolidierung: Ein Bericht wird auch für einen Prüflauf
   * erzeugt, und ein Prüflauf darf keinen Bestand anlegen.
   *
   * Nicht jeder Berichtseintrag wird ein Fall. Was die Automatik entschieden
   * hat, ist entschieden; hierher kommt nur, was ohne einen Menschen nicht
   * weitergeht (SPEC-07, Abschnitt 1: „Eindeutig automatisch lösbare Fälle
   * werden ohne unnötige Benutzerinteraktion verarbeitet").
   */
  async ausBericht(
    bericht: Konsolidierungsbericht,
    kopf: { tenantId: string; laufId: string; benutzer: Benutzerangabe; jetzt?: Date }
  ): Promise<Konfliktfall[]> {
    const jetzt = (kopf.jetzt ?? new Date()).toISOString();
    const angelegt: Konfliktfall[] = [];

    for (const konflikt of bericht.konflikte) {
      const fall: Konfliktfall = {
        id: randomUUID(),
        tenantId: kopf.tenantId,
        laufId: kopf.laufId,
        datensatz: konflikt.schluessel ?? `${konflikt.quelle ?? 'unbekannt'}${konflikt.zeile ? `, Zeile ${konflikt.zeile}` : ''}`,
        art: konflikt.art,
        kritikalitaet: kritikalitaetFuer(konflikt),
        status: 'OFFEN',
        ursache: konflikt.ursache,
        regel: konflikt.feld ? `Feld ${konflikt.feld}` : undefined,
        erwartet: konflikt.erwartet,
        vorgefunden: konflikt.vorgefunden,
        naechsteSchritte: konflikt.naechsteSchritte,
        quellen: konflikt.quelle ? konflikt.quelle.split(', ') : [],
        felder: streitfelderAus(konflikt, bericht),
        entstanden: jetzt,
        geaendert: jetzt,
        fassung: 1,
      };

      await this.bestand.save(fall);
      await this.bestand.schrittAnfuegen({
        nummer: 1,
        fallId: fall.id,
        art: 'ENTSTANDEN',
        zeitpunkt: jetzt,
        benutzer: kopf.benutzer.id,
        benutzerName: kopf.benutzer.name,
        nachStatus: 'OFFEN',
        entscheidung: konflikt.ursache,
        regel: konflikt.art,
      });

      angelegt.push(fall);
    }

    this.logger?.log({
      timestamp: kopf.jetzt ?? new Date(),
      level: 'INFO',
      userId: kopf.benutzer.id,
      username: kopf.benutzer.name,
      message: `Konfliktbearbeitung: ${angelegt.length} Fall/Fälle aus Lauf ${kopf.laufId} angelegt`,
    });

    return angelegt;
  }

  /**
   * Aus Regelverstößen werden Konfliktfälle.
   *
   * Derselbe Bestand wie für Wertekonflikte, und das ist keine Sparsamkeit:
   * Für den Menschen ist es dieselbe Arbeit. Er sieht einen Datensatz, der so
   * nicht durchgeht, und trägt ein, was gelten soll. Zwei Bildschirme für
   * dieselbe Handlung wären zwei Orte, an denen etwas liegen bleibt.
   */
  async ausRegelverstoessen(
    verstoesse: readonly Regelverstoss[],
    kopf: { tenantId: string; laufId: string; profil?: string; benutzer: Benutzerangabe; jetzt?: Date }
  ): Promise<Konfliktfall[]> {
    const jetzt = (kopf.jetzt ?? new Date()).toISOString();
    const angelegt: Konfliktfall[] = [];

    for (const verstoss of verstoesse) {
      const fall: Konfliktfall = {
        ...fallAus(verstoss, { tenantId: kopf.tenantId, laufId: kopf.laufId, profil: kopf.profil }),
        id: randomUUID(),
        entstanden: jetzt,
        geaendert: jetzt,
        fassung: 1,
      };

      await this.bestand.save(fall);
      await this.bestand.schrittAnfuegen({
        nummer: 1,
        fallId: fall.id,
        art: 'ENTSTANDEN',
        zeitpunkt: jetzt,
        benutzer: kopf.benutzer.id,
        benutzerName: kopf.benutzer.name,
        nachStatus: 'OFFEN',
        entscheidung: fall.ursache,
        regel: fall.regel,
      });

      angelegt.push(fall);
    }

    if (angelegt.length > 0) {
      this.logger?.log({
        timestamp: kopf.jetzt ?? new Date(),
        level: 'INFO',
        userId: kopf.benutzer.id,
        username: kopf.benutzer.name,
        message: `Konfliktbearbeitung: ${angelegt.length} Regelverstoß/-verstöße aus Lauf ${kopf.laufId} angelegt`,
      });
    }

    return angelegt;
  }

  /* ---------- Ansehen ---------- */

  async liste(
    tenantId: string,
    benutzer: string,
    optionen: {
      filter?: Konfliktfilter;
      sortierung?: Sortierart;
      richtung?: Richtung;
      gruppierung?: Gruppierungsart;
    } = {}
  ): Promise<Konfliktliste> {
    const alle = await this.bestand.list(tenantId);
    const gefiltert = sortiere(filtere(alle, optionen.filter ?? {}), optionen.sortierung, optionen.richtung);
    const stand = await this.bestand.standOf(benutzer, tenantId);

    const gruppen =
      optionen.gruppierung && optionen.gruppierung !== 'KEINE'
        ? [...gruppiere(gefiltert, optionen.gruppierung).entries()].map(([name, faelle]) => ({
            name,
            anzahl: faelle.length,
            ids: faelle.map((fall) => fall.id),
          }))
        : undefined;

    return {
      faelle: gefiltert,
      gruppen,
      einstieg: wiedereinstieg(stand, gefiltert),
      // Die Zahlen zum **Gesamtbestand**: Ein Filter, der nur die offenen
      // zeigt, dürfte nicht dazu führen, dass die Freigabe plötzlich möglich
      // aussieht, weil die kritischen gerade ausgeblendet sind.
      stand: freigabestand(alle),
    };
  }

  async ansicht(id: string, benutzer: string, jetzt = new Date()): Promise<Konfliktansicht | undefined> {
    const fall = await this.bestand.byId(id);

    if (!fall) {
      return undefined;
    }

    const pruefung = darfBearbeiten(fall, benutzer, jetzt, this.sperrfrist);

    return {
      fall: { ...fall, sperre: geltendeSperre(fall, jetzt, this.sperrfrist) },
      historie: await this.bestand.historie(id),
      bearbeitbar: pruefung.ok,
      grund: pruefung.ok ? undefined : pruefung.grund,
    };
  }

  /* ---------- Sperren ---------- */

  async sperren(id: string, benutzer: Benutzerangabe, jetzt = new Date()): Promise<Konfliktfall> {
    const fall = await this.holen(id);
    const pruefung = darfBearbeiten(fall, benutzer.id, jetzt, this.sperrfrist);

    if (!pruefung.ok) {
      throw new KonfliktFehler(409, pruefung.grund);
    }

    const vorher = fall.sperre;
    const gesperrt: Konfliktfall = {
      ...fall,
      sperre: { benutzer: benutzer.id, benutzerName: benutzer.name, seit: jetzt.toISOString() },
      geaendert: jetzt.toISOString(),
      fassung: fall.fassung + 1,
    };

    await this.bestand.save(gesperrt);
    await this.schritt(fall, 'GESPERRT', benutzer, jetzt, {
      bemerkung: pruefung.uebernommen
        ? `Die abgelaufene Sperre von ${vorher?.benutzerName ?? vorher?.benutzer} wurde übernommen`
        : undefined,
    });

    return gesperrt;
  }

  async freigeben(id: string, benutzer: Benutzerangabe, jetzt = new Date()): Promise<Konfliktfall> {
    const fall = await this.holen(id);

    if (fall.sperre && fall.sperre.benutzer !== benutzer.id) {
      const pruefung = darfBearbeiten(fall, benutzer.id, jetzt, this.sperrfrist);

      if (!pruefung.ok) {
        throw new KonfliktFehler(409, pruefung.grund);
      }
    }

    const offen: Konfliktfall = {
      ...fall,
      sperre: undefined,
      geaendert: jetzt.toISOString(),
      fassung: fall.fassung + 1,
    };

    await this.bestand.save(offen);
    await this.schritt(fall, 'FREIGEGEBEN', benutzer, jetzt);

    return offen;
  }

  /* ---------- Entscheiden ---------- */

  /**
   * Was aus der Entscheidung würde — ohne sie zu treffen.
   *
   * SPEC-07, Abschnitt 6: „Vor der Bestätigung muss das erwartete Ergebnis der
   * Entscheidung nachvollziehbar dargestellt werden."
   */
  async vorschau(id: string, entscheidung: Entscheidung, optionen: Anwendungsoptionen): Promise<Anwendung> {
    const fall = await this.holen(id);

    return wendeAn(fall, entscheidung, await this.optionenFuer(fall, optionen));
  }

  async entscheide(
    id: string,
    entscheidung: Entscheidung,
    benutzer: Benutzerangabe,
    optionen: Anwendungsoptionen & { fassung?: number; jetzt?: Date; vorgang?: string }
  ): Promise<{ fall: Konfliktfall; anwendung: Anwendung }> {
    const jetzt = optionen.jetzt ?? new Date();
    const fall = await this.holen(id);

    const fassung = pruefeFassung(fall, optionen.fassung);

    if (!fassung.ok) {
      throw new KonfliktFehler(409, fassung.grund);
    }

    const sperre = darfBearbeiten(fall, benutzer.id, jetzt, this.sperrfrist);

    if (!sperre.ok) {
      throw new KonfliktFehler(409, sperre.grund);
    }

    const ziel = statusNach(entscheidung);

    if (!darfWechseln(fall.status, ziel)) {
      throw new KonfliktFehler(
        409,
        `Ein Fall im Status „${fall.status}" kann nicht nach „${ziel}" wechseln. ` +
          'Der Lebenszyklus aus SPEC-07 lässt diesen Schritt nicht zu'
      );
    }

    const anwendung = wendeAn(fall, entscheidung, await this.optionenFuer(fall, optionen));

    if (!anwendung.zulaessig) {
      throw new KonfliktFehler(
        422,
        'Die Entscheidung verstößt gegen die geltenden Fachregeln und wird nicht übernommen: ' +
          anwendung.befunde
            .filter((befund) => befund.schwere === 'KONFLIKT' || befund.schwere === 'FEHLER')
            .map((befund) => befund.ursache)
            .join('; '),
        anwendung
      );
    }

    const neu: Konfliktfall = {
      ...fall,
      status: ziel,
      ergebnis: anwendung.herkunft.length > 0 ? anwendung.werte : fall.ergebnis,
      geaendert: jetzt.toISOString(),
      fassung: fall.fassung + 1,
      // Wer entschieden hat, ist fertig. Die Sperre weiter zu halten hieße,
      // den nächsten Bearbeiter aus einem Fall auszusperren, an dem niemand
      // mehr sitzt.
      sperre: undefined,
    };

    await this.bestand.save(neu);
    await this.schritt(fall, schrittartFuer(entscheidung), benutzer, jetzt, {
      nachStatus: ziel,
      vorher: fall.ergebnis,
      nachher: anwendung.herkunft.length > 0 ? anwendung.werte : undefined,
      entscheidung: anwendung.beschreibung,
      regel: 'regel' in entscheidung ? entscheidung.regel : undefined,
      bemerkung: entscheidung.bemerkung,
      vorgang: optionen.vorgang,
    });

    return { fall: neu, anwendung };
  }

  /* ---------- Mehrere gemeinsam (SPEC-07, Abschnitt 8) ---------- */

  /**
   * Was eine Massenentscheidung anrichten würde.
   *
   * „Vor der Ausführung müssen Umfang, betroffene Fälle und erwartete
   * Auswirkungen nachvollziehbar dargestellt und vom Benutzer bestätigt
   * werden." Diese Methode zeigt es; `massenentscheidung` führt es aus. Wer nur
   * die zweite aufruft, hat den Benutzer nicht gefragt — deshalb sind es zwei
   * Aufrufe und nicht ein Schalter.
   */
  async massenvorschau(ids: readonly string[], entscheidung: Entscheidung, optionen: Anwendungsoptionen): Promise<Massenvorschau> {
    const betroffen: Massenvorschau['betroffen'] = [];

    for (const id of ids) {
      const fall = await this.bestand.byId(id);

      if (!fall) {
        betroffen.push({ id, datensatz: '—', zulaessig: false, werte: {}, grund: 'Diesen Fall gibt es nicht' });
        continue;
      }

      const ziel = statusNach(entscheidung);

      if (!darfWechseln(fall.status, ziel)) {
        betroffen.push({
          id,
          datensatz: fall.datensatz,
          zulaessig: false,
          werte: {},
          grund: `Status „${fall.status}" lässt den Schritt nach „${ziel}" nicht zu`,
        });
        continue;
      }

      const anwendung = wendeAn(fall, entscheidung, await this.optionenFuer(fall, optionen));

      betroffen.push({
        id,
        datensatz: fall.datensatz,
        zulaessig: anwendung.zulaessig,
        werte: anwendung.werte,
        grund: anwendung.zulaessig ? undefined : anwendung.befunde.map((befund) => befund.ursache).join('; '),
      });
    }

    return { betroffen, moeglich: betroffen.filter((eintrag) => eintrag.zulaessig).length };
  }

  async massenentscheidung(
    ids: readonly string[],
    entscheidung: Entscheidung,
    benutzer: Benutzerangabe,
    optionen: Anwendungsoptionen & { jetzt?: Date }
  ): Promise<Massenergebnis> {
    const vorgang = randomUUID();
    const uebernommen: string[] = [];
    const abgelehnt: { id: string; grund: string }[] = [];

    for (const id of ids) {
      try {
        /*
         * Ohne `fassung`: Eine Massenentscheidung arbeitet auf einer eben
         * gelesenen Liste und nicht auf einer Ansicht, die jemand seit einer
         * Stunde offen hat. Die Sperrprüfung greift trotzdem — ein Fall, an
         * dem ein Kollege gerade sitzt, wird nicht mit erschlagen.
         */
        await this.entscheide(id, entscheidung, benutzer, { ...optionen, vorgang });
        uebernommen.push(id);
      } catch (fehler) {
        abgelehnt.push({ id, grund: fehler instanceof Error ? fehler.message : String(fehler) });
      }
    }

    /*
     * Ausdrücklich mit der Vorgangskennung: „Jede durch eine Massenentscheidung
     * vorgenommene Änderung muss den betroffenen Konfliktfällen eindeutig
     * zugeordnet und protokolliert werden" (SPEC-07, Abschnitt 8). Über diese
     * Kennung findet sich hinterher, was ein einziger Knopfdruck angerichtet hat.
     */
    this.logger?.log({
      timestamp: optionen.jetzt ?? new Date(),
      level: 'INFO',
      userId: benutzer.id,
      username: benutzer.name,
      message:
        `Massenentscheidung ${vorgang}: ${uebernommen.length} von ${ids.length} übernommen, ` +
        `${abgelehnt.length} abgelehnt`,
    });

    return { vorgang, betroffen: ids.length, uebernommen, abgelehnt };
  }

  /* ---------- Bearbeitungsstand ---------- */

  async standSpeichern(stand: Bearbeitungsstand): Promise<void> {
    await this.bestand.standSpeichern(stand);
  }

  async stand(benutzer: string, tenantId: string): Promise<Bearbeitungsstand | undefined> {
    return this.bestand.standOf(benutzer, tenantId);
  }

  /* ---------- Freigabe (SPEC-07, Abschnitt 13) ---------- */

  async freigabestand(tenantId: string, laufId?: string): Promise<Freigabestand> {
    const alle = await this.bestand.list(tenantId);

    return freigabestand(laufId ? alle.filter((fall) => fall.laufId === laufId) : alle);
  }

  /**
   * Die bereinigten Fälle für die erneute Verarbeitung.
   *
   * Was hier herauskommt, ist die **Konfliktzieldatei** aus dem Dateimodell:
   * eine Ausleitung. Der Fall selbst bleibt in der Datenbank, und seine
   * Historie auch — wird die Datei nach der Aufbewahrungsfrist fortgeräumt,
   * ist nichts verloren.
   */
  async zurVerarbeitung(
    tenantId: string,
    benutzer: Benutzerangabe,
    optionen: { laufId?: string; neuerLaufId: string; jetzt?: Date }
  ): Promise<{ felder: string[]; zeilen: string[][]; ids: string[] }> {
    const jetzt = optionen.jetzt ?? new Date();
    const alle = await this.bestand.list(tenantId, { status: ['BEREINIGT'] });
    const faelle = optionen.laufId ? alle.filter((fall) => fall.laufId === optionen.laufId) : alle;

    const felder = ['konflikt_uuid', ...new Set(faelle.flatMap((fall) => Object.keys(fall.ergebnis ?? {})))];
    const zeilen: string[][] = [];
    const ids: string[] = [];

    for (const fall of faelle) {
      // Die UUID reist mit (SPEC-07, Abschnitt 12), damit der Fall auch
      // außerhalb von Unikom wiedererkennbar bleibt.
      zeilen.push([fall.id, ...felder.slice(1).map((feld) => fall.ergebnis?.[feld] ?? '')]);
      ids.push(fall.id);

      await this.bestand.save({
        ...fall,
        status: 'ERNEUT_VERARBEITET',
        geaendert: jetzt.toISOString(),
        fassung: fall.fassung + 1,
      });

      await this.schritt(fall, 'ERNEUT_VERARBEITET', benutzer, jetzt, {
        nachStatus: 'ERNEUT_VERARBEITET',
        entscheidung: `zur erneuten Verarbeitung in Lauf ${optionen.neuerLaufId} gegeben`,
      });
    }

    return { felder, zeilen, ids };
  }

  /**
   * Der Abschluss: Die erneute Verarbeitung ist durch.
   *
   * „Ein bearbeiteter Konflikt gilt erst dann als erfolgreich verarbeitet, wenn
   * die anschließende Verarbeitung erfolgreich abgeschlossen wurde."
   */
  async abschliessen(
    ids: readonly string[],
    benutzer: Benutzerangabe,
    optionen: { laufId: string; jetzt?: Date }
  ): Promise<number> {
    const jetzt = optionen.jetzt ?? new Date();
    let erledigt = 0;

    for (const id of ids) {
      const fall = await this.bestand.byId(id);

      if (!fall || !darfWechseln(fall.status, 'ERFOLGREICH_VERARBEITET')) {
        continue;
      }

      await this.bestand.save({
        ...fall,
        status: 'ERFOLGREICH_VERARBEITET',
        geaendert: jetzt.toISOString(),
        fassung: fall.fassung + 1,
      });

      await this.schritt(fall, 'ABGESCHLOSSEN', benutzer, jetzt, {
        nachStatus: 'ERFOLGREICH_VERARBEITET',
        entscheidung: `in Lauf ${optionen.laufId} erfolgreich verarbeitet`,
      });

      erledigt += 1;
    }

    return erledigt;
  }

  /**
   * Ein Folgekonflikt aus der erneuten Verarbeitung.
   *
   * Kein neuer Status am alten Fall, sondern ein **neuer Fall mit einem Faden
   * zum alten** (SPEC-07, Abschnitt 13). Der alte behält seine Historie; wer
   * den neuen ansieht, findet über `entstandenAus` den ganzen Vorlauf.
   */
  async folgekonflikt(
    ausId: string,
    konflikt: Konsolidierungskonflikt,
    kopf: { laufId: string; benutzer: Benutzerangabe; jetzt?: Date }
  ): Promise<Konfliktfall> {
    const vorgaenger = await this.holen(ausId);
    const jetzt = (kopf.jetzt ?? new Date()).toISOString();

    const fall: Konfliktfall = {
      ...vorgaenger,
      id: randomUUID(),
      laufId: kopf.laufId,
      status: 'OFFEN',
      art: konflikt.art,
      ursache: konflikt.ursache,
      erwartet: konflikt.erwartet,
      vorgefunden: konflikt.vorgefunden,
      naechsteSchritte: konflikt.naechsteSchritte,
      ergebnis: undefined,
      sperre: undefined,
      entstanden: jetzt,
      geaendert: jetzt,
      entstandenAus: vorgaenger.id,
      fassung: 1,
    };

    await this.bestand.save(fall);
    await this.bestand.schrittAnfuegen({
      nummer: 1,
      fallId: fall.id,
      art: 'ENTSTANDEN',
      zeitpunkt: jetzt,
      benutzer: kopf.benutzer.id,
      benutzerName: kopf.benutzer.name,
      nachStatus: 'OFFEN',
      entscheidung: `aus der erneuten Verarbeitung von ${vorgaenger.id} entstanden`,
      regel: konflikt.art,
    });

    return fall;
  }

  /* ---------- innere Hilfen ---------- */

  private async holen(id: string): Promise<Konfliktfall> {
    const fall = await this.bestand.byId(id);

    if (!fall) {
      throw new KonfliktFehler(404, `Den Konfliktfall „${id}" gibt es nicht`);
    }

    return fall;
  }

  private async schritt(
    fall: Konfliktfall,
    art: Schrittart,
    benutzer: Benutzerangabe,
    jetzt: Date,
    teile: Partial<Bearbeitungsschritt> = {}
  ): Promise<void> {
    const historie = await this.bestand.historie(fall.id);
    const [schritt] = anfuegen(historie, {
      fallId: fall.id,
      art,
      zeitpunkt: jetzt.toISOString(),
      benutzer: benutzer.id,
      benutzerName: benutzer.name,
      vonStatus: fall.status,
      ...teile,
    }).slice(-1);

    await this.bestand.schrittAnfuegen(schritt);
  }
}

export class KonfliktFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly anwendung?: Anwendung
  ) {
    super(message);
    this.name = 'KonfliktFehler';
  }
}

/**
 * Wie schwer ein Konsolidierungskonflikt wiegt (SPEC-07, Abschnitt 2).
 *
 * Ein fehlender Hauptdatensatz und ein mehrdeutiger Referenztreffer sind
 * kritisch: Dort steht die Zugehörigkeit eines ganzen Datensatzes in Frage.
 * Ein Dublettenverdacht ist ein Prüffall — beide Datensätze sind gültig, es
 * geht nur um die Frage, ob sie einer sind.
 */
function kritikalitaetFuer(konflikt: Konsolidierungskonflikt): Kritikalitaet {
  switch (konflikt.art) {
    case 'STRUKTUR':
    case 'KEIN_SCHLUESSEL':
      return 'KRITISCH';

    case 'FEHLENDER_HAUPTSATZ':
    case 'MEHRFACHTREFFER':
    case 'OHNE_SCHLUESSELWERT':
      return 'KRITISCH';

    case 'DUBLETTE':
    case 'DUBLETTE_VERMUTET':
      return 'PRUEFFALL';

    case 'REFERENZ_MEHRDEUTIG':
      return 'PRUEFFALL';

    case 'REFERENZ_FEHLT':
      return 'WARNUNG';

    default:
      return 'KONFLIKT';
  }
}

/**
 * Die konkurrierenden Werte, vergleichbar gegenübergestellt (Abschnitt 4).
 *
 * Sie stehen im Bericht bei den Entscheidungen und den Konflikten. Was sich
 * nicht auf ein Feld zurückführen lässt — ein Strukturfehler etwa —, hat keine
 * Streitfelder: Dort gibt es nichts auszuwählen, sondern etwas zu berichtigen.
 */
function streitfelderAus(konflikt: Konsolidierungskonflikt, bericht: Konsolidierungsbericht): Streitfeld[] {
  if (!konflikt.feld) {
    return [];
  }

  /*
   * Zuerst das, was der Konflikt selbst mitbringt. Die Konsolidierung führt
   * die konkurrierenden Werte einzeln mit — nicht nur als Satz in
   * `vorgefunden` —, weil sich aus einem Satz keine Auswahl bauen lässt.
   */
  if (konflikt.angebote && konflikt.angebote.length > 0) {
    return [
      {
        feld: konflikt.feld,
        angebote: konflikt.angebote.map((angebot) => ({
          quelle: angebot.quelle,
          wert: angebot.wert,
          metadaten: angebot.hinweis ? { hinweis: angebot.hinweis } : undefined,
        })),
      },
    ];
  }

  const zeile = bericht.zeilen.find((eintrag) => eintrag.schluessel === konflikt.schluessel);
  const entscheidung = zeile?.entscheidungen.find((eintrag) => eintrag.feld === konflikt.feld);

  if (entscheidung) {
    return [
      {
        feld: konflikt.feld,
        angebote: [
          { quelle: entscheidung.quelle, wert: entscheidung.wert, metadaten: { regel: entscheidung.grund } },
          ...entscheidung.uebergangen.map((angebot) => ({ quelle: angebot.quelle, wert: angebot.wert })),
        ],
      },
    ];
  }

  /*
   * Bleibt nichts, bleibt ein Feld ohne Angebote — für Konflikte, bei denen es
   * nichts auszuwählen gibt, weil der Wert gar nicht strittig ist, sondern
   * fehlt. Dort trägt der Benutzer ihn ein.
   */
  return [{ feld: konflikt.feld, angebote: [] }];
}

function schrittartFuer(entscheidung: Entscheidung): Schrittart {
  switch (entscheidung.art) {
    case 'ZURUECKSTELLEN':
      return 'ZURUECKGESTELLT';

    case 'WIEDERAUFNEHMEN':
      return 'WIEDERAUFGENOMMEN';

    case 'AKZEPTIEREN':
      return 'AKZEPTIERT';

    default:
      return 'ENTSCHIEDEN';
  }
}

function freigabestand(faelle: readonly Konfliktfall[]): Freigabestand {
  const zaehle = (status: Konfliktstatus): number => faelle.filter((fall) => fall.status === status).length;
  const hindernd = faelle.filter(verhindertFreigabe);

  return {
    gesamt: faelle.length,
    bereinigt: zaehle('BEREINIGT'),
    offen: zaehle('OFFEN'),
    zurueckgestellt: zaehle('ZURUECKGESTELLT'),
    akzeptiert: zaehle('AKZEPTIERT'),
    kritischOffen: faelle.filter((fall) => fall.kritikalitaet === 'KRITISCH' && !istErledigt(fall.status)).length,
    erneutVerarbeitet: zaehle('ERNEUT_VERARBEITET'),
    erfolgreich: zaehle('ERFOLGREICH_VERARBEITET'),
    freigabeMoeglich: hindernd.length === 0,
    hindernisse: hindernd.map((fall) => ({
      id: fall.id,
      datensatz: fall.datensatz,
      kritikalitaet: fall.kritikalitaet,
      status: fall.status,
      ursache: fall.ursache,
    })),
  };
}
