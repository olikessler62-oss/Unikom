import type { FieldType } from '../consolidation/Recognition.js';
import { findeBezeichnungen, typPasst, type Bezeichnung } from './Bezeichnungen.js';

/**
 * Feldmapping — welche Spalte auf welches interne Feld geht (SPEC-02,
 * Abschnitt 15; SPEC-09, Abschnitt 3 und 4).
 *
 * ## Die drei Ausgänge
 *
 * ```text
 * EINDEUTIG    →  wird angewendet, ohne zu fragen
 * VORSCHLAG    →  wird gezeigt und wartet auf eine Bestätigung
 * MEHRDEUTIG   →  es geschieht nichts; der Mensch entscheidet
 * ```
 *
 * Der mittlere Ausgang ist der eigentliche Punkt. „So viel wie möglich
 * automatisch erkennen und lösen" heißt nicht „im Zweifel raten": Ein falsches
 * Feldmapping leitet eine **ganze Spalte** still ins falsche Zielfeld, und das
 * fällt auf, wenn die Daten längst woanders sind.
 *
 * ## Anwenden ist nicht dasselbe wie Regel werden
 *
 * Auch eine eindeutige Zuordnung wird hier **nicht** zur Regel. Sie wird für
 * diesen Lauf angewendet; dauerhaft wird sie erst durch die ausdrückliche
 * Bestätigung eines Menschen (SPEC-02, Abschnitt 15). Diese Datei schlägt
 * deshalb nur vor — was daraus eine Regel macht, steht in `Regelbestand`.
 */
export type Sicherheit = 'EINDEUTIG' | 'VORSCHLAG' | 'MEHRDEUTIG';

export interface Spalte {
  /** Wie sie in der Quelle heißt. */
  name: string;
  /** Was die Erkennung über ihre Werte sagt. */
  typ: FieldType;
  /** Ein paar Werte — sie stützen oder widerlegen den Namen. */
  werte?: readonly string[];
}

export interface Zuordnungsvorschlag {
  /** Die Spalte der Quelle. */
  spalte: string;
  /** Das interne Feld — fehlt, wenn nichts zuzuordnen war. */
  intern?: string;
  label?: string;
  sicherheit: Sicherheit;
  /** Zwischen 0 und 1. */
  konfidenz: number;
  /** Warum — in Sätzen, die ein Mensch prüfen kann. */
  gruende: string[];
  /** Bei Mehrdeutigkeit: was sonst noch in Frage kam. */
  kandidaten?: { intern: string; label: string }[];
}

/** Ab hier gilt eine Zuordnung als eindeutig genug, um ohne Rückfrage zu wirken. */
export const EINDEUTIG_AB = 0.9;

/** Darunter wird gar nichts vorgeschlagen — ein schwacher Vorschlag ist Lärm. */
export const VORSCHLAG_AB = 0.5;

export interface Zuordnungsoptionen {
  /** Die geltende Bezeichnungsliste; ausgeliefert plus, was der Mandant ergänzt hat. */
  liste?: readonly Bezeichnung[];
  /**
   * Was der Mandant, das Profil oder ein früherer Mensch schon entschieden hat:
   * Spaltenname (normalisiert) → internes Feld.
   *
   * Eine bestätigte Entscheidung schlägt jede Erkennung. Sie ist der Grund,
   * warum derselbe Lieferant beim zweiten Mal nicht wieder gefragt wird.
   */
  bekannt?: ReadonlyMap<string, string>;
}

/**
 * Ob die Werte einer Spalte zu dem passen, was das Feld erwartet.
 *
 * Nur ein grober Blick — die feine Prüfung macht die Typerkennung. Er reicht
 * aber für den Fall, um den es geht: eine Spalte „Geburtsdatum", in der Namen
 * stehen. Ohne diesen Blick wäre die Zuordnung eine reine Namensfrage, und
 * genau das schließt SPEC-09, Abschnitt 4, aus.
 */
