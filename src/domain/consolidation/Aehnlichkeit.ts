import type { Datensatz } from './Quellen.js';
import { STANDARDVERGLEICH, vergleichswert, type Vergleich } from './Schluessel.js';

/**
 * Fuzzy Matching (SPEC-04, Abschnitt 6 und 7).
 *
 * ## Der eine Satz, an dem alles hängt
 *
 * „**Ähnlichkeit allein berechtigt nicht zu einer automatischen
 * Zusammenführung.**"
 *
 * Diese Datei führt deshalb nichts zusammen. Sie stellt Fragen:
 *
 * ```text
 * Meier, Hans, 1970-03-04   ┐
 * Maier, Hans, 1970-03-04   ┘  → 0,92 → „Könnten dieselben sein?"
 * ```
 *
 * Beide Datensätze laufen weiter, beide stehen im Ergebnis, und daneben steht
 * ein Prüffall. Das ist der ganze Unterschied zum Vergleichswert aus
 * `Schluessel`: Dort ist „Müller" **gleich** „Mueller", weil jemand eine
 * Faltungsregel eingerichtet hat — eine erklärte Gleichheit. Hier ist „Meier"
 * **ähnlich** „Maier", und das ist eine Beobachtung, keine Gleichheit. Wer aus
 * einer Beobachtung eine Zusammenführung macht, verschmilzt irgendwann zwei
 * Kunden, die es beide gibt.
 *
 * ## Warum Buchstabendreher eigens zählen
 *
 * Gemessen wird mit der Levenshtein-Distanz, erweitert um die Vertauschung
 * benachbarter Zeichen (OSA). „Mülelr" ist von „Müller" **eine** Änderung
 * entfernt und nicht zwei — der Dreher ist der häufigste Tippfehler überhaupt,
 * und ohne diese Erweiterung fiele er unter die Schwelle, während ein
 * beliebiger anderer Fehler sie hielte.
 *
 * ## Warum das Minimum und nicht der Durchschnitt
 *
 * Bei mehreren Feldern zählt das **schwächste**. Bei „Nachname + Vorname +
 * Geburtsdatum" würde ein Durchschnitt ein völlig anderes Geburtsdatum durch
 * zwei passende Namen ausgleichen — und genau daran erkennt man zwei
 * verschiedene Personen mit demselben Namen.
 */
export interface Aehnlichkeitsregeln {
  /** Woran verglichen wird. Das erste Feld trägt die Vorauswahl. */
  felder: readonly string[];
  /** Ab wann zwei Datensätze als verdächtig gelten. */
  schwelle?: number;
  vergleich?: Vergleich;
  /** Ab wie vielen Datensätzen abgebrochen wird, statt lange zu rechnen. */
  hoechstens?: number;
}

/**
 * Die Voreinstellung für „ähnlich genug, um zu fragen".
 *
 * Bei einem Namen von zwölf Zeichen sind das knapp zwei Änderungen. Tiefer
 * angesetzt wird jede zweite Firma zum Prüffall, und ein Prüffallberg wird
 * genauso wenig gelesen wie gar keiner.
 *
 * **Für kurze Kennungen ist sie zu hoch.** Bei fünf Zeichen — einer
 * Postleitzahl, einem Kürzel — lässt 0,85 rechnerisch **keine einzige**
 * Änderung zu: Die Suche fände dort nur, was ohnehin gleich ist. Wer gegen
 * kurze Werte sucht, setzt die Schwelle ausdrücklich herab; deshalb steht sie
 * an jeder Regel und nicht nur hier.
 */
export const AEHNLICH_AB = 0.85;

/**
 * Wie viele Datensätze höchstens verglichen werden.
 *
 * Jeder mit jedem sind bei n Datensätzen n·(n−1)/2 Vergleiche — bei 2000 sind
 * das zwei Millionen, bei 20 000 zweihundert Millionen. Deshalb wird abgebrochen
 * **und gesagt**, dass abgebrochen wurde. Ein Lauf, der eine halbe Stunde
 * rechnet, ohne dass jemand weiß warum, ist schlimmer als eine Meldung.
 */
