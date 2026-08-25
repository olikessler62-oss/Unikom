import type { Quelle } from './Quellen.js';
import { vergleichswert, type Vergleich, STANDARDVERGLEICH } from './Schluessel.js';

/**
 * Ein Schlüssel, den niemand eingerichtet hat (SPEC-04, Abschnitt 7).
 *
 * ## Warum das hier steht und nicht in `Schluessel.ts`
 *
 * Dort steht der Satz, um den es geht: „UniCom darf fachliche
 * Dublettenschlüssel nicht **eigenmächtig als verbindliche Wahrheit**
 * bestimmen." Deshalb gibt es dort keine Funktion, die einen Schlüssel errät —
 * und dabei bleibt es.
 *
 * Diese Datei rät auch nicht. Sie **prüft**, und sie bricht ab, sobald ein
 * Zweifel bleibt. Der Unterschied ist der ganze Punkt:
 *
 * ```text
 * raten    nimm das erste Feld, das halbwegs passt, und mach weiter
 * prüfen   nimm es nur, wenn die Wahl nachweislich keine ist
 * ```
 *
 * Ein Feld gilt als Schlüssel, wenn es in **jeder** Quelle vollständig gefüllt
 * und eindeutig ist und die Quellen sich darüber tatsächlich treffen. Gibt es
 * mehrere solche Felder, wird nicht ausgewählt — es wird geprüft, ob die Wahl
 * überhaupt einen Unterschied macht. Paaren alle Kandidaten dieselben Zeilen,
 * ist das Ergebnis dasselbe, gleich welchen man nimmt; dann ist es keine
 * Entscheidung, sondern eine Feststellung. Paaren sie verschieden, wird
 * abgebrochen.
 *
 * ## Warum ein Abbruch das richtige Ergebnis ist
 *
 * „Ist das nicht der Fall, wandern alle Dateien in das Gescheitert-Verzeichnis."
 * Eine Zusammenführung über einen falschen Schlüssel ergibt kein Fehlerbild,
 * sondern ein plausibel aussehendes Ergebnis mit falsch verbundenen Zeilen —
 * und das fällt Monate später auf, wenn überhaupt.
 */
export type Schluesselfund =
  | {
      art: 'GEFUNDEN';
      feld: string;
      /**
       * Weitere Felder, die dieselbe Paarung ergeben.
       *
       * Sie stehen dabei, weil sie die Aussage tragen: Es wurde nicht
       * ausgewählt, sondern festgestellt, dass die Auswahl gleichgültig ist.
       */
      gleichwertig: readonly string[];
    }
  | { art: 'KEINER'; grund: string }
  | { art: 'MEHRDEUTIG'; grund: string; kandidaten: readonly string[] };

export interface Fundoptionen {
  /** Werte, die als „nichts" gelten — ein leerer Wert taugt nicht als Schlüssel. */
  nullWerte?: readonly string[];
  vergleich?: Vergleich;
}

/**
 * Sucht ein Feld, über das sich diese Quellen zusammenführen lassen.
 *
 * Die **erste** Quelle ist die Primärdatei; an ihr wird gepaart. Bei einer
 * einzigen Quelle gibt es nichts zusammenzuführen — dann ist auch kein
 * Schlüssel nötig, und die Antwort sagt das, statt einen zu erfinden.
 */
export function findeSchluessel(quellen: readonly Quelle[], optionen: Fundoptionen = {}): Schluesselfund {
  if (quellen.length < 2) {
    return { art: 'KEINER', grund: 'Es gibt nur eine Quelle — zusammenzuführen ist nichts' };
  }

  const gemeinsame = gemeinsameFelder(quellen);

  if (gemeinsame.length === 0) {
    return {
      art: 'KEINER',
      grund: 'Kein Feld kommt in allen Quellen vor — sie haben keine Spalte gemeinsam',
    };
  }

  const kandidaten = gemeinsame.filter((feld) => taugt(feld, quellen, optionen));

  if (kandidaten.length === 0) {
    return {
      art: 'KEINER',
      grund:
        `Keines der gemeinsamen Felder (${gemeinsame.join(', ')}) ist in jeder Quelle vollständig gefüllt, ` +
        'eindeutig und in den anderen wiederzufinden',
    };
  }

  /*
   * Mehrere Kandidaten sind kein Problem, solange sie dasselbe tun. Erst wenn
   * sie verschiedene Zeilen paaren, steht eine echte Entscheidung an — und die
   * trifft Unikom nicht.
   */
  const abweichend = kandidaten.filter((feld) => !paartWieDerErste(feld, kandidaten[0], quellen, optionen));

  if (abweichend.length > 0) {
    return {
      art: 'MEHRDEUTIG',
      kandidaten,
      grund:
        `Mehrere Felder kämen als Schlüssel infrage (${kandidaten.join(', ')}), und sie führen zu ` +
        `verschiedenen Zuordnungen — „${kandidaten[0]}" und „${abweichend[0]}" paaren nicht dieselben Zeilen`,
    };
  }

  return { art: 'GEFUNDEN', feld: kandidaten[0], gleichwertig: kandidaten.slice(1) };
}

