import { parseDate } from '../consolidation/Dates.js';
import { parseNumber, separatorsOf } from '../consolidation/Numbers.js';
import type { DateOrder } from '../tenants/Region.js';

/**
 * Zielwerte aus Quellwerten (SPEC-09, Abschnitt 8 und 9).
 *
 * ```text
 * Vorname + Nachname   →  Name          zusammenführen
 * Name                 →  Vor-, Nachname  aufteilen
 * "  Meier  "          →  "Meier"       umformen
 * ```
 *
 * ## Die Zusage, um die es geht
 *
 * „Bei Transformationen dürfen keine Quellinformationen unbeabsichtigt verloren
 * gehen." Das ist der Grund, warum hier jedes Ergebnis mehr zurückgibt als
 * einen Wert: Es sagt auch, **was nicht mitkam**. Eine Aufteilung, die aus
 * „Meier von der Heide" zwei Felder macht und „der Heide" verschluckt, sähe im
 * Ergebnis untadelig aus — und der Kunde hieße von da an anders.
 *
 * ## Und die zweite: nichts geschieht eigenmächtig
 *
 * „Mehrdeutige oder nicht ausreichend begründbare Transformationen dürfen nicht
 * eigenmächtig angewendet werden." Deshalb steht hier **keine** Erkennung, die
 * von selbst entscheidet, dass eine Spalte „Name" aus Vor- und Nachname
 * besteht. Was hier läuft, ist eingestellt. Vorschläge sind etwas anderes und
 * gehören woanders hin.
 *
 * ## Warum Text und keine regulären Ausdrücke
 *
 * `ERSETZEN` sucht wörtlich. Ein regulärer Ausdruck wäre mächtiger und in einem
 * Formularfeld die falsche Mächtigkeit: Wer `.` eingibt, meint einen Punkt, und
 * niemand rechnet damit, dass sein Ersetzen jedes Zeichen trifft.
 */
export type Schritt =
  /** Leerzeichen am Rand fort — der häufigste Fall überhaupt. */
  | { art: 'TRIMMEN' }
  | { art: 'GROSS' }
  | { art: 'KLEIN' }
  /**
   * „meier-schulz" wird „Meier-Schulz" — und „BERT VON DER HEIDE" wird
   * „Bert von der Heide".
   *
   * Namenspartikel bleiben klein. Ohne diese Regel entstünde „Von Der Heide",
   * und das ist kein Name, den jemand so schreibt. Wer ein Feld hat, in dem
   * jedes Wort groß gehört — eine Produktbezeichnung etwa —, gibt eine leere
   * Liste an.
   */
  | { art: 'ANFANGSGROSS'; partikel?: readonly string[] }
  | { art: 'ERSETZEN'; suchen: string; ersetzen: string }
  | { art: 'VORANSTELLEN'; text: string }
  | { art: 'ANHAENGEN'; text: string }
  /** Ein Ausschnitt, ab 1 gezählt. `bis` fehlt: bis zum Ende. */
  | { art: 'AUSSCHNITT'; von: number; bis?: number }
  /** Ein Datum in eine andere Schreibweise. */
  | { art: 'DATUM'; gelesenAls: DateOrder; schreibeAls: Datumsform; jahrhundertGrenze?: number }
  /** Eine Zahl aus einer Schreibweise in eine andere. */
  | { art: 'ZAHL'; gelesenAls: string; schreibeAls: string; nachkommastellen?: number };

export type Datumsform = 'ISO' | 'TAG_ZUERST' | 'MONAT_ZUERST';

export interface Umformungsergebnis {
  wert: string;
  /** Was geschehen ist, Schritt für Schritt — „nachvollziehbar dokumentiert". */
  schritte: string[];
  /**
   * Ein Schritt ließ sich nicht ausführen.
   *
   * Der Wert bleibt dann, wie er war. Ein nicht lesbares Datum in ein leeres
   * Feld zu verwandeln wäre der stille Verlust, den Abschnitt 9 ausschließt —
   * und ausgerechnet die Zeile, die nicht ins Schema passt, ist die
   * interessante.
   */
  hinweis?: string;
}

/** Die Schritte der Reihe nach auf einen Wert anwenden. */
export function forme(wert: string, schritte: readonly Schritt[]): Umformungsergebnis {
  let ergebnis = wert;
  const getan: string[] = [];
  let hinweis: string | undefined;

  for (const schritt of schritte) {
    const vorher = ergebnis;
    const einzeln = wendeAn(ergebnis, schritt);

    ergebnis = einzeln.wert;

    if (einzeln.hinweis) {
      hinweis = hinweis ?? einzeln.hinweis;
      continue;
    }

    if (ergebnis !== vorher) {
      getan.push(`${beschreibe(schritt)}: „${vorher}" → „${ergebnis}"`);
    }
  }

  return { wert: ergebnis, schritte: getan, hinweis };
}

