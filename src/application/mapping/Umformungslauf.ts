import type { Quelle } from '../../domain/consolidation/Quellen.js';
import type { Aufteilung, Schritt, Zusammenfuehrung } from '../../domain/mapping/Umformung.js';
import { forme, fuehreZusammen, teileAuf } from '../../domain/mapping/Umformung.js';

/**
 * Umformungen auf die Quellen eines Laufs anwenden (SPEC-09, Abschnitt 8 und 9).
 *
 * ```text
 * 1. Felder putzen      trimmen, Schreibweise, Datum, Zahl
 * 2. Aufteilen          ein Feld wird mehrere
 * 3. Zusammenführen     mehrere Felder werden eines
 * ```
 *
 * ## Warum diese Reihenfolge feststeht
 *
 * Geputzt wird zuerst, weil ein Wert mit Leerzeichen am Rand sich anders teilt
 * als einer ohne. Aufgeteilt wird vor dem Zusammenführen, weil ein
 * Zusammenführen die Felder benutzen können soll, die eben erst entstanden sind
 * — umgekehrt gäbe es nichts zu gewinnen.
 *
 * Eine frei einstellbare Reihenfolge wäre die naheliegende Erweiterung und ein
 * schlechtes Geschäft: Sie verlangte von jedem, der einen Workflow einrichtet,
 * eine Entscheidung über etwas, das nur eine sinnvolle Antwort hat.
 *
 * ## Das Quellfeld bleibt stehen
 *
 * Wer „Name" in Vor- und Nachname teilt, behält „Name". „Bei Transformationen
 * dürfen keine Quellinformationen unbeabsichtigt verloren gehen" — und welche
 * Felder am Ende im Ergebnis stehen, entscheidet ohnehin die Zielstruktur der
 * Konsolidierung. Ein Feld hier fortzunehmen brächte nichts und könnte nur
 * schaden.
 */
export interface Feldumformung {
  feld: string;
  schritte: readonly Schritt[];
}

export interface Umformungsplan {
  felder?: readonly Feldumformung[];
  aufteilungen?: readonly Aufteilung[];
  zusammenfuehrungen?: readonly Zusammenfuehrung[];
}

/**
 * Ein Fall, der einem Menschen vorgelegt gehört.
 *
 * „Bei nicht eindeutig interpretierbaren Strukturen muss UniCom die mögliche
 * Transformation als verständlichen Vorschlag darstellen oder den Fall zur
 * Prüfung vorlegen."
 */
export interface Umformungspruefall {
  quelle: string;
  /** Die Zeile in der Quelle, ab 1. */
  zeile: number;
  feld: string;
  wert: string;
  hinweis: string;
}

export interface Umformungsbericht {
  quellen: Quelle[];
  /** Was geschah, zusammengefasst — nicht je Zeile, sondern je Regel. */
  hinweise: string[];
  pruefaelle: Umformungspruefall[];
  /** Wie viele Werte eine Regel wirklich verändert hat. */
  veraendert: number;
}

export function istLeer(plan: Umformungsplan | undefined): boolean {
  return (
    !plan ||
    ((plan.felder?.length ?? 0) === 0 &&
      (plan.aufteilungen?.length ?? 0) === 0 &&
      (plan.zusammenfuehrungen?.length ?? 0) === 0)
  );
}

