import { randomUUID } from 'node:crypto';

import type { Ebene } from '../../domain/consolidation/Einstellungen.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import { AUSGELIEFERT, normalisiere, type Bezeichnung } from '../../domain/mapping/Bezeichnungen.js';
import { ordneAlleZu, type Spalte, type Zuordnungsvorschlag } from '../../domain/mapping/Feldzuordnung.js';
import {
  darfRegelWerden,
  waehle,
  wirkt,
  type Mappingart,
  type MappingRepository,
  type Mappingregel,
} from '../../domain/mapping/Regelbestand.js';

/**
 * Mappings anwenden, vorschlagen, bestätigen und zurücknehmen (SPEC-02,
 * Abschnitt 15 bis 19; SPEC-09, Abschnitt 11).
 *
 * Der Dienst ist die einzige Stelle, an der eine Regel entsteht oder ihre
 * Wirkung verliert. Das ist Absicht: Jede dieser Handlungen gehört ins
 * Protokoll, und eine zweite Stelle, die still eine Regel anlegt, wäre genau
 * die, die es eines Tages vergisst.
 */

/** Die Vorschau eines Mapping-Ergebnisses (SPEC-09, Abschnitt 11). */
export interface Mappingvorschau {
  tenantId: string;
  profilId?: string;
  /** Je Spalte: was daraus wird, und warum. */
  zuordnungen: Zugeordnet[];
  /** Die Zahlen, auf die ein Mensch zuerst sieht. */
  uebernommen: number;
  vorgeschlagen: number;
  offen: number;
}

export interface Zugeordnet extends Zuordnungsvorschlag {
  /** Ob dahinter eine bestätigte Regel steht — dann ist es keine Vermutung. */
  ausRegel?: string;
  /** Ob diese Zuordnung schon eine dauerhafte Regel ist. */
  istRegel: boolean;
}

export interface Wertbeobachtung {
  von: string;
  nach: string;
  feld?: string;
  sicherheit: number;
}

/** Was beim Beobachten herauskam — auch ein Nein ist eine Auskunft. */
export interface Lernergebnis {
  gelernt: boolean;
  grund: string;
  regel?: Mappingregel;
  /** Ein Widerspruch zu einer bestehenden Regel (SPEC-02, Abschnitt 18). */
  widerspruch?: { regel: Mappingregel; beobachtet: string };
}

export class MappingService {
  constructor(
    private readonly regeln: MappingRepository,
    private readonly logger: Logger,
    private readonly liste: readonly Bezeichnung[] = AUSGELIEFERT
  ) {}

  /**
   * Die geltende Bezeichnungsliste.
   *
   * Sie steht hier, damit eine Oberfläche die internen Felder zur Auswahl
   * anbieten kann. Ohne sie müsste jemand `customerId` von Hand tippen — und
   * ein Tippfehler legt eine Regel an, die auf ein Feld zeigt, das es nicht
   * gibt.
   */
  get bezeichnungen(): readonly Bezeichnung[] {
    return this.liste;
  }

  async alle(tenantId?: string): Promise<Mappingregel[]> {
    return this.regeln.list(tenantId);
  }

  /**
   * Die Vorschau vor der Anwendung.
   *
   * Sie zeigt drei Gruppen: was ohne Rückfrage übernommen wird, was zur
   * Bestätigung vorliegt und was offen bleibt. Der Benutzer soll sich auf die
   * unklaren Fälle beschränken können — dafür müssen die klaren als klar
   * erkennbar sein und nicht in derselben Liste stehen.
   */
  async vorschau(
    spalten: readonly Spalte[],
    ort: { tenantId: string; profilId?: string }
  ): Promise<Mappingvorschau> {
    const bestand = await this.regeln.list(ort.tenantId);
    const bekannt = new Map<string, string>();

    for (const spalte of spalten) {
      const treffer = waehle(bestand, {
        art: 'FELD',
        von: spalte.name,
        tenantId: ort.tenantId,
        profilId: ort.profilId,
      });

      if (treffer) {
        bekannt.set(spalte.name, treffer.regel.nach);
      }
    }

    const vorschlaege = ordneAlleZu(spalten, { liste: this.liste, bekannt });

    const zuordnungen: Zugeordnet[] = vorschlaege.map((vorschlag) => {
      const treffer = waehle(bestand, {
        art: 'FELD',
        von: vorschlag.spalte,
        tenantId: ort.tenantId,
        profilId: ort.profilId,
      });

      return { ...vorschlag, ausRegel: treffer?.grund, istRegel: treffer !== undefined };
    });

    return {
      tenantId: ort.tenantId,
      profilId: ort.profilId,
      zuordnungen,
      uebernommen: zuordnungen.filter((eintrag) => eintrag.sicherheit === 'EINDEUTIG').length,
      vorgeschlagen: zuordnungen.filter((eintrag) => eintrag.sicherheit === 'VORSCHLAG').length,
      offen: zuordnungen.filter((eintrag) => eintrag.sicherheit === 'MEHRDEUTIG').length,
    };
  }