export const HOECHSTENS = 2000;

/**
 * Die Levenshtein-Distanz mit Vertauschung benachbarter Zeichen.
 *
 * `grenze` bricht ab, sobald feststeht, dass sie nicht mehr unterschritten
 * werden kann — bei einem Vergleich jeder mit jedem ist das der Unterschied
 * zwischen Sekunden und Minuten. Zurückgegeben wird dann `grenze + 1`: ein
 * Wert, der nur sagt „weiter weg als gefragt", und mehr braucht der Aufrufer
 * nicht.
 */
export function abstand(links: string, rechts: string, grenze = Number.POSITIVE_INFINITY): number {
  if (links === rechts) {
    return 0;
  }

  if (links.length === 0 || rechts.length === 0) {
    return Math.max(links.length, rechts.length);
  }

  // Der Längenunterschied ist eine untere Schranke: Jedes fehlende Zeichen ist
  // mindestens eine Änderung. Das erspart in der Masse die meiste Arbeit.
  if (Math.abs(links.length - rechts.length) > grenze) {
    return grenze + 1;
  }

  let vorvor: number[] = [];
  let vor: number[] = Array.from({ length: rechts.length + 1 }, (unbenutzt, spalte) => spalte);
  let jetzt: number[] = new Array(rechts.length + 1);

  for (let zeile = 1; zeile <= links.length; zeile += 1) {
    jetzt[0] = zeile;
    let kleinste = jetzt[0];

    for (let spalte = 1; spalte <= rechts.length; spalte += 1) {
      const kosten = links[zeile - 1] === rechts[spalte - 1] ? 0 : 1;

      let wert = Math.min(
        vor[spalte] + 1, // Zeichen fehlt rechts
        jetzt[spalte - 1] + 1, // Zeichen fehlt links
        vor[spalte - 1] + kosten // ersetzt oder gleich
      );

      if (
        zeile > 1 &&
        spalte > 1 &&
        links[zeile - 1] === rechts[spalte - 2] &&
        links[zeile - 2] === rechts[spalte - 1]
      ) {
        // Der Buchstabendreher: „Mülelr" gegen „Müller" ist eine Änderung.
        wert = Math.min(wert, vorvor[spalte - 2] + 1);
      }

      jetzt[spalte] = wert;

      if (wert < kleinste) {
        kleinste = wert;
      }
    }

    if (kleinste > grenze) {
      return grenze + 1;
    }

    const frei = vorvor;
    vorvor = vor;
    vor = jetzt;
    jetzt = frei.length === rechts.length + 1 ? frei : new Array(rechts.length + 1);
  }

  return vor[rechts.length];
}

/**
 * Wie viel Rundungsfehler beim Umrechnen der Schwelle in Änderungen zählt.
 *
 * `(1 − 0,8) × 5` ist in Gleitkomma nicht 1, sondern 0,9999999999999998 — und
 * abgerundet null. Ohne diesen Zuschlag erlaubte eine Schwelle von 0,8 bei
 * fünf Zeichen **keine einzige** Änderung, und die Ähnlichkeitssuche fände nur
 * noch, was ohnehin gleich ist. Der Fehler saß in einer Zeile, die richtig
 * aussah, und wurde von einem Test über Postleitzahlen gefunden.
 */
const RUNDUNGSLUFT = 1e-9;

/**
 * Zwischen 0 und 1 — 1 heißt Zeichen für Zeichen gleich.
 *
 * Mit `schwelle` arbeitet die Funktion als Filter: Alles darunter kommt als
 * **0** zurück, ohne zu Ende gerechnet zu werden. Der Aufrufer prüft deshalb
 * `> 0` und nicht `>= schwelle` — die Schwelle wird an einer Stelle geprüft,
 * und zwar in ganzen Änderungen statt in Bruchzahlen, die sich um ein
 * Millionstel verfehlen.
 */
