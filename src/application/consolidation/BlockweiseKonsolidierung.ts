import { blockFuer, planeBloecke, type Blockoptionen, type Blockplan } from '../../domain/consolidation/Blockplan.js';
import type { Datensatz, Quelle } from '../../domain/consolidation/Quellen.js';
import { datensaetze as saetzeVon } from '../../domain/consolidation/Quellen.js';
import { schluesselVon, type Schluessel } from '../../domain/consolidation/Schluessel.js';
import {
  fortschritt,
  offeneBloecke,
  passenZumPlan,
  type Fortschritt,
  type Zwischenstand,
  type Zwischenstandbestand,
} from '../../domain/consolidation/Zwischenstand.js';
import type { Logger } from '../../domain/logging/LogEntry.js';
import type {
  ConsolidationService,
  Konsolidierungsauftrag,
  Konsolidierungsbericht,
} from './ConsolidationService.js';

/**
 * Die Konsolidierung in Schritten (SPEC-06, Abschnitt 15).
 *
 * ```text
 * Plan          wie viele Schritte, wie groß
 * Aufteilen     jeder Schlüssel in genau einen Schritt
 * je Schritt    konsolidieren → Zwischenstand speichern → Fortschritt melden
 * am Ende       Teilberichte zu einem Bericht zusammenfassen
 * ```
 *
 * ## Der Normalfall geht unverändert hindurch
 *
 * Bei einem Block wird nichts aufgeteilt, nichts zwischengespeichert und nichts
 * zusammengefasst — es läuft genau der Weg von vorher. Das ist Absicht: Der
 * Aufwand blockweiser Verarbeitung lohnt bei fünftausend Datensätzen nicht, und
 * ein zweiter Weg durch dieselbe Rechnung wäre die Stelle, an der die beiden
 * eines Tages verschiedene Ergebnisse liefern.
 *
 * ## Was ein Block nicht sehen kann
 *
 * Ein Block kennt nur seine eigenen Datensätze. Das ist für alles richtig, was
 * am Schlüssel hängt — Gruppieren, Zusammenführen, Dubletten, Mehrfachtreffer —,
 * und **falsch** für alles, was über Schlüsselgrenzen hinwegsieht:
 *
 * - **Ergänzung** vergleicht Datensätze, die sich an anderen Feldern ähneln.
 * - **Ähnlichkeitssuche** vergleicht jeden mit jedem.
 *
 * Beides würde blockweise weniger finden als in einem Zug — und niemand sähe
 * dem Ergebnis an, dass etwas fehlt. Deshalb wird es nicht stillschweigend
 * eingeschränkt, sondern **benannt**: Der Bericht bekommt einen Hinweis, und
 * die Entscheidung, ob das genügt, trifft ein Mensch.
 */
export interface Blocklauf {
  laufId: string;
  /** Wird nach jedem Schritt gerufen — für Bildschirm und Protokoll. */
  melde?(stand: Fortschritt): void;
  optionen?: Blockoptionen;
}

export class BlockweiseKonsolidierung {
  constructor(
    private readonly dienst: ConsolidationService,
    private readonly bestand: Zwischenstandbestand<Konsolidierungsbericht>,
    private readonly logger?: Logger
  ) {}

  /**
   * Wie viele Schritte dieser Auftrag braucht — bevor irgendetwas geschieht.
   *
   * Getrennt vom Ausführen, weil der Bildschirm die Zahl vorher zeigen soll:
   * „die Anzahl geplanter Schritte" steht in SPEC-06, Abschnitt 15, unter dem,
   * worüber der Benutzer transparent informiert wird.
   */
  plane(auftrag: Konsolidierungsauftrag, optionen?: Blockoptionen): Blockplan {
    return planeBloecke(
      auftrag.quellen.reduce((summe, quelle) => summe + quelle.zeilen.length, 0),
      optionen
    );
  }