  /**
   * Macht aus einer Zuordnung eine dauerhafte Regel.
   *
   * Der einzige Weg, auf dem ein **Feldmapping** entsteht. Für ein Wertmapping
   * ist es der schnelle Weg; den langsamen geht `beobachte`.
   */
  async bestaetige(auftrag: {
    art: Mappingart;
    von: string;
    nach: string;
    feld?: string;
    ebene: Ebene;
    tenantId?: string;
    profilId?: string;
    wer?: { id: string; name: string };
  }): Promise<Mappingregel> {
    const vorhanden = (await this.regeln.list(auftrag.tenantId)).find(
      (regel) =>
        regel.art === auftrag.art &&
        regel.ebene === auftrag.ebene &&
        normalisiere(regel.von) === normalisiere(auftrag.von) &&
        normalisiere(regel.feld ?? '') === normalisiere(auftrag.feld ?? '') &&
        regel.tenantId === auftrag.tenantId &&
        regel.profilId === auftrag.profilId
    );

    /*
     * Eine bestehende Regel wird bestätigt, nicht verdoppelt. Zwei Regeln mit
     * demselben Ausgangswert wären ein Bestand, in dem niemand mehr sagen kann,
     * welche gilt — und die Rangfolge müsste eine Münze werfen.
     */
    const regel: Mappingregel = vorhanden
      ? {
          ...vorhanden,
          nach: auftrag.nach,
          bestaetigt: true,
          bestaetigungen: vorhanden.bestaetigungen + 1,
          vorlaeufig: false,
          zurueckgenommen: undefined,
        }
      : {
          id: randomUUID(),
          art: auftrag.art,
          ebene: auftrag.ebene,
          tenantId: auftrag.ebene === 'ALLGEMEIN' ? undefined : auftrag.tenantId,
          profilId: auftrag.ebene === 'PROFIL' ? auftrag.profilId : undefined,
          feld: auftrag.feld,
          von: auftrag.von,
          nach: auftrag.nach,
          herkunft: 'BENUTZER',
          bestaetigt: true,
          bestaetigungen: 1,
          anwendungen: 0,
          erstellt: new Date(),
          erstelltVon: auftrag.wer?.id,
          erstelltVonName: auftrag.wer?.name,
        };

    await this.regeln.save(regel);

    this.logger.log({
      timestamp: new Date(),
      level: 'INFO',
      userId: auftrag.wer?.id,
      username: auftrag.wer?.name,
      message:
        `${auftrag.art === 'FELD' ? 'Feldmapping' : 'Wertmapping'} bestätigt: ` +
        `„${regel.von}" → „${regel.nach}"${regel.feld ? ` im Feld „${regel.feld}"` : ''} ` +
        `(${regel.ebene.toLowerCase()}, ${regel.bestaetigungen}. Bestätigung)`,
    });

    return regel;
  }