export function wendeUmformungAn(quellen: readonly Quelle[], plan: Umformungsplan | undefined): Umformungsbericht {
  if (istLeer(plan)) {
    return { quellen: [...quellen], hinweise: [], pruefaelle: [], veraendert: 0 };
  }

  const hinweise: string[] = [];
  const pruefaelle: Umformungspruefall[] = [];
  let veraendert = 0;

  const umgeformt = quellen.map((quelle) => {
    /*
     * Je Quelle eine eigene Feldliste: Eine Aufteilung, deren Quellfeld es in
     * dieser Datei gar nicht gibt, darf dort auch keine leeren Zielspalten
     * anlegen — sonst stünde im Ergebnis eine Spalte, die nur aus Nichts
     * besteht, und die Vollständigkeitsprüfung fragte, wo ihre Werte blieben.
     */
    const felder = [...quelle.felder];
    const zeilen = quelle.zeilen.map((zeile) => new Map(quelle.felder.map((feld, spalte) => [feld, zeile[spalte] ?? ''])));

    for (const regel of plan?.felder ?? []) {
      if (!felder.includes(regel.feld)) {
        continue;
      }

      let getroffen = 0;

      zeilen.forEach((werte, stelle) => {
        const vorher = werte.get(regel.feld) ?? '';
        const ergebnis = forme(vorher, regel.schritte);

        if (ergebnis.hinweis) {
          pruefaelle.push({
            quelle: quelle.name,
            zeile: nummer(quelle, stelle),
            feld: regel.feld,
            wert: vorher,
            hinweis: ergebnis.hinweis,
          });
        }

        if (ergebnis.wert !== vorher) {
          werte.set(regel.feld, ergebnis.wert);
          getroffen += 1;
        }
      });

      veraendert += getroffen;

      if (getroffen > 0) {
        hinweise.push(`${quelle.name}: ${getroffen} Wert(e) in „${regel.feld}" umgeformt`);
      }
    }

    for (const regel of plan?.aufteilungen ?? []) {
      if (!felder.includes(regel.quelle)) {
        continue;
      }

      for (const ziel of regel.ziele) {
        if (!felder.includes(ziel)) {
          felder.push(ziel);
        }
      }

      let getroffen = 0;

      zeilen.forEach((werte, stelle) => {
        const wert = werte.get(regel.quelle) ?? '';
        const ergebnis = teileAuf(wert, regel);

        if (ergebnis.pruefhinweis) {
          pruefaelle.push({
            quelle: quelle.name,
            zeile: nummer(quelle, stelle),
            feld: regel.quelle,
            wert,
            hinweis: ergebnis.pruefhinweis,
          });

          return;
        }

        for (const [ziel, teil] of ergebnis.werte) {
          werte.set(ziel, teil);
        }

        if (ergebnis.werte.size > 0) {
          getroffen += 1;
        }
      });

      veraendert += getroffen;

      if (getroffen > 0) {
        hinweise.push(
          `${quelle.name}: „${regel.quelle}" in ${regel.ziele.join(', ')} aufgeteilt (${getroffen} Zeile(n))`
        );
      }
    }

    for (const regel of plan?.zusammenfuehrungen ?? []) {
      // Mindestens ein Quellfeld muss es hier geben — sonst entstünde eine
      // Spalte aus lauter leeren Werten.
      if (!regel.quellen.some((feld) => felder.includes(feld))) {
        continue;
      }

      if (!felder.includes(regel.ziel)) {
        felder.push(regel.ziel);
      }

      let getroffen = 0;

      for (const werte of zeilen) {
        const ergebnis = fuehreZusammen(werte, regel);

        if (ergebnis.wert !== (werte.get(regel.ziel) ?? '')) {
          werte.set(regel.ziel, ergebnis.wert);
          getroffen += 1;
        }
      }

      veraendert += getroffen;

      if (getroffen > 0) {
        hinweise.push(
          `${quelle.name}: ${regel.quellen.join(' + ')} zu „${regel.ziel}" zusammengeführt (${getroffen} Zeile(n))`
        );
      }
    }

    return {
      ...quelle,
      felder,
      zeilen: zeilen.map((werte) => felder.map((feld) => werte.get(feld) ?? '')),
    };
  });

  return { quellen: umgeformt, hinweise, pruefaelle, veraendert };
}

/** Die Nummer, die diese Zeile in der Datei hatte — siehe `Quelle.zeilenNummern`. */
function nummer(quelle: Quelle, stelle: number): number {
  return quelle.zeilenNummern?.[stelle] ?? stelle + 1;
}
