import type { Datensatz } from './Quellen.js';

/**
 * Der Konsolidierungsschlüssel (SPEC-06, Abschnitt 3; SPEC-04, Abschnitt 7).
 *
 * Er beantwortet die einzige Frage, an der alles Weitere hängt: **Sind das zwei
 * Datensätze oder zweimal derselbe?**
 *
 * ```text
 * Kundennummer                        einfach
 * Nachname + Vorname + Geburtsdatum   zusammengesetzt
 * Kunden.ID = Adressen.KundenID       je Quelle anders benannt
 * ```
 *
 * ## Der Vergleichswert verlässt dieses Modul nicht
 *
 * Fachliche Dubletten heißen „Müller GmbH", „Mueller GmbH" und „MÜLLER GMBH".
 * Um sie zusammenzubringen, wird für den **Vergleich** eine gefaltete Form
 * gebildet — `mueller gmbh`. Diese Form ist ein Hilfsmittel und niemals ein
 * Datenwert: Wer sie in den Bestand schreibt, hat aus einem Firmennamen
 * Kleinbuchstaben gemacht und kann das nicht mehr rückgängig machen.
 *
 * ## Kein Schlüssel von selbst
 *
 * „UniCom darf fachliche Dublettenschlüssel nicht eigenmächtig als verbindliche
 * Wahrheit bestimmen" (SPEC-04, Abschnitt 7). Es gibt hier deshalb keine
 * Funktion, die einen Schlüssel errät. Ohne eingerichtete Felder gibt es keinen
 * Schlüssel, und ohne Schlüssel keinen Merge.
 */
export interface Vergleich {
  /** „Müller" und „müller" sind derselbe Wert. */
  grossKleinEgal?: boolean;
  /** Leerzeichen am Rand und mehrfache im Inneren spielen keine Rolle. */
  leerzeichenEgal?: boolean;
  /** „Müller" und „Mueller" sind derselbe Wert. */
  umlauteEgal?: boolean;
  /** Punkt, Komma, Bindestrich und dergleichen fallen fort. */
  satzzeichenEgal?: boolean;
}

/** Wie verglichen wird, wenn niemand etwas anderes einrichtet. */
export const STANDARDVERGLEICH: Vergleich = {
  grossKleinEgal: true,
  leerzeichenEgal: true,
  umlauteEgal: false,
  satzzeichenEgal: false,
};

export interface Schluessel {
  /** Die Felder, aus denen er gebildet wird — die Reihenfolge zählt. */
  felder: readonly string[];
  /**
   * Wo eine Quelle die Felder anders nennt: Quellen-`id` → ihre Feldnamen, in
   * derselben Reihenfolge wie `felder`.
   *
   * `Kunden.ID = Adressen.KundenID` (SPEC-02, Abschnitt 28) ist genau dieser
   * Fall — und der Grund, warum hier eine Liste steht und kein einzelner Name:
   * Ein zusammengesetzter Schlüssel kann in jeder Quelle anders heißen.
   */
  jeQuelle?: Readonly<Record<string, readonly string[]>>;
  vergleich?: Vergleich;
}

export type Schluesselwert =
  /** `teile` sind die Werte, wie sie dastanden; `wert` ist die Vergleichsform. */
  | { ok: true; wert: string; teile: string[] }
  /** Fehlt auch nur ein Teil, gibt es keinen Schlüssel — und keine Zuordnung. */
  | { ok: false; fehlend: string[] };

/**
 * Die Faltung für den Vergleich.
 *
 * Die Reihenfolge ist nicht beliebig: Die Umlautersetzung muss vor dem Abwerfen
 * der übrigen Zeichen laufen, sonst wird aus „ü" erst „u" und die Ersetzung
 * nach „ue" findet nichts mehr. Danach nimmt `NFD` alles, was an Akzenten sonst
 * noch übrig ist — „José" und „Jose" sind dieselbe Person.
 */
const UMLAUTE: readonly (readonly [RegExp, string])[] = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
  // Die Großbuchstaben stehen ausdrücklich dabei und werden nicht aus den
  // kleinen errechnet: `'ß'.toUpperCase()` ist „SS", und eine Regel, die sich
  // ihre eigenen Muster ableitet, tut irgendwann etwas, das niemand liest.
  [/Ä/g, 'AE'],
  [/Ö/g, 'OE'],
  [/Ü/g, 'UE'],
];