/** Felder, die in jeder Quelle vorkommen — in der Reihenfolge der ersten. */
function gemeinsameFelder(quellen: readonly Quelle[]): string[] {
  const [erste, ...weitere] = quellen;

  return erste.felder.filter((feld) => weitere.every((quelle) => quelle.felder.includes(feld)));
}

/**
 * Ob dieses Feld in jeder Quelle als Schlüssel taugt.
 *
 * Drei Bedingungen, und jede fängt einen anderen Irrtum:
 *
 * ```text
 * vollständig   ein leerer Wert paart sich mit jedem anderen leeren
 * eindeutig     zwei gleiche Werte in einer Quelle: welche Zeile ist gemeint?
 * treffend      Werte, die sich nirgends wiederfinden, verbinden nichts
 * ```
 *
 * Die dritte ist die, an die man zuletzt denkt: Eine laufende Nummer ist in
 * jeder Datei vollständig und eindeutig — und paart „Zeile 1 mit Zeile 1",
 * was zufällig aussieht wie ein Ergebnis.
 */
function taugt(feld: string, quellen: readonly Quelle[], optionen: Fundoptionen): boolean {
  const mengen = quellen.map((quelle) => werteVon(feld, quelle, optionen));

  if (mengen.some((werte) => werte === undefined)) {
    return false;
  }

  const [erste, ...weitere] = mengen as Set<string>[];

  return weitere.every((menge) => [...menge].some((wert) => erste.has(wert)));
}

/**
 * Die Vergleichswerte dieses Feldes — oder nichts, wenn es nicht taugt.
 *
 * Eine **leere** Quelle wird hier nicht eigens abgewiesen. Sie ergibt eine
 * leere Menge, und an der scheitert die Trefferbedingung von selbst: Wo keine
 * Werte sind, trifft sich nichts. Eine zweite Prüfung dafür sah richtig aus
 * und war unwirksam — keine Mutation konnte sie umbringen, weil kein Verhalten
 * an ihr hing.
 */
function werteVon(feld: string, quelle: Quelle, optionen: Fundoptionen): Set<string> | undefined {
  const stelle = quelle.felder.indexOf(feld);
  const werte = new Set<string>();
  const nichts = new Set((optionen.nullWerte ?? []).map((wert) => wert.trim().toLowerCase()));

  if (stelle < 0) {
    return undefined;
  }

  for (const zeile of quelle.zeilen) {
    const roh = (zeile[stelle] ?? '').trim();

    if (roh === '' || nichts.has(roh.toLowerCase())) {
      return undefined;
    }

    const wert = vergleichswert(roh, optionen.vergleich ?? STANDARDVERGLEICH);

    if (werte.has(wert)) {
      return undefined;
    }

    werte.add(wert);
  }

  return werte;
}

/**
 * Ob zwei Kandidaten dieselben Zeilen paaren.
 *
 * Verglichen wird gegen die **Primärdatei**: Für jede Zeile jeder weiteren
 * Quelle muss beides auf dieselbe Zeile der Primärdatei zeigen — oder beides
 * auf keine. Trifft der eine, wo der andere danebengreift, ist die Wahl
 * zwischen ihnen eine Entscheidung, und die trifft Unikom nicht.
 */
function paartWieDerErste(
  feld: string,
  erster: string,
  quellen: readonly Quelle[],
  optionen: Fundoptionen
): boolean {
  const [primaer, ...weitere] = quellen;

  for (const quelle of weitere) {
    const nachFeld = paarung(feld, primaer, quelle, optionen);
    const nachErstem = paarung(erster, primaer, quelle, optionen);

    if (nachFeld.length !== nachErstem.length) {
      return false;
    }

    if (nachFeld.some((stelle, zeile) => stelle !== nachErstem[zeile])) {
      return false;
    }
  }

  return true;
}

/** Je Zeile der Quelle: die Stelle in der Primärdatei, oder -1. */
function paarung(feld: string, primaer: Quelle, quelle: Quelle, optionen: Fundoptionen): number[] {
  const vergleich = optionen.vergleich ?? STANDARDVERGLEICH;
  const links = primaer.felder.indexOf(feld);
  const rechts = quelle.felder.indexOf(feld);
  const stellen = new Map<string, number>();

  primaer.zeilen.forEach((zeile, stelle) => {
    stellen.set(vergleichswert((zeile[links] ?? '').trim(), vergleich), stelle);
  });

  return quelle.zeilen.map((zeile) => stellen.get(vergleichswert((zeile[rechts] ?? '').trim(), vergleich)) ?? -1);
}
