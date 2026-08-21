/**
 * Zahlen lesen — nach der Region, nicht nach Gefühl.
 *
 * `1,234` heißt in Deutschland eins Komma zwei drei vier und in den USA
 * eintausendzweihundertvierunddreißig. Beide Lesarten gelingen, keine wirft
 * einen Fehler, und der Unterschied beträgt den Faktor tausend. Deshalb
 * entscheidet hier ausschließlich die am Mandanten eingestellte Region
 * (SPEC-02, Abschnitt 8) — geraten wird nichts.
 */

export interface Separators {
  /** Tausendertrennzeichen. Leer, wenn die Sprache keines kennt. */
  group: string;
  decimal: string;
}

/**
 * Abgeleitet statt tabelliert: Eine Tabelle der Trennzeichen je Sprache wäre
 * an dem Tag falsch, an dem ein Kunde aus der Schweiz kommt (Apostroph als
 * Gruppentrenner) oder aus Frankreich (schmales geschütztes Leerzeichen).
 */
export function separatorsOf(locale: string): Separators {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.89);

  return {
    group: parts.find((part) => part.type === 'group')?.value ?? '',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

/**
 * Alle Zeichen, die in freier Wildbahn als gruppierendes Leerzeichen auftreten.
 *
 * Frankreich gruppiert offiziell mit U+202F, einem schmalen geschützten
 * Leerzeichen. In einer Datei, die durch drei Programme gelaufen ist, steht
 * dort mal U+00A0, mal ein gewöhnliches U+0020. Wer nur das offizielle Zeichen
 * annimmt, liest französische Zahlen nur dann, wenn sie niemand angefasst hat.
 */
const LEERZEICHEN_KLASSE = '[\\u0020\\u00a0\\u202f\\u2009]';
const IST_LEERZEICHEN = new RegExp(`^${LEERZEICHEN_KLASSE}$`);
const ALLE_LEERZEICHEN = new RegExp(LEERZEICHEN_KLASSE, 'g');

/**
 * Der Zahlenwert, oder undefined, wenn der Text unter dieser Region keine Zahl
 * ist.
 *
 * Streng mit Absicht: `1,2345` ist unter en-US keine Zahl, weil eine
 * Tausendergruppe dort drei Stellen hat. Wer hier großzügig ist, liest eine
 * amerikanische Datei unter deutscher Region ohne Murren falsch — und das
 * fällt erst auf, wenn jemand die Summe prüft.
 */
export function parseNumber(text: string, separators: Separators): number | undefined {
  let roh = text.trim();

  if (!roh) {
    return undefined;
  }

  let negativ = false;

  // Klammernotation, wie sie aus der Buchhaltung kommt (SPEC-02, Abschnitt 11).
  if (roh.startsWith('(') && roh.endsWith(')')) {
    negativ = true;
    roh = roh.slice(1, -1).trim();
  }

  if (roh.startsWith('-')) {
    negativ = !negativ;
    roh = roh.slice(1).trim();
  } else if (roh.startsWith('+')) {
    roh = roh.slice(1).trim();
  }

  const teile = roh.split(separators.decimal);

  if (teile.length > 2) {
    return undefined;
  }

  const [vorkomma, nachkomma] = teile;

  if (nachkomma !== undefined && !/^\d+$/.test(nachkomma)) {
    return undefined;
  }

  const ganzzahl = ohneGruppen(vorkomma, separators.group);

  if (ganzzahl === undefined) {
    return undefined;
  }

  const wert = Number(nachkomma === undefined ? ganzzahl : `${ganzzahl}.${nachkomma}`);

  return Number.isFinite(wert) ? (negativ ? -wert : wert) : undefined;
}

/** Ob die Zahl ohne Nachkommastellen geschrieben ist. */
export function isWholeNumber(text: string, separators: Separators): boolean {
  return !text.includes(separators.decimal) && parseNumber(text, separators) !== undefined;
}

/**
 * Entfernt die Tausendertrennzeichen und prüft dabei, dass sie an zulässigen
 * Stellen stehen. Genau diese Prüfung trennt „amerikanische Zahl" von
 * „deutscher Zahl mit merkwürdigem Komma".
 */
function ohneGruppen(vorkomma: string, gruppe: string): string | undefined {
  // Ist der Gruppentrenner ein Leerzeichen, gelten alle seine Ausprägungen.
  const alsLeerzeichen = Boolean(gruppe) && IST_LEERZEICHEN.test(gruppe);
  const stellen = alsLeerzeichen ? vorkomma.replace(ALLE_LEERZEICHEN, ' ') : vorkomma;
  const trenner = alsLeerzeichen ? ' ' : gruppe;

  if (!trenner || !stellen.includes(trenner)) {
    return /^\d+$/.test(stellen) ? stellen : undefined;
  }

  const gruppen = stellen.split(trenner);
  const kopf = gruppen[0];

  if (!/^\d{1,3}$/.test(kopf)) {
    return undefined;
  }

  for (const weitere of gruppen.slice(1)) {
    if (!/^\d{3}$/.test(weitere)) {
      return undefined;
    }
  }

  return gruppen.join('');
}