function werteStuetzen(bezeichnung: Bezeichnung, spalte: Spalte): boolean | undefined {
  const gefuellt = (spalte.werte ?? []).filter((wert) => wert.trim() !== '');

  if (gefuellt.length === 0) {
    return undefined;
  }

  if (bezeichnung.intern === 'email') {
    return gefuellt.every((wert) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(wert.trim()));
  }

  if (bezeichnung.intern === 'iban') {
    return gefuellt.every((wert) => /^[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}$/i.test(wert.trim()));
  }

  if (bezeichnung.intern === 'postalCode') {
    return gefuellt.every((wert) => /^[A-Z0-9][A-Z0-9 -]{2,9}$/i.test(wert.trim()));
  }

  return undefined;
}

export function ordneZu(spalte: Spalte, options: Zuordnungsoptionen = {}): Zuordnungsvorschlag {
  const gruende: string[] = [];

  /*
   * Was ein Mensch schon entschieden hat, gilt — vor jeder Erkennung.
   * SPEC-02, Abschnitt 16: Bestätigte Zuordnungen stehen über der Automatik.
   */
  const bekannt = options.bekannt?.get(spalte.name) ?? options.bekannt?.get(spalte.name.toLowerCase());

  if (bekannt) {
    return {
      spalte: spalte.name,
      intern: bekannt,
      label: (options.liste ?? []).find((eintrag) => eintrag.intern === bekannt)?.label,
      sicherheit: 'EINDEUTIG',
      konfidenz: 1,
      gruende: ['Diese Zuordnung wurde bereits bestätigt und gilt daher ohne erneute Prüfung'],
    };
  }

  const treffer = findeBezeichnungen(spalte.name, options.liste);

  if (treffer.length === 0) {
    return {
      spalte: spalte.name,
      sicherheit: 'MEHRDEUTIG',
      konfidenz: 0,
      gruende: [`„${spalte.name}" steht in keiner Bezeichnungsliste`],
    };
  }

  /*
   * Der Name allein entscheidet nicht. Passt der Typ nicht, fällt der Kandidat
   * heraus — eine Spalte „Geburtsdatum" voller Namen ist ein falsch
   * beschrifteter Export und kein Geburtsdatum.
   */
  const passend = treffer.filter((eintrag) => typPasst(eintrag.bezeichnung, spalte.typ));
  const verworfen = treffer.filter((eintrag) => !passend.includes(eintrag));

  for (const eintrag of verworfen) {
    gruende.push(
      `„${eintrag.bezeichnung.label}" wurde verworfen: erwartet wird ` +
        `${eintrag.bezeichnung.typen?.join(' oder ')}, erkannt wurde ${spalte.typ}`
    );
  }

  if (passend.length === 0) {
    return {
      spalte: spalte.name,
      sicherheit: 'MEHRDEUTIG',
      konfidenz: 0,
      gruende: [
        ...gruende,
        `Der Name „${spalte.name}" ist bekannt, aber kein passendes Feld hat den erkannten Typ ${spalte.typ}`,
      ],
      kandidaten: treffer.map((eintrag) => ({ intern: eintrag.bezeichnung.intern, label: eintrag.bezeichnung.label })),
    };
  }

  if (passend.length > 1) {
    return {
      spalte: spalte.name,
      sicherheit: 'MEHRDEUTIG',
      konfidenz: 0,
      gruende: [
        ...gruende,
        `„${spalte.name}" passt auf ${passend.length} interne Felder. Mehrdeutiges wird nicht eigenmächtig zugeordnet`,
      ],
      kandidaten: passend.map((eintrag) => ({ intern: eintrag.bezeichnung.intern, label: eintrag.bezeichnung.label })),
    };
  }

  const [gewaehlt] = passend;

  /*
   * Ein Treffer in der Liste wiegt gleich viel, ob die Schreibweise nun genau
   * die kanonische ist oder eine der hinterlegten Abwandlungen. „Kunden-Nr."
   * schwächer zu bewerten als „Kundennummer" hieße, die Liste zu misstrauen —
   * und genau dafür gibt es sie: Sie *ist* die Kenntnis der Schreibweisen.
   */
  let konfidenz = 0.9;

  gruende.push(
    `„${spalte.name}" steht als „${gewaehlt.ueber}" in der Bezeichnungsliste für „${gewaehlt.bezeichnung.label}"`
  );

  if (gewaehlt.bezeichnung.typen && gewaehlt.bezeichnung.typen.includes(spalte.typ)) {
    konfidenz += 0.07;
    gruende.push(`Der erkannte Typ ${spalte.typ} passt dazu`);
  } else if (spalte.typ === 'NULL') {
    konfidenz -= 0.15;
    gruende.push('Die Spalte ist leer; der Typ kann die Zuordnung weder stützen noch widerlegen');
  }

  const werte = werteStuetzen(gewaehlt.bezeichnung, spalte);

  if (werte === true) {
    konfidenz += 0.05;
    gruende.push('Auch die Werte selbst passen zu diesem Feld');
  } else if (werte === false) {
    /*
     * Ein Veto, kein Abschlag.
     *
     * Wenn in der Spalte „E-Mail" keine E-Mail-Adressen stehen, ist die
     * Beschriftung falsch oder die Spalte enthält etwas anderes — beides
     * bedeutet, dass hier ein Mensch hinsehen muss. Ein Abzug hätte den
     * Vorschlag stehen lassen, und ein Vorschlag mit widersprechenden Werten
     * ist eine Einladung zum Durchwinken.
     */
    konfidenz = Math.min(konfidenz, VORSCHLAG_AB - 0.1);
    gruende.push('Die Werte passen **nicht** zu diesem Feld — der Name allein entscheidet hier nicht');
  }

  if (gewaehlt.bezeichnung.hinweis) {
    gruende.push(gewaehlt.bezeichnung.hinweis);
  }

  konfidenz = Math.max(0, Math.min(1, konfidenz));

  return {
    spalte: spalte.name,
    intern: konfidenz >= VORSCHLAG_AB ? gewaehlt.bezeichnung.intern : undefined,
    label: konfidenz >= VORSCHLAG_AB ? gewaehlt.bezeichnung.label : undefined,
    sicherheit: konfidenz >= EINDEUTIG_AB ? 'EINDEUTIG' : konfidenz >= VORSCHLAG_AB ? 'VORSCHLAG' : 'MEHRDEUTIG',
    konfidenz,
    gruende,
  };
}