  async konsolidiere(auftrag: Konsolidierungsauftrag, lauf: Blocklauf): Promise<Konsolidierungsbericht> {
    const plan = this.plane(auftrag, lauf.optionen);

    if (plan.bloecke === 1) {
      return this.dienst.konsolidiere(auftrag);
    }

    const vorhanden = await this.bestand.auskunft(lauf.laufId);

    if (!passenZumPlan(plan.bloecke, vorhanden)) {
      /*
       * Die gespeicherten Schritte gehören zu einer anderen Aufteilung. Ein
       * Lauf aus zwei Aufteilungen ergäbe ein Ergebnis, in dem manche
       * Datensätze zweimal und andere gar nicht stehen.
       */
      this.protokoll(
        lauf.laufId,
        'WARNING',
        `Die gespeicherten Zwischenstände gehören zu einer anderen Aufteilung; der Lauf beginnt von vorn ` +
          `(${plan.bloecke} Schritte)`
      );

      await this.bestand.entferne(lauf.laufId);
    }

    this.protokoll(lauf.laufId, 'INFO', plan.begruendung);

    const bloecke = this.teileAuf(auftrag, plan.bloecke);
    const offen = offeneBloecke(plan.bloecke, passenZumPlan(plan.bloecke, vorhanden) ? vorhanden : []);

    if (offen.length < plan.bloecke) {
      this.protokoll(
        lauf.laufId,
        'INFO',
        `${plan.bloecke - offen.length} von ${plan.bloecke} Schritten liegen aus einem früheren Lauf vor und ` +
          'werden nicht wiederholt'
      );
    }

    let verarbeitet = plan.datensaetze - offen.reduce((summe, nummer) => summe + zaehle(bloecke[nummer]), 0);

    for (const nummer of offen) {
      const teilauftrag: Konsolidierungsauftrag = { ...auftrag, quellen: bloecke[nummer] };
      const teilbericht = this.dienst.konsolidiere(teilauftrag);
      const menge = zaehle(bloecke[nummer]);

      await this.bestand.speichere({
        laufId: lauf.laufId,
        block: nummer,
        bloecke: plan.bloecke,
        datensaetze: menge,
        teilbericht,
        fertig: new Date().toISOString(),
      });

      verarbeitet += menge;

      const stand = fortschritt(nummer + 1, plan.bloecke, verarbeitet, plan.datensaetze);

      lauf.melde?.(stand);
      this.protokoll(lauf.laufId, 'INFO', stand.text);
    }

    /*
     * Einer nach dem anderen und nicht alle auf einmal.
     *
     * Zwölf Teilberichte gleichzeitig im Arbeitsspeicher wären derselbe Berg,
     * den die Aufteilung vermeiden sollte — sie stünden dann neben dem
     * zusammengefassten Bericht ein zweites Mal da. Gemessen war die
     * blockweise Verarbeitung damit **teurer** als der Lauf in einem Zug.
     */
    const teile: Konsolidierungsbericht[] = [];

    for (let nummer = 0; nummer < plan.bloecke; nummer += 1) {
      const stand = await this.bestand.lies(lauf.laufId, nummer);

      if (stand && stand.bloecke === plan.bloecke) {
        teile.push(stand.teilbericht);
      }
    }

    const bericht = fasseZusammen(teile);

    bericht.hinweise.push(
      `Der Lauf wurde in ${plan.bloecke} Schritten verarbeitet. Innerhalb eines Schrittes liegen alle Datensätze ` +
        'eines Schlüssels beisammen; das Ergänzen fehlender Werte und die Suche nach ähnlichen Datensätzen sehen ' +
        'jedoch nur den eigenen Schritt und finden deshalb weniger als ein Lauf in einem Zug'
    );

    await this.bestand.entferne(lauf.laufId);

    return bericht;
  }

  /**
   * Die Quellen auf Blöcke verteilen — jeder Schlüssel in genau einen.
   *
   * Die Zeilennummern gehen mit: Ein Block enthält nur einen Teil der Zeilen,
   * und ohne die ursprünglichen Nummern zeigte jede Herkunftsangabe auf die
   * falsche Zeile. Das fiele niemandem auf — die Nummern sähen plausibel aus.
   */
  private teileAuf(auftrag: Konsolidierungsauftrag, bloecke: number): Quelle[][] {
    const verteilung: Quelle[][] = Array.from({ length: bloecke }, () => []);

    for (const quelle of auftrag.quellen) {
      const faecher: { zeilen: (readonly string[])[]; nummern: number[] }[] = Array.from(
        { length: bloecke },
        () => ({ zeilen: [], nummern: [] })
      );

      saetzeVon(quelle).forEach((datensatz, stelle) => {
        const nummer = blockFuer(blockschluessel(datensatz, auftrag.schluessel, quelle.id, stelle), bloecke);

        faecher[nummer].zeilen.push(quelle.zeilen[stelle]);
        faecher[nummer].nummern.push(datensatz.zeile);
      });

      faecher.forEach((fach, nummer) => {
        if (fach.zeilen.length > 0) {
          verteilung[nummer].push({ ...quelle, zeilen: fach.zeilen, zeilenNummern: fach.nummern });
        }
      });
    }

    return verteilung;
  }

  private protokoll(laufId: string, level: 'INFO' | 'WARNING', message: string): void {
    this.logger?.log({ timestamp: new Date(), level, runId: laufId, message });
  }
}

/**
 * Woran sich entscheidet, in welchen Block ein Datensatz kommt.
 *
 * Ohne Schlüssel gibt es keine Gruppen — dann ist jede Aufteilung zulässig, und
 * gewählt wird eine, die sich wiederholen lässt: Quelle und Zeile. Einen
 * Zufallswert zu nehmen wäre einfacher und machte jede Fortsetzung unmöglich.
 */