  /**
   * Eine beobachtete Wertzuordnung — der Weg, auf dem Unikom selbst lernt.
   *
   * Hier greift der Schutz vor falschem Umlernen (SPEC-02, Abschnitt 18): Sagt
   * die Beobachtung etwas anderes als eine bestehende Regel, wird die Regel
   * **nicht** geändert. Es entsteht ein Widerspruch, den ein Mensch auflöst.
   * Ein System, das sich durch einzelne fehlerhafte Eingangsdaten selbst
   * umlernt, ist nach drei Monaten nicht mehr zu gebrauchen.
   */
  async beobachte(
    beobachtung: Wertbeobachtung,
    ort: { tenantId: string; profilId?: string }
  ): Promise<Lernergebnis> {
    const bestand = await this.regeln.list(ort.tenantId);
    const treffer = waehle(bestand, {
      art: 'WERT',
      von: beobachtung.von,
      feld: beobachtung.feld,
      tenantId: ort.tenantId,
      profilId: ort.profilId,
    });

    if (treffer && normalisiere(treffer.regel.nach) !== normalisiere(beobachtung.nach)) {
      this.logger.log({
        timestamp: new Date(),
        level: 'WARNING',
        message:
          `Widerspruch beim Wertmapping: „${beobachtung.von}" steht als „${treffer.regel.nach}" im Bestand, ` +
          `beobachtet wurde „${beobachtung.nach}". Die Regel bleibt, bis ein Mensch entscheidet`,
      });

      return {
        gelernt: false,
        grund:
          `Zu „${beobachtung.von}" gibt es bereits die Regel „${treffer.regel.nach}". ` +
          'Eine bestehende Regel wird nicht wegen eines einzelnen abweichenden Datensatzes geändert',
        widerspruch: { regel: treffer.regel, beobachtet: beobachtung.nach },
      };
    }

    if (treffer) {
      // Dieselbe Zuordnung noch einmal: Sie zählt und bleibt, wie sie ist.
      const gestaerkt = { ...treffer.regel, bestaetigungen: treffer.regel.bestaetigungen + 1 };

      await this.regeln.save(gestaerkt);

      return { gelernt: false, grund: 'Diese Regel gibt es bereits; sie wurde bestätigt', regel: gestaerkt };
    }

    /*
     * Die vorläufige Notiz von einer früheren Beobachtung.
     *
     * Ohne sie wäre der Lernweg „wiederholt beobachtet" nicht zu erreichen:
     * Die zweite Beobachtung wäre wieder die erste, und die Regel entstünde
     * nie. Sie wirkt nicht — sie zählt nur mit.
     */
    const vorlaeufig = bestand.find(
      (regel) =>
        regel.art === 'WERT' &&
        regel.vorlaeufig === true &&
        !regel.zurueckgenommen &&
        normalisiere(regel.von) === normalisiere(beobachtung.von) &&
        normalisiere(regel.feld ?? '') === normalisiere(beobachtung.feld ?? '') &&
        normalisiere(regel.nach) === normalisiere(beobachtung.nach)
    );

    const urteil = darfRegelWerden('WERT', beobachtung, {
      bestaetigungen: vorlaeufig?.bestaetigungen ?? 0,
      durchMenschen: false,
    });

    if (!urteil.erlaubt) {
      const notiz: Mappingregel = vorlaeufig
        ? { ...vorlaeufig, bestaetigungen: vorlaeufig.bestaetigungen + 1 }
        : {
            id: randomUUID(),
            art: 'WERT',
            ebene: 'MANDANT',
            tenantId: ort.tenantId,
            feld: beobachtung.feld,
            von: beobachtung.von,
            nach: beobachtung.nach,
            herkunft: 'GELERNT',
            bestaetigt: false,
            bestaetigungen: 1,
            anwendungen: 0,
            erstellt: new Date(),
            vorlaeufig: true,
          };

      await this.regeln.save(notiz);

      return { gelernt: false, grund: urteil.grund, regel: notiz };
    }

    const regel: Mappingregel = {
      id: vorlaeufig?.id ?? randomUUID(),
      art: 'WERT',
      ebene: 'MANDANT',
      tenantId: ort.tenantId,
      feld: beobachtung.feld,
      von: beobachtung.von,
      nach: beobachtung.nach,
      herkunft: 'GELERNT',
      /*
       * Gelernt heißt nicht bestätigt. Ein Wertmapping wirkt trotzdem (SPEC-02,
       * Abschnitt 15) — die Angabe steht hier, damit die Verwaltung zeigen
       * kann, was ein Mensch entschieden hat und was Unikom sich selbst
       * angeeignet hat.
       */
      bestaetigt: false,
      bestaetigungen: (vorlaeufig?.bestaetigungen ?? 0) + 1,
      anwendungen: 0,
      erstellt: vorlaeufig?.erstellt ?? new Date(),
      vorlaeufig: false,
    };

    await this.regeln.save(regel);

    this.logger.log({
      timestamp: new Date(),
      level: 'INFO',
      message: `Wertmapping gelernt: „${regel.von}" → „${regel.nach}"${regel.feld ? ` im Feld „${regel.feld}"` : ''}. ${urteil.grund}`,
    });

    return { gelernt: true, grund: urteil.grund, regel };
  }

