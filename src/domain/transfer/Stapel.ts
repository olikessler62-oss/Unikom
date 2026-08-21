import { passt } from '../consolidation/Namensmuster.js';

/**
 * Wann ein Stapel zusammengehöriger Dateien vollständig ist (SPEC-06 §2).
 *
 * ## Die Lage
 *
 * Drei Filialen liefern nachts je eine Datei in ein Abholverzeichnis. Erst
 * wenn alle drei da sind, darf konsolidiert werden. Wird zu früh gestartet,
 * entsteht ein Ergebnis, dem eine Filiale fehlt — und das sieht vollständig
 * aus. Es wandert in die Warenwirtschaft, und der Fehler fällt beim
 * Monatsabschluss auf, wenn niemand mehr weiß, welche Nacht es war.
 *
 * ## Warum eine Anzahl allein nicht genügt
 *
 * „Es müssen drei sein" hält nicht, wenn Nord zweimal liefert und Süd gar
 * nicht: Dann liegen drei Dateien da, der Lauf startet, und eine Filiale
 * fehlt. Die Erwartung wird deshalb **benannt** — je Beteiligtem ein Platz.
 *
 * ## Warum eine Anzahl trotzdem dazugehört
 *
 * Umgekehrt: Liefert Nord zweimal und liefern alle anderen einmal, ist jeder
 * Platz besetzt und trotzdem stimmt etwas nicht. Eine zweite Datei auf
 * demselben Platz ist entweder eine Dublette oder eine Lieferung, die niemand
 * erwartet hat — beides gehört gemeldet und nicht verrechnet.
 *
 * Die beiden Bedingungen fangen verschiedene Fehler: **Plätze fangen das
 * Fehlen, die Anzahl das Zuviel.** Erst zusammen sind sie dicht.
 *
 * ## Was hier nicht steht
 *
 * Kein Dateisystem, keine Uhr, kein Verschieben. Hier steht die Regel, damit
 * sie sich prüfen lässt, ohne Verzeichnisse anzulegen und ohne zu warten.
 */

/** Eine Datei, wie der Stapel sie sieht. */
export interface Stapeldatei {
  name: string;
  /** Wann sie zuletzt verändert wurde. Für Frist und Reife. */
  geaendert?: Date;
  /**
   * Ob sie fertig geschrieben ist.
   *
   * Wer 400 MB in das Abholverzeichnis kopiert, legt den endgültigen Namen
   * sofort an. Zählte sie schon mit, gälte der Stapel als voll und
   * konsolidiert würde ein abgeschnittenes Stück. Wer das nicht prüfen kann,
   * lässt es weg — dann gilt sie als fertig, so wie bisher.
   */
  fertig?: boolean;
}

/** Ein erwarteter Beteiligter. */
export interface Platz {
  /** Wofür er steht — „Filiale Nord". Steht in jeder Meldung. */
  name: string;
  /** Das Muster, das seine Datei erkennt: `Filiale_Nord_*.csv`. */
  muster: string;
}

export interface Stapelbedingung {
  plaetze: Platz[];
  /**
   * Wie viele Dateien der Stapel insgesamt umfasst.
   *
   * Ohne Angabe die Zahl der Plätze — der Regelfall: je Beteiligtem eine
   * Datei. Ausdrücklich gesetzt für den Fall, dass ein Beteiligter mehrere
   * liefern darf.
   */
  anzahl?: number;
  /**
   * Wie lange auf die Fehlenden gewartet wird, gerechnet ab der **ersten**
   * Datei des Stapels.
   *
   * Ab der ersten und nicht ab einer Uhrzeit: Wer um 22:00 liefert und wer um
   * 03:00 liefert, soll dieselbe Frist bekommen. Ohne Angabe wird unbegrenzt
   * gewartet — dann wird aus einer fehlenden Datei Stille, und das ist der
   * Fehler, den niemand findet.
   */
  fristSekunden?: number;
}

/** Warum eine Datei nicht mitzählt. */
export type Uebergangen = 'UNFERTIG' | 'KEIN_PLATZ';

export interface Stapelstand {
  /** Alle Plätze besetzt **und** die Anzahl stimmt. */
  vollstaendig: boolean;
  /** Die Plätze, auf die noch gewartet wird — mit Namen, nicht als Zahl. */
  fehlend: Platz[];
  /** Plätze, die mehr als eine Datei tragen. */
  doppelt: Platz[];
  /** Dateien, die zu keinem Platz gehören. */
  fremd: string[];
  /** Dateien, die noch geschrieben werden. */
  unfertig: string[];
  /** Die Dateien des Stapels — nur bei `vollstaendig` gefüllt. */
  stapel: string[];
  /** Die Frist ist verstrichen und der Stapel ist nicht vollständig. */
  abgelaufen: boolean;
}