function blockschluessel(
  datensatz: Datensatz,
  schluessel: Schluessel | undefined,
  quelle: string,
  stelle: number
): string {
  if (!schluessel || schluessel.felder.length === 0) {
    return `${quelle}#${stelle}`;
  }

  const wert = schluesselVon(datensatz, schluessel);

  /*
   * Ein Datensatz ohne Schlüsselwert gehört zu keiner Gruppe. Er kommt in einen
   * Block, der sich aus seiner Herkunft ergibt — alle in denselben zu legen
   * ergäbe bei einer Datei mit vielen Lücken einen Block, der alles trägt.
   */
  return wert.ok ? wert.wert : `${quelle}#${stelle}`;
}

function zaehle(quellen: readonly Quelle[]): number {
  return quellen.reduce((summe, quelle) => summe + quelle.zeilen.length, 0);
}

/**
 * Aus Teilberichten einen Bericht machen.
 *
 * Listen werden aneinandergehängt, Zahlen summiert — und die beiden Angaben,
 * die für den ganzen Lauf gelten, zusammengeführt: Die **Felder** sind die
 * Vereinigung aller Blöcke, denn ein Feld, das nur in Block 3 vorkam, gehört
 * ins Ergebnis. Die **Quellen** werden je Kennung zusammengezählt, sonst stünde
 * dieselbe Datei so oft in der Liste, wie sie Blöcke berührt hat.
 */
export function fasseZusammen(teile: readonly Konsolidierungsbericht[]): Konsolidierungsbericht {
  const felder: string[] = [];
  const quellen = new Map<string, Konsolidierungsbericht['quellen'][number]>();

  for (const teil of teile) {
    for (const feld of teil.felder) {
      if (!felder.includes(feld)) {
        felder.push(feld);
      }
    }

    for (const quelle of teil.quellen) {
      const bekannt = quellen.get(quelle.id);

      quellen.set(
        quelle.id,
        bekannt ? { ...bekannt, datensaetze: bekannt.datensaetze + quelle.datensaetze } : { ...quelle }
      );
    }
  }

  const referenzen = new Map<string, Konsolidierungsbericht['referenzen'][number]>();

  for (const teil of teile) {
    for (const bericht of teil.referenzen) {
      const bekannt = referenzen.get(bericht.bestand);

      referenzen.set(
        bericht.bestand,
        bekannt
          ? {
              ...bekannt,
              treffer: bekannt.treffer + bericht.treffer,
              ohneTreffer: bekannt.ohneTreffer + bericht.ohneTreffer,
              mehrdeutig: bekannt.mehrdeutig + bericht.mehrdeutig,
              uebernahmen: bekannt.uebernahmen + bericht.uebernahmen,
            }
          : { ...bericht }
      );
    }
  }

  return {
    quellen: [...quellen.values()],
    felder,
    zeilen: teile.flatMap((teil) => teil.zeilen),
    konflikte: teile.flatMap((teil) => teil.konflikte),
    dubletten: teile.flatMap((teil) => teil.dubletten),
    zurueckgestellt: teile.flatMap((teil) => teil.zurueckgestellt),
    verdacht: teile.flatMap((teil) => teil.verdacht),
    nichtVerarbeitet: teile.flatMap((teil) => teil.nichtVerarbeitet),
    ergaenzungen: teile.flatMap((teil) => teil.ergaenzungen),
    ergaenzungsluecken: teile.flatMap((teil) => teil.ergaenzungsluecken),
    referenzen: [...referenzen.values()],
    // Derselbe Hinweis aus zwölf Blöcken ist zwölfmal derselbe Satz.
    hinweise: [...new Set(teile.flatMap((teil) => teil.hinweise))],
    zusammenfassung: {
      // Die Zahl der Quellen ist keine Summe: Dieselbe Datei zählt einmal.
      quellen: quellen.size,
      gelesen: summe(teile, 'gelesen'),
      ergebnis: summe(teile, 'ergebnis'),
      zusammengefuehrt: summe(teile, 'zusammengefuehrt'),
      dubletten: summe(teile, 'dubletten'),
      konflikte: summe(teile, 'konflikte'),
      ergaenzt: summe(teile, 'ergaenzt'),
      verdacht: summe(teile, 'verdacht'),
      nichtVerarbeitet: summe(teile, 'nichtVerarbeitet'),
    },
  };
}

function summe(
  teile: readonly Konsolidierungsbericht[],
  name: keyof Konsolidierungsbericht['zusammenfassung']
): number {
  return teile.reduce((gesamt, teil) => gesamt + teil.zusammenfassung[name], 0);
}