function wendeAn(wert: string, schritt: Schritt): { wert: string; hinweis?: string } {
  switch (schritt.art) {
    case 'TRIMMEN':
      return { wert: wert.trim() };
    case 'GROSS':
      return { wert: wert.toUpperCase() };
    case 'KLEIN':
      return { wert: wert.toLowerCase() };
    case 'ANFANGSGROSS':
      return { wert: anfangsgross(wert, schritt.partikel ?? NAMENSPARTIKEL) };
    case 'ERSETZEN':
      // Ein leeres Suchmuster träfe zwischen jedes Zeichen und fügte den
      // Ersatztext überall ein. Es ist keine Ersetzung, sondern ein Versehen.
      return schritt.suchen === '' ? { wert } : { wert: wert.split(schritt.suchen).join(schritt.ersetzen) };
    case 'VORANSTELLEN':
      return { wert: wert === '' ? wert : schritt.text + wert };
    case 'ANHAENGEN':
      return { wert: wert === '' ? wert : wert + schritt.text };
    case 'AUSSCHNITT':
      return ausschnitt(wert, schritt.von, schritt.bis);
    case 'DATUM':
      return datum(wert, schritt);
    case 'ZAHL':
      return zahl(wert, schritt);
  }
}

/**
 * Wörter, die in einem Namen klein bleiben.
 *
 * ```text
 * BERT VON DER HEIDE   →  Bert von der Heide
 * anna van den berg    →  Anna van den Berg
 * ```
 *
 * Ohne sie entstünde „Von Der Heide", und so schreibt niemand seinen Namen. Die
 * Liste ist eine **Voreinstellung**, keine Wahrheit: Sie deckt das Deutsche und
 * seine Nachbarn ab, und sie ist an jedem Schritt austauschbar — wer ein Feld
 * hat, in dem jedes Wort groß gehört, gibt eine leere Liste an.
 *
 * **Sie ist auch nicht überall richtig.** Im Niederländischen wird das
 * Tussenvoegsel groß geschrieben, sobald der Vorname fehlt: „van der Berg, Anna"
 * gegenüber „Van der Berg". Das hängt am Zusammenhang und nicht am Wort, und
 * eine Regel, die das erriete, läge bei jedem zweiten Datensatz daneben. Wer es
 * so braucht, tauscht die Liste.
 */
export const NAMENSPARTIKEL: readonly string[] = [
  'von', 'vom', 'van', 'ven', 'zu', 'zum', 'zur',
  'de', 'del', 'della', 'dello', 'den', 'der', 'des', 'di', 'do', 'dos', 'du', 'da', 'das',
  'la', 'le', 'lo', 'les', 'ter', 'ten', 'te', 'af', 'av', 'y',
];

/**
 * Wortanfänge groß — mit den Partikeln, die klein bleiben.
 *
 * **Steht ein Partikel allein, wird es groß.** Ein Feld, in dem nur „von"
 * steht, ist kein Name mit Vorsatz, sondern ein Wert für sich; ihn als
 * einziges Wort klein zu lassen sähe aus wie ein Fehler.
 */
function anfangsgross(wert: string, partikel: readonly string[]): string {
  const klein = new Set(partikel.map((wort) => wort.toLowerCase()));

  /*
   * Getrennt wird an Leerzeichen und dabei behalten, was dazwischenstand: Aus
   * zwei Leerzeichen dürfen nicht eines werden — der Wert soll umgeformt und
   * nicht nebenbei geputzt werden. Wer putzen will, nimmt `TRIMMEN`.
   */
  const stuecke = wert.split(' ');
  const woerter = stuecke.filter((stueck) => stueck !== '');

  return stuecke
    .map((stueck) => {
      if (stueck === '') {
        return stueck;
      }

      const alleine = woerter.length === 1;

      return !alleine && klein.has(stueck.toLowerCase()) ? stueck.toLowerCase() : grossAmAnfang(stueck);
    })
    .join(' ');
}

/** Ein einzelnes Wort — auch hinter Bindestrich und Apostroph beginnt eines. */
function grossAmAnfang(wort: string): string {
  const grenzen = ['-', "'"];
  let ergebnis = '';
  let neuesWort = true;

  for (const zeichen of wort) {
    ergebnis += neuesWort ? zeichen.toUpperCase() : zeichen.toLowerCase();
    neuesWort = grenzen.includes(zeichen);
  }

  return ergebnis;
}