export function vergleichswert(text: string, vergleich: Vergleich = STANDARDVERGLEICH): string {
  let stand = text;

  if (vergleich.grossKleinEgal) {
    stand = stand.toLocaleLowerCase('de-DE');
  }

  if (vergleich.umlauteEgal) {
    // Erst nach dem Kleinschreiben, sonst bliebe „Ü" unberührt. Wer ohne
    // `grossKleinEgal` faltet, bekommt „AE" und „ae" als zwei Werte — das ist
    // richtig so, denn dann hat er die Großschreibung ausdrücklich behalten.
    for (const [muster, ersatz] of UMLAUTE) {
      stand = stand.replace(muster, ersatz);
    }

    stand = stand.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  if (vergleich.satzzeichenEgal) {
    stand = stand.replace(/[.,;:!?'"«»„“‚‘()[\]{}\/\\_-]/g, ' ');
  }

  if (vergleich.leerzeichenEgal) {
    stand = stand.replace(/\s+/g, ' ').trim();
  }

  return stand;
}

/** Wie eine Quelle die Schlüsselfelder nennt. */
export function felderFuer(schluessel: Schluessel, quelle: string): readonly string[] {
  const eigene = schluessel.jeQuelle?.[quelle];

  if (!eigene) {
    return schluessel.felder;
  }

  /*
   * Eine unvollständige Angabe je Quelle wäre die gefährlichste Variante: Der
   * Schlüssel bestünde aus weniger Feldern als eingerichtet, und plötzlich
   * gälten zwei verschiedene Kunden als einer. Deshalb wird aufgefüllt und
   * nicht gekürzt — was fehlt, heißt in dieser Quelle wie überall.
   */
  return schluessel.felder.map((feld, stelle) => eigene[stelle] ?? feld);
}

/**
 * Das Trennzeichen zwischen den Teilen eines zusammengesetzten Schlüssels.
 *
 * Ein Zeichen, das in keinem Datenwert vorkommen kann — als Escape geschrieben
 * und nicht als Zeichen, damit die Datei lesbar bleibt und niemand es beim
 * Bearbeiten versehentlich verliert.
 */
export const TRENNER = '\u001f';

/**
 * Der Schlüssel eines Datensatzes.
 *
 * Ein fehlender Teil macht den Schlüssel nicht kürzer, sondern ungültig.
 * „Fehlende oder nicht eindeutige Schlüssel dürfen nicht zu einer willkürlichen
 * Zuordnung führen" (SPEC-06, Abschnitt 3) — und ein aus zwei von drei Feldern
 * gebildeter Schlüssel ist genau das: Er trifft auf mehr Datensätze zu, als
 * gemeint waren, und niemand sieht es.
 */
export function schluesselVon(datensatz: Datensatz, schluessel: Schluessel): Schluesselwert {
  const felder = felderFuer(schluessel, datensatz.quelle);
  const vergleich = schluessel.vergleich ?? STANDARDVERGLEICH;
  const teile: string[] = [];
  const fehlend: string[] = [];

  for (const feld of felder) {
    const wert = datensatz.werte.get(feld) ?? '';

    if (wert.trim() === '') {
      fehlend.push(feld);
    } else {
      teile.push(wert);
    }
  }

  if (fehlend.length > 0) {
    return { ok: false, fehlend };
  }

  /*
   * Getrennt wird mit einem Steuerzeichen, das in Daten nicht vorkommt. Mit einem
   * Bindestrich wäre „Meier-Hof" + „Bonn" derselbe Schlüssel wie „Meier" +
   * „Hof-Bonn" — ein Zusammenstoß, den niemand je bemerkt.
   */
  return { ok: true, wert: teile.map((teil) => vergleichswert(teil, vergleich)).join(TRENNER), teile };
}

/**
 * Datensätze nach ihrem Schlüssel gruppieren.
 *
 * Was keinen Schlüssel hat, geht nicht verloren, sondern steht in `ohne` — mit
 * der Angabe, welches Feld fehlte. Ein Datensatz, der schweigend aus der
 * Verarbeitung fällt, ist der Fehler, der erst beim Kunden auffällt.
 */
export interface Gruppierung {
  /** Vergleichsschlüssel → die Datensätze, die ihn tragen. */
  gruppen: Map<string, Datensatz[]>;
  /** Wie der Schlüssel lesbar aussah — für Meldungen. */
  klartext: Map<string, string>;
  ohne: { datensatz: Datensatz; fehlend: string[] }[];
}

export function gruppiere(datensaetze: readonly Datensatz[], schluessel: Schluessel): Gruppierung {
  const gruppen = new Map<string, Datensatz[]>();
  const klartext = new Map<string, string>();
  const ohne: { datensatz: Datensatz; fehlend: string[] }[] = [];

  for (const datensatz of datensaetze) {
    const wert = schluesselVon(datensatz, schluessel);

    if (!wert.ok) {
      ohne.push({ datensatz, fehlend: wert.fehlend });
      continue;
    }

    const vorhanden = gruppen.get(wert.wert);

    if (vorhanden) {
      vorhanden.push(datensatz);
    } else {
      gruppen.set(wert.wert, [datensatz]);
      klartext.set(wert.wert, wert.teile.join(' | '));
    }
  }

  return { gruppen, klartext, ohne };
}
