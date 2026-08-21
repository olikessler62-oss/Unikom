import type { FieldType } from '../../domain/consolidation/Recognition.js';
import { recogniseField, SAMPLE_SIZE } from '../../domain/consolidation/Recognition.js';
import type { Spalte } from '../../domain/mapping/Feldzuordnung.js';
import type { MappingService, Zugeordnet } from '../mapping/MappingService.js';
import type { Dateiablage } from './Dateiablage.js';
import { liesDatei, type Lesewunsch } from './Eingang.js';
import { waehleVorschaudatei } from './Vorschaudatei.js';

/**
 * Welchem internen Feld eine Spalte entspricht — an einer echten Datei
 * (SPEC-09, Abschnitt 11).
 *
 * ```text
 * Kd-Nr.      →  Kundennummer   sicher
 * Nachname    →  Nachname       sicher
 * Ort         →  ?              zwei Kandidaten — der Mensch entscheidet
 * Bemerkung   →  —              steht in keiner Bezeichnungsliste
 * ```
 *
 * ## Die andere Frage
 *
 * Die Umformungsvorschau zeigt, was mit den **Werten** geschieht. Diese hier
 * zeigt, welchem Feld eine **Spalte** überhaupt entspricht — ob „Kd-Nr.",
 * „KdNr" und „Kundennummer" alle dasselbe meinen. Beide Antworten braucht, wer
 * einen Workflow einrichtet, und beide an derselben Stelle.
 *
 * ## Warum es sie geben muss
 *
 * Die Erkennung gibt es seit Anfang an, und sie ordnet auch zu. Gesehen hat sie
 * nie jemand: Ohne Bildschirm kann niemand eine falsche Vermutung berichtigen
 * und keine unsichere bestätigen — und ohne Bestätigung entsteht keine
 * dauerhafte Regel, die beim nächsten Mal von selbst greift (SPEC-02,
 * Abschnitt 15). Eine Erkennung, die niemand korrigieren kann, lernt nichts.
 *
 * ## Der Server liest die Datei
 *
 * Wie bei der Umformungsvorschau, und aus demselben Grund: Die Datei liegt im
 * Verzeichnis, das der Workflow benutzt. Eine hochgeladene Kopie hätte mit der
 * nächtlich verarbeiteten nur den Namen gemein.
 */
export const BEISPIELE = 3;

export interface Spaltenvorschau extends Zugeordnet {
  /** Was die Typerkennung über die Werte sagt — sie entscheidet mit. */
  typ: FieldType;
  /** Ein paar echte Werte; ohne sie ist keine Vermutung zu prüfen. */
  beispiele: string[];
  /** Wie viele Werte der Spalte leer sind — über die ganze Datei gezählt. */
  leer: number;
}

/** Ein internes Feld zur Auswahl, wenn jemand eine Zuordnung berichtigt. */
export interface Feldangebot {
  intern: string;
  label: string;
  typen: FieldType[];
}

export interface Zuordnungsvorschau {
  datei: string;
  datensaetze: number;
  spalten: Spaltenvorschau[];
  /** Die Zahlen, auf die ein Mensch zuerst sieht. */
  uebernommen: number;
  vorgeschlagen: number;
  offen: number;
  /**
   * Die internen Felder zur Auswahl.
   *
   * Sie stehen dabei, weil eine Berichtigung sonst bedeutete, `customerId` von
   * Hand zu tippen — und wer sich vertippt, legt eine Regel an, die auf ein
   * Feld zeigt, das es nicht gibt.
   */
  felder: Feldangebot[];
  hinweise: string[];
}

export interface Zuordnungswunsch extends Lesewunsch {
  verzeichnis: string;
  /** Der Dateiname; ohne Angabe die erste lesbare Datei des Verzeichnisses. */
  datei?: string;
  tenantId: string;
  profilId?: string;
}

export class Zuordnungsvorschaudienst {
  constructor(
    private readonly ablage: Dateiablage,
    private readonly mappings: MappingService
  ) {}

  async zeige(wunsch: Zuordnungswunsch): Promise<Zuordnungsvorschau> {
    const datei = await waehleVorschaudatei(this.ablage, wunsch);
    const gelesen = liesDatei(
      { name: datei.name, bytes: await this.ablage.lies(datei.pfad), geaendert: datei.geaendert },
      wunsch
    );

    const quelle = gelesen.quellen[0];

    if (!quelle) {
      return {
        datei: datei.name,
        datensaetze: 0,
        spalten: [],
        uebernommen: 0,
        vorgeschlagen: 0,
        offen: 0,
        felder: this.angebot(),
        hinweise: gelesen.hinweise,
      };
    }

    const untersucht = quelle.felder.map((feld, stelle) => {
      const werte = quelle.zeilen.map((zeile) => zeile[stelle] ?? '');
      const gefuellt = werte.filter((wert) => wert.trim() !== '');

      return {
        spalte: {
          name: feld,
          typ: recogniseField(feld, werte, wunsch).type,
          /*
           * Nur eine Stichprobe an die Zuordnung.
           *
           * Sie prüft mit den Werten, ob der Name hält, was er verspricht —
           * eine Spalte „E-Mail" ohne E-Mail-Adressen ist keine. Das ist ein
           * grober Blick und kein Bericht; ihn über eine halbe Million Zeilen
           * laufen zu lassen kostet Zeit, die eine Vorschau nicht hat. Die
           * Stichprobe ist dieselbe wie bei der Typerkennung, damit es im
           * Produkt eine Zahl gibt und nicht zwei.
           */
          werte: gefuellt.slice(0, SAMPLE_SIZE),
        } satisfies Spalte,
        beispiele: gefuellt.slice(0, BEISPIELE),
        /* Über die ganze Datei gezählt: Ein Anteil aus der Stichprobe sähe aus wie eine Aussage über die Datei. */
        leer: werte.length - gefuellt.length,
      };
    });

    const vorschau = await this.mappings.vorschau(
      untersucht.map((eintrag) => eintrag.spalte),
      { tenantId: wunsch.tenantId, profilId: wunsch.profilId }
    );

    return {
      datei: datei.name,
      datensaetze: quelle.zeilen.length,
      spalten: vorschau.zuordnungen.map((zuordnung, stelle) => ({
        ...zuordnung,
        typ: untersucht[stelle].spalte.typ,
        beispiele: untersucht[stelle].beispiele,
        leer: untersucht[stelle].leer,
      })),
      uebernommen: vorschau.uebernommen,
      vorgeschlagen: vorschau.vorgeschlagen,
      offen: vorschau.offen,
      felder: this.angebot(),
      hinweise: gelesen.hinweise,
    };
  }

  private angebot(): Feldangebot[] {
    return this.mappings.bezeichnungen.map((bezeichnung) => ({
      intern: bezeichnung.intern,
      label: bezeichnung.label,
      typen: [...(bezeichnung.typen ?? [])],
    }));
  }
}