function ausschnitt(wert: string, von: number, bis?: number): { wert: string; hinweis?: string } {
  if (von < 1) {
    return { wert, hinweis: `Der Ausschnitt beginnt bei Stelle ${von}; gezählt wird ab 1` };
  }

  const zeichen = [...wert];

  if (von > zeichen.length) {
    return { wert, hinweis: `Der Wert hat nur ${zeichen.length} Zeichen; ein Ausschnitt ab ${von} ergäbe nichts` };
  }

  return { wert: zeichen.slice(von - 1, bis).join('') };
}

const MONATSTAG = (wert: number): string => String(wert).padStart(2, '0');

function datum(wert: string, schritt: Extract<Schritt, { art: 'DATUM' }>): { wert: string; hinweis?: string } {
  if (wert.trim() === '') {
    return { wert };
  }

  const gelesen = parseDate(wert, schritt.gelesenAls, schritt.jahrhundertGrenze);

  if (!gelesen) {
    return { wert, hinweis: `„${wert}" ließ sich nicht als Datum lesen; der Wert bleibt unverändert` };
  }

  const jahr = String(gelesen.year).padStart(4, '0');
  const monat = MONATSTAG(gelesen.month);
  const tag = MONATSTAG(gelesen.day);

  if (schritt.schreibeAls === 'ISO') {
    return { wert: `${jahr}-${monat}-${tag}` };
  }

  return schritt.schreibeAls === 'TAG_ZUERST'
    ? { wert: `${tag}.${monat}.${jahr}` }
    : { wert: `${monat}/${tag}/${jahr}` };
}

function zahl(wert: string, schritt: Extract<Schritt, { art: 'ZAHL' }>): { wert: string; hinweis?: string } {
  if (wert.trim() === '') {
    return { wert };
  }

  const gelesen = parseNumber(wert, separatorsOf(schritt.gelesenAls));

  if (gelesen === undefined) {
    return { wert, hinweis: `„${wert}" ließ sich nicht als Zahl lesen; der Wert bleibt unverändert` };
  }

  const format = new Intl.NumberFormat(schritt.schreibeAls, {
    minimumFractionDigits: schritt.nachkommastellen,
    maximumFractionDigits: schritt.nachkommastellen ?? 20,
    useGrouping: false,
  });

  return { wert: format.format(gelesen) };
}

function beschreibe(schritt: Schritt): string {
  switch (schritt.art) {
    case 'TRIMMEN':
      return 'Leerzeichen am Rand entfernt';
    case 'GROSS':
      return 'in Großbuchstaben';
    case 'KLEIN':
      return 'in Kleinbuchstaben';
    case 'ANFANGSGROSS':
      return 'Wortanfänge groß';
    case 'ERSETZEN':
      return `„${schritt.suchen}" ersetzt durch „${schritt.ersetzen}"`;
    case 'VORANSTELLEN':
      return `„${schritt.text}" vorangestellt`;
    case 'ANHAENGEN':
      return `„${schritt.text}" angehängt`;
    case 'AUSSCHNITT':
      return schritt.bis === undefined
        ? `ab Zeichen ${schritt.von}`
        : `Zeichen ${schritt.von} bis ${schritt.bis}`;
    case 'DATUM':
      return 'Datum umgeschrieben';
    case 'ZAHL':
      return 'Zahl umgeschrieben';
  }
}

/* ---------- Zusammenführen (Abschnitt 9) ---------- */

export interface Zusammenfuehrung {
  /** Das Zielfeld, das entsteht. */
  ziel: string;
  /** Die Quellfelder, in dieser Reihenfolge. */
  quellen: readonly string[];
  /** Was zwischen die Teile kommt. */
  trenner: string;
  /** Weitere Schritte, nachdem verbunden wurde. */
  schritte?: readonly Schritt[];
}

export interface Zusammengefuegt extends Umformungsergebnis {
  /** Welche Quellfelder wirklich etwas beigetragen haben. */
  verwendet: string[];
  /** Quellfelder, die leer waren — sie fehlen im Ergebnis, aber nicht ungesagt. */
  leer: string[];
}

/**
 * Mehrere Quellwerte zu einem Zielwert.
 *
 * **Leere Teile ziehen keinen Trenner nach sich.** Ohne diese Regel entstünde
 * aus einem fehlenden Vornamen „ Meier" — mit führendem Leerzeichen, das jede
 * spätere Gruppierung zu einem anderen Wert macht.
 */
export function fuehreZusammen(
  werte: ReadonlyMap<string, string>,
  regel: Zusammenfuehrung
): Zusammengefuegt {
  const verwendet: string[] = [];
  const leer: string[] = [];
  const teile: string[] = [];

  for (const quelle of regel.quellen) {
    const wert = (werte.get(quelle) ?? '').trim();

    if (wert === '') {
      leer.push(quelle);
      continue;
    }

    verwendet.push(quelle);
    teile.push(wert);
  }

  const verbunden = teile.join(regel.trenner);
  const geformt = forme(verbunden, regel.schritte ?? []);

  return {
    ...geformt,
    schritte: [`${regel.quellen.join(' + ')} verbunden zu „${verbunden}"`, ...geformt.schritte],
    verwendet,
    leer,
  };
}