export function aehnlichkeit(links: string, rechts: string, schwelle = 0): number {
  const laenge = Math.max(links.length, rechts.length);

  if (laenge === 0) {
    return 1;
  }

  /*
   * Aus der Schwelle wird eine Abbruchgrenze für die Distanz: Wer 0,85 verlangt,
   * braucht bei zwölf Zeichen höchstens 1,8 Änderungen. Alles darüber muss gar
   * nicht mehr genau ausgerechnet werden.
   */
  const grenze =
    schwelle > 0 ? Math.floor((1 - schwelle) * laenge + RUNDUNGSLUFT) : Number.POSITIVE_INFINITY;
  const gemessen = abstand(links, rechts, grenze);

  return gemessen > grenze ? 0 : 1 - gemessen / laenge;
}

export interface Feldvergleich {
  feld: string;
  links: string;
  rechts: string;
  wert: number;
}

export interface Verdacht {
  /** Die Stellen in der übergebenen Liste, ab 0. */
  links: number;
  rechts: number;
  /** Die Ähnlichkeit insgesamt — das schwächste Feld. */
  wert: number;
  felder: Feldvergleich[];
}

export interface Verdachtsergebnis {
  paare: Verdacht[];
  /** Gesetzt, wenn nicht verglichen wurde — mit dem Grund. */
  abgebrochen?: string;
  /** Wie viele Paare wirklich gerechnet wurden. */
  vergleiche: number;
}

interface Kandidat {
  stelle: number;
  werte: string[];
}

/**
 * Verdächtig ähnliche Paare.
 *
 * Zurück kommen **Paare und keine Gruppen**. Aus „A ähnelt B" und „B ähnelt C"
 * eine Dreiergruppe zu machen, hieße Ähnlichkeit für übertragbar zu halten —
 * das ist sie nicht: Bei einer Schwelle von 0,85 kann A zu C beliebig weit weg
 * sein. Wer drei Datensätze zusammenlegen will, sieht drei Fragen und
 * beantwortet sie einzeln.
 */
