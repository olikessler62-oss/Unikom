import { textCell } from '../../domain/consolidation/Cell.js';
import { decode, detectEncoding, type Encoding } from './Csv.js';
import type { Gelesen } from './Bestand.js';

/**
 * Dateien mit festen Feldbreiten (SPEC-03, Abschnitt 6.2).
 *
 * Kein Sonderformat, sondern ein reguläres: Wer aus einem Wirtschaftssystem
 * exportiert, das älter ist als CSV, bekommt genau das. Felder werden über
 * Position und Länge beschrieben; intern geführt wird **Startposition und
 * Länge**, weil „Position 6–25" und „ab 6, zwanzig Zeichen" dasselbe meinen und
 * nur eine der beiden Schreibweisen sich rechnen lässt, ohne sich zu verzählen.
 *
 * ## Zeichen oder Bytes
 *
 * Das ist die Stelle, an der eine solche Datei still kaputtgeht. Wer die
 * Positionen in einer Datei mit Umlauten in **Bytes** gezählt hat und sie in
 * **Zeichen** ausliest, bekommt ab dem ersten „ü" alles um eine Stelle
 * verschoben — und es sieht weiterhin aus wie Daten.
 *
 * Voreingestellt sind Zeichen: Fast jede solche Datei kommt in einer
 * Ein-Byte-Kodierung, dort sind beide gleich. Enthält der Text mehrbytige
 * Zeichen, sagt der Leser es ausdrücklich, statt es auf sich beruhen zu lassen.
 */
export type Ausrichtung = 'LINKS' | 'RECHTS';

export interface Feld {
  name: string;
  /** Erste Stelle, ab 1 gezählt — so, wie ein Mensch eine Feldbeschreibung liest. */
  start: number;
  laenge: number;
  /**
   * Auf welcher Seite der Wert steht. Rechtsbündig sind Zahlen, linksbündig
   * ist Text — und das Füllzeichen wird nur an der jeweils anderen Seite
   * entfernt.
   */
  ausrichtung?: Ausrichtung;
  /** Womit aufgefüllt wurde; ohne Angabe das Leerzeichen. */
  fuellzeichen?: string;
}

export type Positionszaehlung = 'ZEICHEN' | 'BYTES';

export interface FixedWidthOptions {
  felder: readonly Feld[];
  encoding?: Encoding;
  zaehlung?: Positionszaehlung;
}

/**
 * Schneidet den Wert heraus und nimmt die Füllzeichen fort.
 *
 * Entfernt wird nur an der Seite, an der aufgefüllt wurde. Das ist kein
 * Feinschliff: Eine rechtsbündige Kundennummer `00042` verlöre bei beidseitigem
 * Abschneiden ihre führenden Nullen — richtig, wenn es eine Zahl ist, falsch,
 * wenn es eine Kennung ist. Deshalb entscheidet die Feldbeschreibung und nicht
 * der Leser.
 */
function schneide(zeile: string, feld: Feld): string {
  const roh = zeile.slice(feld.start - 1, feld.start - 1 + feld.laenge);
  const fuell = feld.fuellzeichen ?? ' ';

  if (feld.ausrichtung === 'RECHTS') {
    let anfang = 0;

    while (anfang < roh.length && roh[anfang] === fuell) {
      anfang += 1;
    }

    return roh.slice(anfang);
  }

  let ende = roh.length;

  while (ende > 0 && roh[ende - 1] === fuell) {
    ende -= 1;
  }

  return roh.slice(0, ende);
}

/** Wie lang eine Zeile in der gewählten Zählung ist. */
function laenge(zeile: string, zaehlung: Positionszaehlung): number {
  return zaehlung === 'BYTES' ? Buffer.byteLength(zeile, 'utf-8') : zeile.length;
}