/**
 * Der Stand eines Abholverzeichnisses gegen die Erwartung.
 *
 * `jetzt` wird hereingereicht und nicht gelesen: Eine Regel, die selbst auf die
 * Uhr sieht, lässt sich nicht prüfen, ohne zu warten.
 */
export function pruefeStapel(
  dateien: readonly Stapeldatei[],
  bedingung: Stapelbedingung,
  jetzt: Date
): Stapelstand {
  const fertige = dateien.filter((datei) => datei.fertig !== false);
  const unfertig = dateien.filter((datei) => datei.fertig === false).map((datei) => datei.name);

  const zuordnung = new Map<Platz, string[]>(bedingung.plaetze.map((platz) => [platz, []]));
  const fremd: string[] = [];

  for (const datei of fertige) {
    /*
     * Der **erste** passende Platz gewinnt. Zwei Muster, die sich überlappen,
     * sind ein Einrichtungsfehler; die Datei zweimal zu zählen wäre die
     * schlechtere Antwort darauf, weil dann die Anzahl nicht mehr stimmt und
     * niemand sähe, warum.
     */
    const platz = bedingung.plaetze.find((kandidat) => passt(datei.name, kandidat.muster));

    if (platz) {
      zuordnung.get(platz)!.push(datei.name);
    } else {
      fremd.push(datei.name);
    }
  }

  const fehlend = bedingung.plaetze.filter((platz) => zuordnung.get(platz)!.length === 0);
  const doppelt = bedingung.plaetze.filter((platz) => zuordnung.get(platz)!.length > 1);
  const zugeordnet = [...zuordnung.values()].flat();
  const erwartet = bedingung.anzahl ?? bedingung.plaetze.length;

  /*
   * Fremde Dateien zählen für die Vollständigkeit **nicht** mit. Sie sind kein
   * Grund zu warten und keiner abzubrechen: Was dem Filter entspricht, aber zu
   * keinem Platz gehört, gehört nicht in diesen Stapel.
   */
  const vollstaendig = fehlend.length === 0 && zugeordnet.length === erwartet;

  return {
    vollstaendig,
    fehlend,
    doppelt,
    fremd,
    unfertig,
    stapel: vollstaendig ? zugeordnet : [],
    abgelaufen: !vollstaendig && verstrichen(fertige, bedingung, jetzt),
  };
}

/**
 * Ob die Wartezeit um ist.
 *
 * Gerechnet ab der ältesten Datei, die schon da ist — sie ist die „erste des
 * Stapels". Unfertige zählen nicht: Sonst startete die Uhr, während noch
 * kopiert wird, und eine große Datei brauchte ihre eigene Frist auf.
 */
function verstrichen(fertige: readonly Stapeldatei[], bedingung: Stapelbedingung, jetzt: Date): boolean {
  if (bedingung.fristSekunden === undefined || bedingung.fristSekunden <= 0) {
    return false;
  }

  const zeiten = fertige.map((datei) => datei.geaendert?.getTime()).filter((zeit): zeit is number => zeit !== undefined);

  if (zeiten.length === 0) {
    return false;
  }

  return jetzt.getTime() - Math.min(...zeiten) >= bedingung.fristSekunden * 1000;
}

/**
 * Was der Stand einem Menschen sagt.
 *
 * Als Satz und nicht als Zahlenpaar: „2 von 3" beantwortet nicht die Frage, die
 * um sieben Uhr morgens gestellt wird — welche fehlt.
 */
export function stapelmeldung(stand: Stapelstand): string {
  if (stand.vollstaendig) {
    return `Stapel vollständig: ${stand.stapel.length} Datei(en)`;
  }

  const teile: string[] = [];

  if (stand.fehlend.length > 0) {
    teile.push(`es fehlt/fehlen ${stand.fehlend.map((platz) => `„${platz.name}"`).join(', ')}`);
  }

  if (stand.doppelt.length > 0) {
    teile.push(`mehrfach geliefert hat/haben ${stand.doppelt.map((platz) => `„${platz.name}"`).join(', ')}`);
  }

  if (stand.unfertig.length > 0) {
    teile.push(`noch im Schreiben: ${stand.unfertig.join(', ')}`);
  }

  if (stand.fremd.length > 0) {
    teile.push(`ohne Platz: ${stand.fremd.join(', ')}`);
  }

  return teile.length > 0 ? teile.join('; ') : 'Stapel unvollständig';
}