export function verdaechtigePaare(
  datensaetze: readonly Datensatz[],
  regeln: Aehnlichkeitsregeln
): Verdachtsergebnis {
  const schwelle = regeln.schwelle ?? AEHNLICH_AB;
  const vergleich = regeln.vergleich ?? STANDARDVERGLEICH;
  const hoechstens = regeln.hoechstens ?? HOECHSTENS;

  if (regeln.felder.length === 0) {
    return { paare: [], vergleiche: 0, abgebrochen: 'Es ist kein Feld angegeben, an dem die Ähnlichkeit zu messen wäre' };
  }

  if (datensaetze.length > hoechstens) {
    return {
      paare: [],
      vergleiche: 0,
      abgebrochen:
        `Die Ähnlichkeitssuche vergleicht jeden Datensatz mit jedem - bei ${datensaetze.length} Datensätzen ` +
        `wären das ${Math.round((datensaetze.length * (datensaetze.length - 1)) / 2).toLocaleString('de-DE')} Vergleiche. ` +
        `Abgebrochen ab ${hoechstens.toLocaleString('de-DE')}. Ein engerer Vorfilter - etwa erst nach Postleitzahl ` +
        'gruppieren und dann je Gruppe suchen - kommt zum selben Ergebnis in einem Bruchteil der Zeit',
    };
  }

  /*
   * Nur Datensätze, die in **allen** Vergleichsfeldern etwas stehen haben. Ein
   * fehlendes Merkmal ist kein Beleg für Gleichheit; es leer gegen leer zu
   * halten ergäbe volle Übereinstimmung, und plötzlich wären alle
   * unvollständigen Datensätze einander verdächtig ähnlich.
   */
  const kandidaten: Kandidat[] = [];

  datensaetze.forEach((datensatz, stelle) => {
    const werte: string[] = [];

    for (const feld of regeln.felder) {
      const wert = (datensatz.werte.get(feld) ?? '').trim();

      if (wert === '') {
        return;
      }

      werte.push(vergleichswert(wert, vergleich));
    }

    kandidaten.push({ stelle, werte });
  });

  /*
   * Sortiert nach der Länge des ersten Vergleichsfeldes. Das ist keine
   * Näherung, sondern eine gültige Abkürzung: Die Distanz ist mindestens der
   * Längenunterschied, also kann das erste Feld die Schwelle nur halten,
   * solange die längere Seite höchstens `länge / schwelle` misst. Ab dort
   * bricht die innere Schleife ab — und weil das Minimum über alle Felder
   * zählt, ist damit auch das Paar erledigt.
   */
  kandidaten.sort((links, rechts) => links.werte[0].length - rechts.werte[0].length);

  const paare: Verdacht[] = [];
  let vergleiche = 0;

  for (let i = 0; i < kandidaten.length; i += 1) {
    const links = kandidaten[i];
    const reichweite = schwelle > 0 ? links.werte[0].length / schwelle : Number.POSITIVE_INFINITY;

    for (let j = i + 1; j < kandidaten.length; j += 1) {
      const rechts = kandidaten[j];

      if (rechts.werte[0].length > reichweite) {
        break;
      }

      vergleiche += 1;

      const felder: Feldvergleich[] = [];
      let kleinste = 1;

      for (let feld = 0; feld < regeln.felder.length; feld += 1) {
        const wert = aehnlichkeit(links.werte[feld], rechts.werte[feld], schwelle);

        felder.push({
          feld: regeln.felder[feld],
          links: datensaetze[links.stelle].werte.get(regeln.felder[feld]) ?? '',
          rechts: datensaetze[rechts.stelle].werte.get(regeln.felder[feld]) ?? '',
          wert,
        });

        if (wert < kleinste) {
          kleinste = wert;
        }

        if (kleinste === 0) {
          // Ein Feld unter der Schwelle kommt als 0 zurück; das Minimum kann
          // sich nicht mehr erholen, und die übrigen Felder brauchen es nicht
          // zu erfahren.
          break;
        }
      }

      if (kleinste > 0) {
        // Immer in der Reihenfolge der Eingabe, nicht in der der Sortierung —
        // ein Bericht, in dem „Zeile 9 ähnelt Zeile 3" steht, liest sich rückwärts.
        const [erster, zweiter] =
          links.stelle <= rechts.stelle ? [links.stelle, rechts.stelle] : [rechts.stelle, links.stelle];

        paare.push({ links: erster, rechts: zweiter, wert: kleinste, felder });
      }
    }
  }

  paare.sort((links, rechts) => rechts.wert - links.wert || links.links - rechts.links);

  return { paare, vergleiche };
}

export interface Naheliegend {
  /** Die Zeile im Referenzbestand, ab 1. */
  zeile: number;
  wert: string;
  aehnlichkeit: number;
}

/**
 * Was in einer Liste dem Gesuchten am nächsten kommt.
 *
 * Für den Referenzabgleich: Steht „53112" nicht im Postleitzahlenbestand, ist
 * die Meldung „kein Treffer" richtig und nutzlos. „Kein Treffer; am nächsten
 * liegt 53111 (Bonn)" ist dieselbe Meldung mit dem nächsten Schritt darin.
 *
 * Übernommen wird deshalb trotzdem nichts — auch nicht bei einem einzigen sehr
 * ähnlichen Eintrag. Die Referenz sagt, was sie kennt; ob der Wert in den Daten
 * ein Tippfehler oder eine neue Postleitzahl ist, sagt sie nicht.
 */
export function naheliegende(
  gesucht: string,
  kandidaten: readonly { zeile: number; wert: string }[],
  schwelle = AEHNLICH_AB,
  hoechstens = 3
): Naheliegend[] {
  const treffer: Naheliegend[] = [];

  for (const kandidat of kandidaten) {
    const wert = aehnlichkeit(gesucht, kandidat.wert, schwelle);

    if (wert > 0) {
      treffer.push({ zeile: kandidat.zeile, wert: kandidat.wert, aehnlichkeit: wert });
    }
  }

  return treffer.sort((links, rechts) => rechts.aehnlichkeit - links.aehnlichkeit).slice(0, hoechstens);
}
