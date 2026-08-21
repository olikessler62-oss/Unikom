import { passtMitSchluessel, STAPELMARKE } from '../consolidation/Namensmuster.js';

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
  /**
   * Alle Dateien, die zu diesem Stapel gehören — auch wenn er unvollständig ist.
   *
   * Gebraucht beim Verwerfen: Verworfen wird **dieser** Stapel und nicht das
   * Verzeichnis. Liegt daneben ein zweiter, dessen Frist noch läuft, dürfen
   * seine Dateien nicht mitgehen — sonst nähme ein alter, nie fertig gewordener
   * Stapel jede Nacht einen frischen mit.
   *
   * Fremde Dateien und solche, die noch geschrieben werden, stehen nicht darin:
   * Die erste gehört nicht dazu, die zweite ist noch nicht da.
   */
  zugeordnet: string[];
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
    const platz = bedingung.plaetze.find((kandidat) => passtMitSchluessel(datei.name, kandidat.muster).passt);

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
    zugeordnet,
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

/** Ein Stapel mit seinem Schlüssel. */
export interface Stapelgruppe {
  /** Fehlt, wenn ohne Schlüsselfeld gearbeitet wird — dann gibt es nur eine Gruppe. */
  schluessel?: string;
  stand: Stapelstand;
  /** Der älteste Zeitpunkt der Gruppe; nach ihm wird die Reihenfolge bestimmt. */
  seit?: number;
}

export interface Stapelaufteilung {
  /**
   * Die Gruppen, **älteste zuerst**.
   *
   * Die Reihenfolge ist keine Kosmetik: Je Lauf wird höchstens **eine** Gruppe
   * verarbeitet. Zwei in einem Lauf zu nehmen hieße, sie in einem Ergebnis
   * zusammenzulegen — genau das, was der Schlüssel verhindern soll. Und die
   * älteste zuerst, weil sonst eine Gruppe, die nie vollständig wird, sich
   * immer wieder vor die fertigen drängte.
   */
  gruppen: Stapelgruppe[];
  /**
   * Dateien, aus denen sich kein Schlüssel lesen ließ.
   *
   * Entweder fehlt das Feld, oder es trägt in einer Datei **mehrere**
   * verschiedene Werte. Der zweite Fall ist der interessantere: Dann ist der
   * Schlüssel keine Eigenschaft dieser Datei, und sie gehört in keinen Stapel
   * — sie enthält womöglich zwei.
   */
  ohneSchluessel: string[];
  /**
   * Einrichtungsfehler in den Mustern.
   *
   * Getrennt von den übrigen Hinweisen, weil sie nicht die Lieferung betreffen,
   * sondern den Workflow: Sie ändern sich nicht dadurch, dass jemand wartet.
   */
  maengel: string[];
}

/**
 * Die Dateien eines Abholverzeichnisses, nach Stapeln getrennt.
 *
 * Ohne Schlüsselfeld gibt es genau eine Gruppe: alles, was da liegt. Mit
 * Schlüsselfeld eine je Wert — und Dateien ohne lesbaren Schlüssel gehören zu
 * keiner.
 */
export function stapelgruppen(
  dateien: readonly Stapeldatei[],
  bedingung: Stapelbedingung,
  jetzt: Date
): Stapelaufteilung {
  /*
   * Ob überhaupt gruppiert wird, entscheidet das Muster selbst: Wer `{stapel}`
   * hineinschreibt, sagt damit, welcher Teil des Namens die Zugehörigkeit
   * ausmacht. Ein zweiter Schalter daneben wäre eine Angabe, die dem Muster
   * widersprechen kann.
   */
  if (!bedingung.plaetze.some((platz) => platz.muster.includes(STAPELMARKE))) {
    return {
      gruppen: [{ stand: pruefeStapel(dateien, bedingung, jetzt), seit: aeltester(dateien) }],
      ohneSchluessel: [],
      maengel: [],
    };
  }

  const nachSchluessel = new Map<string, Stapeldatei[]>();
  const ohneSchluessel: string[] = [];
  const maengel = new Set<string>();

  for (const datei of dateien) {
    const schluessel = schluesselAusNamen(datei.name, bedingung, maengel);

    if (schluessel === undefined) {
      /*
       * Kein Schlüssel heißt: Die Datei passt zu keinem Platz, oder ihr Platz
       * trägt keine Marke. Beides ist kein Grund zu warten und keiner
       * abzubrechen — aber es gehört gesagt, sonst verschwindet sie lautlos aus
       * jeder Rechnung.
       */
      ohneSchluessel.push(datei.name);
      continue;
    }

    const bisher = nachSchluessel.get(schluessel);

    if (bisher) {
      bisher.push(datei);
    } else {
      nachSchluessel.set(schluessel, [datei]);
    }
  }

  const gruppen = [...nachSchluessel.entries()].map(([schluessel, ihre]) => ({
    schluessel,
    stand: pruefeStapel(ihre, bedingung, jetzt),
    seit: aeltester(ihre),
  }));

  /*
   * Älteste zuerst — und eine Gruppe ohne Zeitangabe hinten. Sie wäre sonst
   * mit `undefined` unvergleichbar und landete an einer Stelle, die von der
   * Laune der Sortierung abhängt.
   */
  gruppen.sort((links, rechts) => (links.seit ?? Infinity) - (rechts.seit ?? Infinity));

  return { gruppen, ohneSchluessel, maengel: [...maengel] };
}

/**
 * Das Stapelmerkmal im Namen dieser Datei.
 *
 * Gesucht wird über die Plätze: Der erste, dessen Muster passt, liefert den
 * Schlüssel. Passt keiner, gehört die Datei zu keinem Stapel; passt einer, der
 * keine Marke trägt, ebenso — dann steht in seinem Muster nicht, woran seine
 * Lieferungen auseinanderzuhalten sind.
 */
function schluesselAusNamen(
  name: string,
  bedingung: Stapelbedingung,
  maengel: Set<string>
): string | undefined {
  for (const platz of bedingung.plaetze) {
    const urteil = passtMitSchluessel(name, platz.muster);

    if (urteil.fehler) {
      maengel.add(`Platz „${platz.name}": ${urteil.fehler}`);
      continue;
    }

    if (!urteil.passt) {
      continue;
    }

    if (urteil.schluessel === undefined) {
      maengel.add(
        `Platz „${platz.name}": Im Muster „${platz.muster}" fehlt ${STAPELMARKE} — ` +
          'ohne die Marke ist nicht zu sagen, zu welchem Stapel eine Lieferung gehört'
      );

      return undefined;
    }

    return urteil.schluessel;
  }

  return undefined;
}


/** Der früheste Änderungszeitpunkt unter fertigen Dateien. */
function aeltester(dateien: readonly Stapeldatei[]): number | undefined {
  const zeiten = dateien
    .filter((datei) => datei.fertig !== false)
    .map((datei) => datei.geaendert?.getTime())
    .filter((zeit): zeit is number => zeit !== undefined);

  return zeiten.length > 0 ? Math.min(...zeiten) : undefined;
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