/**
 * Alle Spalten auf einmal — und danach die Gegenprobe.
 *
 * Zwei Spalten, die auf dasselbe interne Feld zeigen, sind kein gültiges
 * Ergebnis: Eine von beiden landete sonst dort, die andere im Nichts, und
 * welche das ist, entschiede die Reihenfolge. Beide werden deshalb
 * zurückgestuft und dem Menschen vorgelegt.
 */
export function ordneAlleZu(spalten: readonly Spalte[], options: Zuordnungsoptionen = {}): Zuordnungsvorschlag[] {
  const vorschlaege = spalten.map((spalte) => ordneZu(spalte, options));
  const zaehler = new Map<string, number>();

  for (const vorschlag of vorschlaege) {
    if (vorschlag.intern) {
      zaehler.set(vorschlag.intern, (zaehler.get(vorschlag.intern) ?? 0) + 1);
    }
  }

  return vorschlaege.map((vorschlag) => {
    if (!vorschlag.intern || (zaehler.get(vorschlag.intern) ?? 0) < 2) {
      return vorschlag;
    }

    const andere = vorschlaege
      .filter((anderer) => anderer !== vorschlag && anderer.intern === vorschlag.intern)
      .map((anderer) => `„${anderer.spalte}"`);

    return {
      ...vorschlag,
      sicherheit: 'MEHRDEUTIG',
      konfidenz: 0,
      gruende: [
        ...vorschlag.gruende,
        `Auch ${andere.join(', ')} zeigt auf „${vorschlag.label ?? vorschlag.intern}". ` +
          'Zwei Spalten in dasselbe Feld zu schreiben entschiede die Reihenfolge, nicht die Bedeutung',
      ],
    };
  });
}