/* ---------- Aufteilen (Abschnitt 9) ---------- */

export type Trennung =
  /** An einem Zeichen — „Meier, Anna" am Komma. */
  | { art: 'ZEICHEN'; zeichen: string }
  /** An festen Stellen — für Kennungen mit fester Breite. */
  | { art: 'STELLEN'; stellen: readonly number[] };

/**
 * Was mit mehr Teilen geschieht, als es Zielfelder gibt.
 *
 * ```text
 * AN_LETZTES   „Meier von der Heide" → Vorname „Meier", Nachname „von der Heide"
 * PRUEFFALL    der Fall wird vorgelegt, nichts wird geschrieben
 * ```
 *
 * Es gibt bewusst **kein** stillschweigendes Abschneiden. „Bei Transformationen
 * dürfen keine Quellinformationen unbeabsichtigt verloren gehen" — und ein
 * abgeschnittener Namensteil sieht im Ergebnis aus wie ein Name.
 */
export type Ueberschuss = 'AN_LETZTES' | 'PRUEFFALL';

export interface Aufteilung {
  quelle: string;
  ziele: readonly string[];
  trennung: Trennung;
  /** Voreinstellung: `PRUEFFALL` — im Zweifel fragen. */
  ueberschuss?: Ueberschuss;
  /** Was mit jedem Teil noch geschieht. */
  schritte?: readonly Schritt[];
}

export interface Aufgeteilt {
  /** Zielfeld → Wert. Nur die, für die etwas anfiel. */
  werte: Map<string, string>;
  schritte: string[];
  /** Der Fall geht nicht durch und gehört einem Menschen vorgelegt. */
  pruefhinweis?: string;
}

export function teileAuf(wert: string, regel: Aufteilung): Aufgeteilt {
  const werte = new Map<string, string>();

  if (wert.trim() === '') {
    // Ein leerer Wert ergibt leere Zielfelder — und keinen Prüffall: Es fehlt
    // nichts, was hätte aufgeteilt werden können.
    return { werte, schritte: [] };
  }

  const teile = zerlege(wert, regel.trennung);
  const ueberschuss = regel.ueberschuss ?? 'PRUEFFALL';

  if (teile.length > regel.ziele.length) {
    if (ueberschuss === 'PRUEFFALL') {
      return {
        werte: new Map(),
        schritte: [],
        pruefhinweis:
          `„${wert}" zerfällt in ${teile.length} Teile (${teile.map((teil) => `„${teil}"`).join(', ')}), ` +
          `es gibt aber nur ${regel.ziele.length} Zielfeld(er). Nichts wurde übernommen - abgeschnitten sähe ` +
          'das Ergebnis untadelig aus und wäre falsch',
      };
    }

    // Alles ab dem letzten Zielfeld bleibt zusammen.
    const kopf = teile.slice(0, regel.ziele.length - 1);
    const rest = teile.slice(regel.ziele.length - 1);

    teile.length = 0;
    teile.push(...kopf, rest.join(trennerText(regel.trennung)));
  }

  const schritte: string[] = [`„${wert}" aufgeteilt in ${teile.map((teil) => `„${teil}"`).join(', ')}`];

  regel.ziele.forEach((ziel, stelle) => {
    const teil = teile[stelle];

    if (teil === undefined) {
      return;
    }

    const geformt = forme(teil, regel.schritte ?? []);

    werte.set(ziel, geformt.wert);
    schritte.push(...geformt.schritte.map((zeile) => `${ziel}: ${zeile}`));
  });

  return { werte, schritte };
}

function zerlege(wert: string, trennung: Trennung): string[] {
  if (trennung.art === 'ZEICHEN') {
    return trennung.zeichen === ''
      ? [wert]
      : wert
          .split(trennung.zeichen)
          .map((teil) => teil.trim())
          .filter((teil) => teil !== '');
  }

  const zeichen = [...wert];
  const teile: string[] = [];
  let anfang = 0;

  for (const stelle of trennung.stellen) {
    teile.push(zeichen.slice(anfang, stelle).join(''));
    anfang = stelle;
  }

  teile.push(zeichen.slice(anfang).join(''));

  return teile.map((teil) => teil.trim());
}

/**
 * Womit die überzähligen Teile wieder verbunden werden.
 *
 * Beim Trennzeichen dasselbe Zeichen, sonst nichts: Aus „von der Heide" darf
 * nicht „von|der|Heide" werden, nur weil intern an Stellen getrennt wurde.
 */
function trennerText(trennung: Trennung): string {
  return trennung.art === 'ZEICHEN' ? trennung.zeichen : '';
}
