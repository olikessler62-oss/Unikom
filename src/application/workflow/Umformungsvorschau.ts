import type { Quelle } from '../../domain/consolidation/Quellen.js';
import type { Umformungsplan } from '../../domain/transfer/Konsolidierungsschritt.js';
import { liesDatei, type Lesewunsch } from './Eingang.js';
import type { Dateiablage } from './Dateiablage.js';
import { VorschauFehler, waehleVorschaudatei } from './Vorschaudatei.js';
import { wendeUmformungAn, type Umformungspruefall } from '../mapping/Umformungslauf.js';

/**
 * Was die eingestellten Umformungen mit einer echten Datei tun (SPEC-09 §11).
 *
 * ```text
 * name              →  nachname   vorname
 * „meier, anna"        „Meier"    „Anna"
 * „von der Heide"      ⚠ zerfällt nicht — Prüffall
 * ```
 *
 * ## Die Vorschau ist der Lauf, nur ohne Folgen
 *
 * Sie liest mit **demselben** Leser, formt mit **derselben** Maschine und
 * bricht an **denselben** Stellen ab. Eine Vorschau, die anders rechnet als der
 * Lauf, führt genau die Entscheidungen herbei, die sie verhindern soll: Jemand
 * sieht ein sauberes Ergebnis, schaltet den Workflow scharf, und nachts kommt
 * etwas anderes heraus.
 *
 * Deshalb steht hier keine zweite Rechnung, sondern nur der Zuschnitt: die
 * ersten Zeilen statt aller, und ein Vergleich vorher/nachher statt eines
 * Berichts.
 *
 * ## Warum der Server die Datei liest
 *
 * Die Datei liegt im Verzeichnis, das der Workflow benutzt — auf dem Rechner,
 * auf dem Unikom läuft. Sie im Browser zu öffnen hieße, den Benutzer eine Kopie
 * hochladen zu lassen und die Vorschau an einer Datei zu zeigen, die mit der
 * nächtlich verarbeiteten nur den Namen gemein hat.
 */
export const ZEILEN_VORSCHAU = 20;

export interface Vorschauwunsch extends Lesewunsch {
  verzeichnis: string;
  /** Der Dateiname; ohne Angabe die erste lesbare Datei des Verzeichnisses. */
  datei?: string;
  /** Wie viele Zeilen gezeigt werden. */
  zeilen?: number;
  umformung?: Umformungsplan;
}

export interface Feldvorschau {
  feld: string;
  /** Ob es das Feld vorher schon gab oder ob es erst entstanden ist. */
  neu: boolean;
  /** Ob die Umformung es angefasst hat. */
  veraendert: boolean;
}

export interface Zeilenvorschau {
  /** Die Nummer in der Datei, ab 1. */
  zeile: number;
  vorher: Record<string, string>;
  nachher: Record<string, string>;
  /** Die Felder, deren Wert sich geändert hat — für die Hervorhebung. */
  geaendert: string[];
}

export interface Umformungsvorschau {
  datei: string;
  /** Wie viele Zeilen die Datei hat; gezeigt werden die ersten. */
  datensaetze: number;
  gezeigt: number;
  felder: Feldvorschau[];
  zeilen: Zeilenvorschau[];
  /**
   * Was verloren ginge — die Zeilen, die der Lauf als Konflikt vorlegen würde.
   *
   * „mögliche Datenverluste" steht in SPEC-09, Abschnitt 11, ausdrücklich unter
   * dem, was eine Vorschau erkennbar machen muss. Sie sind der eigentliche
   * Grund, warum es sie gibt: Eine Aufteilung, die bei neunzehn von zwanzig
   * Zeilen aufgeht, sieht in einer Vorschau ohne diese Liste vollkommen in
   * Ordnung aus.
   */
  pruefaelle: Umformungspruefall[];
  hinweise: string[];
}

export class Umformungsvorschaudienst {
  constructor(private readonly ablage: Dateiablage) {}

  async zeige(wunsch: Vorschauwunsch): Promise<Umformungsvorschau> {
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
        gezeigt: 0,
        felder: [],
        zeilen: [],
        pruefaelle: [],
        hinweise: gelesen.hinweise,
      };
    }

    /*
     * Umgeformt wird die **ganze** Datei, gezeigt werden die ersten Zeilen.
     *
     * Nur die ersten zwanzig umzuformen wäre schneller und verschwiege genau
     * das, wofür die Vorschau da ist: Der Prüffall steckt selten in Zeile drei.
     * Eine Aufteilung, die bei neunzehn von zwanzig Zeilen aufgeht, sieht sonst
     * vollkommen in Ordnung aus.
     */
    const umgeformt = wendeUmformungAn([quelle], wunsch.umformung);
    const nachher = umgeformt.quellen[0];
    const wieviele = Math.min(wunsch.zeilen ?? ZEILEN_VORSCHAU, quelle.zeilen.length);

    return {
      datei: datei.name,
      datensaetze: quelle.zeilen.length,
      gezeigt: wieviele,
      felder: felderVergleich(quelle, nachher),
      zeilen: zeilenVergleich(quelle, nachher, wieviele),
      pruefaelle: umgeformt.pruefaelle,
      hinweise: [...gelesen.hinweise, ...umgeformt.hinweise],
    };
  }

}

/**
 * Welche Felder es vorher gab, welche neu sind und welche angefasst wurden.
 *
 * Ein Feld gilt als verändert, sobald **eine** Zeile sich unterscheidet. Erst
 * ab einem Anteil zu markieren wäre die freundlichere Anzeige und die
 * gefährlichere: Die eine Zeile, in der etwas geschieht, ist die, die man sehen
 * muss.
 */
function felderVergleich(vorher: Quelle, nachher: Quelle): Feldvorschau[] {
  return nachher.felder.map((feld) => {
    const alt = vorher.felder.indexOf(feld);
    const neu = nachher.felder.indexOf(feld);

    if (alt === -1) {
      return { feld, neu: true, veraendert: true };
    }

    const veraendert = vorher.zeilen.some(
      (zeile, stelle) => (zeile[alt] ?? '') !== (nachher.zeilen[stelle]?.[neu] ?? '')
    );

    return { feld, neu: false, veraendert };
  });
}

function zeilenVergleich(vorher: Quelle, nachher: Quelle, wieviele: number): Zeilenvorschau[] {
  const zeilen: Zeilenvorschau[] = [];

  for (let stelle = 0; stelle < wieviele; stelle += 1) {
    const alt = alsSatz(vorher, stelle);
    const neu = alsSatz(nachher, stelle);

    zeilen.push({
      zeile: vorher.zeilenNummern?.[stelle] ?? stelle + 1,
      vorher: alt,
      nachher: neu,
      geaendert: nachher.felder.filter((feld) => (alt[feld] ?? '') !== (neu[feld] ?? '')),
    });
  }

  return zeilen;
}

function alsSatz(quelle: Quelle, stelle: number): Record<string, string> {
  const zeile = quelle.zeilen[stelle] ?? [];

  return Object.fromEntries(quelle.felder.map((feld, spalte) => [feld, zeile[spalte] ?? '']));
}

export { VorschauFehler } from './Vorschaudatei.js';
