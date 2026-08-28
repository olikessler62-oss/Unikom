import { CONFIDENCE_THRESHOLD } from './Recognition.js';
import type { Einstellungsname, Mandanteneinstellungen } from './Einstellungen.js';

/**
 * Was an einer Einstellung nicht stimmen kann (SPEC-02, Abschnitt 40).
 *
 * ## Warum es diese Datei gibt
 *
 * Die Mandantenebene ist die, die in der Hierarchie **gewinnt**. Ein Zahlendreher
 * dort wirkt sich auf jeden Lauf jedes Workflows dieses Kunden aus, und er fällt
 * nicht auf: Eine Stichprobe von `3` liefert Typen — nur eben geratene. Ein
 * Jahrhundertwechsel bei `150` schaltet die zweistellige Jahreslesart still ab.
 *
 * Deshalb wird geprüft, bevor gespeichert wird, und deshalb steht die Prüfung
 * hier und nicht in der Schnittstelle: Sie gehört zu den Werten, nicht zu dem
 * Weg, auf dem sie ankommen.
 *
 * ## Die Grenzen sind Aussagen, keine Vorsichtsmaßnahmen
 *
 * Jede von ihnen benennt einen Zustand, in dem das Erzeugnis etwas behaupten
 * würde, das es nicht weiß.
 */
export interface Einstellungsfehler {
  name: Einstellungsname;
  /** Der Satz, den ein Mensch liest — er nennt den Wert und was daran nicht geht. */
  grund: string;
}

/**
 * Unter dieser Schwelle passt nicht einmal die Mehrheit der Werte zum erkannten
 * Typ. Was dann herauskommt, ist keine Erkennung mehr, sondern eine Vermutung
 * mit einer Zahl daneben.
 */
export const KONFIDENZ_MINDESTENS = 0.5;

/** Weniger als das ist keine Stichprobe, sondern ein Blick. */
export const STICHPROBE_MINDESTENS = 10;

export function pruefeEinstellungen(einstellungen: Mandanteneinstellungen): Einstellungsfehler[] {
  const fehler: Einstellungsfehler[] = [];

  const { jahrhundertGrenze, nullWerte, stichprobe, stichprobeGrenze, mindestKonfidenz } = einstellungen;

  if (jahrhundertGrenze !== undefined) {
    if (!Number.isInteger(jahrhundertGrenze) || jahrhundertGrenze < 0 || jahrhundertGrenze > 99) {
      fehler.push({
        name: 'jahrhundertGrenze',
        grund:
          `Die Jahrhundertgrenze ist eine zweistellige Jahreszahl zwischen 0 und 99; „${String(jahrhundertGrenze)}" ` +
          'ist keine. Sie sagt, ab welcher Zahl das vorige Jahrhundert gemeint ist: Bei 50 wird 49 zu 2049 und 50 zu 1950',
      });
    }
  }

  if (nullWerte !== undefined) {
    for (const wert of nullWerte) {
      if (wert.trim() === '') {
        fehler.push({
          name: 'nullWerte',
          grund:
            'Ein leerer Eintrag in der Liste der Nullwerte hat keine Wirkung - ein leeres Feld gilt ohnehin als ' +
            'nichts. Er stünde nur da und ließe vermuten, es sei etwas eingestellt',
        });
        break;
      }
    }

    const gesehen = new Set<string>();

    for (const wert of nullWerte) {
      if (gesehen.has(wert)) {
        fehler.push({ name: 'nullWerte', grund: `„${wert}" steht zweimal in der Liste` });
        break;
      }

      gesehen.add(wert);
    }
  }

  if (stichprobe !== undefined && (!Number.isInteger(stichprobe) || stichprobe < STICHPROBE_MINDESTENS)) {
    fehler.push({
      name: 'stichprobe',
      grund:
        `Die Stichprobe muss mindestens ${STICHPROBE_MINDESTENS} Werte umfassen; „${String(stichprobe)}" ist zu ` +
        'wenig. Aus drei Werten einen Feldtyp abzuleiten ergibt Typen, die vor der ersten echten Lieferung gelten ' +
        'und danach nicht mehr',
    });
  }

  if (stichprobeGrenze !== undefined) {
    if (!Number.isInteger(stichprobeGrenze) || stichprobeGrenze < STICHPROBE_MINDESTENS) {
      fehler.push({
        name: 'stichprobeGrenze',
        grund: `Die Obergrenze der Stichprobe muss mindestens ${STICHPROBE_MINDESTENS} sein`,
      });
    } else if (stichprobe !== undefined && stichprobeGrenze < stichprobe) {
      /*
       * Die Grenze ist das, worauf **erweitert** wird, wenn die Stichprobe
       * nicht reicht. Liegt sie darunter, wird eine Erweiterung zur Kürzung —
       * und ausgerechnet der unsichere Fall bekäme weniger Belege als der sichere.
       */
      fehler.push({
        name: 'stichprobeGrenze',
        grund:
          `Die Obergrenze (${stichprobeGrenze}) liegt unter der Stichprobe (${stichprobe}). Sie ist das, worauf ` +
          'erweitert wird, wenn die Stichprobe nicht ausreicht - darunter würde aus der Erweiterung eine Kürzung',
      });
    }
  }

  if (mindestKonfidenz !== undefined) {
    if (
      typeof mindestKonfidenz !== 'number' ||
      Number.isNaN(mindestKonfidenz) ||
      mindestKonfidenz < KONFIDENZ_MINDESTENS ||
      mindestKonfidenz > 1
    ) {
      fehler.push({
        name: 'mindestKonfidenz',
        grund:
          `Die Mindestkonfidenz liegt zwischen ${KONFIDENZ_MINDESTENS} und 1; „${String(mindestKonfidenz)}" liegt ` +
          'außerhalb. Darunter passt nicht einmal die Mehrheit der Werte zum erkannten Typ, und das ist keine ' +
          'Erkennung mehr, sondern eine Vermutung mit einer Zahl daneben',
      });
    }
  }

  return fehler;
}

/**
 * Was ein Wert unter 0,97 **nicht** bewirkt.
 *
 * Die Mindestkonfidenz dient zwei Dingen: der Typerkennung und der Frage, ab
 * wann Unikom einen Wertekonflikt selbst entscheiden darf. Für das Zweite gilt
 * 0,97 als Untergrenze, gleich was hier steht (siehe `entscheide`). Ein Kunde
 * darf die Typerkennung lockern; er darf sich damit keine automatischen
 * Entscheidungen erkaufen, die sonst ein Mensch träfe.
 */
export function senktNurDieTyperkennung(mindestKonfidenz?: number): boolean {
  return mindestKonfidenz !== undefined && mindestKonfidenz < CONFIDENCE_THRESHOLD;
}