  /**
   * Nimmt eine Regel zurück.
   *
   * Sie bleibt im Bestand und wirkt nicht mehr. Gelöscht wird sie nicht: Wer
   * wissen will, warum ein Lauf vom März etwas zugeordnet hat, das heute
   * niemand mehr zuordnet, findet die Antwort sonst nirgends.
   */
  async nimmZurueck(id: string, wer?: { id: string; name: string }): Promise<Mappingregel> {
    const regel = await this.regeln.getById(id);

    if (!regel) {
      throw new Error(`Eine Mapping-Regel mit der Kennung ${id} gibt es nicht`);
    }

    const zurueck = { ...regel, zurueckgenommen: new Date() };

    await this.regeln.save(zurueck);

    this.logger.log({
      timestamp: new Date(),
      level: 'WARNING',
      userId: wer?.id,
      username: wer?.name,
      message:
        `Mapping zurückgenommen: „${regel.von}" → „${regel.nach}". ` +
        `Es wirkte ${regel.anwendungen}-mal und bleibt zur Nachvollziehbarkeit im Bestand`,
    });

    return zurueck;
  }

  /** Nimmt eine Rücknahme zurück — dieselbe Regel gilt wieder. */
  async gibFrei(id: string, wer?: { id: string; name: string }): Promise<Mappingregel> {
    const regel = await this.regeln.getById(id);

    if (!regel) {
      throw new Error(`Eine Mapping-Regel mit der Kennung ${id} gibt es nicht`);
    }

    const frei = { ...regel, zurueckgenommen: undefined };

    await this.regeln.save(frei);

    this.logger.log({
      timestamp: new Date(),
      level: 'INFO',
      userId: wer?.id,
      username: wer?.name,
      message: `Mapping wieder in Kraft gesetzt: „${regel.von}" → „${regel.nach}"`,
    });

    return frei;
  }

  /**
   * Wendet die Wertmappings auf eine Spalte an.
   *
   * Zurück kommt der Wert **und** ob eine Regel gegriffen hat. Ein Wert, der
   * still ersetzt wurde, ist im Ergebnis nicht mehr von einem zu unterscheiden,
   * der so geliefert wurde — und dann streiten zwei Leute darüber, ob die Quelle
   * „Frankfurt am Main" geschrieben hat.
   */
  async wendeAn(
    werte: readonly string[],
    feld: string,
    ort: { tenantId: string; profilId?: string }
  ): Promise<{ werte: string[]; ersetzungen: { von: string; nach: string; grund: string }[] }> {
    const bestand = (await this.regeln.list(ort.tenantId)).filter(wirkt);
    const ersetzungen: { von: string; nach: string; grund: string }[] = [];

    const ergebnis = werte.map((wert) => {
      const treffer = waehle(bestand, {
        art: 'WERT',
        von: wert,
        feld,
        tenantId: ort.tenantId,
        profilId: ort.profilId,
      });

      if (!treffer) {
        return wert;
      }

      if (!ersetzungen.some((eintrag) => eintrag.von === wert)) {
        ersetzungen.push({ von: wert, nach: treffer.regel.nach, grund: treffer.grund });
      }

      return treffer.regel.nach;
    });

    return { werte: ergebnis, ersetzungen };
  }
}