export function readFixedWidth(bytes: Uint8Array, options: FixedWidthOptions): Gelesen {
  if (options.felder.length === 0) {
    throw new Error(
      'Für eine Datei mit festen Feldbreiten müssen die Felder beschrieben sein. ' +
        'Ohne Positionen ist sie eine Spalte Text, und das wäre keine Auskunft, sondern eine Ausrede'
    );
  }

  const encoding = options.encoding ?? detectEncoding(bytes);
  const zaehlung = options.zaehlung ?? 'ZEICHEN';
  const text = decode(bytes, encoding);
  const notes: string[] = [];

  const zeilen = text.split(/\r\n|\r|\n/).filter((zeile) => zeile.trim() !== '');
  const breite = Math.max(...options.felder.map((feld) => feld.start - 1 + feld.laenge));

  /*
   * Zeilen, die kürzer sind als die Feldbeschreibung.
   *
   * Das kommt in echten Dateien laufend vor — viele Erzeuger schneiden
   * abschließende Leerzeichen ab. Fehlende Stellen ergeben leere Felder, und
   * das ist richtig; gemeldet wird es trotzdem, denn wenn *jede* Zeile zu kurz
   * ist, stimmt eher die Beschreibung nicht als die Datei.
   */
  const kurz = zeilen.filter((zeile) => laenge(zeile, zaehlung) < breite).length;

  if (kurz > 0) {
    notes.push(
      `${kurz} von ${zeilen.length} Zeile(n) sind kürzer als die beschriebenen ${breite} Stellen; ` +
        'fehlende Stellen gelten als leer' +
        (kurz === zeilen.length ? '. Da es alle sind, ist eher die Feldbeschreibung zu prüfen als die Datei' : '')
    );
  }

  const mehrbytig = zaehlung === 'ZEICHEN' && zeilen.some((zeile) => Buffer.byteLength(zeile, 'utf-8') !== zeile.length);

  if (mehrbytig) {
    notes.push(
      'Die Datei enthält Zeichen, die mehr als ein Byte belegen. Gezählt wurde in Zeichen — ' +
        'wurden die Positionen in Bytes festgelegt, verschieben sich die Felder ab dem ersten solchen Zeichen'
    );
  }

  /*
   * Im Bytemodus wird die Zeile so ausgelegt, dass ein Zeichen einem Byte
   * entspricht, danach mit demselben Code geschnitten und das Ergebnis
   * zurückübersetzt. Ohne diese Rückübersetzung stünde „MÃ¼ller" im Feld —
   * lesbar genug, um durchzurutschen.
   */
  const geschnitten = zaehlung === 'BYTES' ? zeilen.map(nachBytes) : zeilen;
  const zurueck = (wert: string): string =>
    zaehlung === 'BYTES' ? Buffer.from(wert, 'latin1').toString('utf-8') : wert;

  return {
    fields: options.felder.map((feld) => feld.name),
    rows: geschnitten.map((zeile) => options.felder.map((feld) => textCell(zurueck(schneide(zeile, feld))))),
    feststellungen: {
      kodierung: encoding,
      kopfzeile: false,
      spalten: options.felder.length,
    },
    // Bei festen Breiten gibt es keine abweichende Feldzahl: Jede Zeile hat so
    // viele Felder, wie beschrieben sind. Zu kurze Zeilen stehen in den Notizen.
    ragged: [],
    notes,
  };
}

/**
 * Legt eine Zeile so aus, dass Zeichenpositionen den Bytepositionen entsprechen.
 *
 * Jedes Byte wird zu einem Zeichen (latin1). Danach schneidet derselbe Code wie
 * sonst, und das Ergebnis wird zurückübersetzt — der Leser muss nicht an zwei
 * Stellen anders rechnen.
 */
function nachBytes(zeile: string): string {
  return Buffer.from(zeile, 'utf-8').toString('latin1');
}

/**
 * Ein Vorschlag für die Feldgrenzen, aus den Daten gelesen.
 *
 * Eine Datei mit festen Breiten trägt ihre Beschreibung nicht bei sich, und wer
 * sie von Hand abzählt, verzählt sich. Gesucht werden deshalb die Spalten, die
 * über **alle** Zeilen leer sind: Zwischen zwei Feldern steht in einer solchen
 * Datei fast immer eine Lücke.
 *
 * Das ist ein Vorschlag und keine Feststellung. Er wird angezeigt, damit ein
 * Mensch ihn bestätigt — Felder, die lückenlos aneinanderstoßen, findet er
 * nämlich nicht, und das kann er nur selbst wissen.
 */
export function feldvorschlag(zeilen: readonly string[], mindestluecke = 1): Feld[] {
  const gefuellt = zeilen.filter((zeile) => zeile.trim() !== '');

  if (gefuellt.length === 0) {
    return [];
  }

  const breite = Math.max(...gefuellt.map((zeile) => zeile.length));
  const belegt = Array.from(
    { length: breite },
    (_, stelle) => gefuellt.some((zeile) => (zeile[stelle] ?? ' ') !== ' ')
  );

  const felder: Feld[] = [];
  let start = -1;
  let luecke = 0;

  for (let stelle = 0; stelle <= breite; stelle += 1) {
    if (belegt[stelle]) {
      if (start < 0) {
        start = stelle;
      }

      luecke = 0;
      continue;
    }

    luecke += 1;

    // Erst wenn die Lücke breit genug ist, endet das Feld. Ein einzelnes
    // Leerzeichen mitten in „Meier Sohn" wäre sonst eine Feldgrenze.
    if (start >= 0 && luecke >= mindestluecke) {
      felder.push({
        name: `Feld ${felder.length + 1}`,
        start: start + 1,
        laenge: stelle - luecke + 1 - start,
      });
      start = -1;
    }
  }

  return felder;
}
