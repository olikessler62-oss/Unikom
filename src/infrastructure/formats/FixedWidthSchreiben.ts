import type { Encoding } from './Csv.js';
import type { Feld, FixedWidthOptions, Positionszaehlung } from './FixedWidth.js';
import { alsBytes } from './CsvSchreiben.js';

/**
 * Dateien mit festen Feldbreiten schreiben — das Gegenstück zum Leser.
 *
 * ```text
 * Feldbeschreibung        Zeile
 * kdnr   1-5  rechts,0    00042Meier          Bonn
 * name   6-20 links
 * ort   21-30 links
 * ```
 *
 * ## Warum das gebraucht wird
 *
 * Weil die Gegenseite es so liest. Wer an ein Hostsystem liefert, liefert keine
 * CSV — und die Konsolidierung als eigenständiges Modul muss schreiben können,
 * was der Empfänger erwartet, sonst endet ihr Ergebnis in einem Zwischenschritt,
 * den jemand von Hand baut.
 *
 * ## Zu lange Werte werden nicht heimlich gekürzt
 *
 * Ein Wert, der nicht ins Feld passt, ist ein **Prüffall**. Ihn abzuschneiden
 * wäre die bequeme Antwort und die falsche: Aus „Meiersheimer-Krüger" würde
 * „Meiersheimer-Kr", und das sähe der Empfänger als vollständigen Namen an.
 * Aus einer Kundennummer würde eine andere Kundennummer.
 *
 * Wer wirklich kürzen will, sagt es je Feld — dann steht es in der
 * Feldbeschreibung und nicht im Verhalten des Schreibers.
 */
export interface Schreibfeld extends Feld {
  /**
   * Ob ein zu langer Wert gekürzt werden darf.
   *
   * Ohne diese Angabe nicht. Gekürzt wird von der Seite, an der aufgefüllt
   * wird: Ein rechtsbündiges Feld verliert vorn, ein linksbündiges hinten —
   * beides ist Datenverlust, nur an verschiedenen Enden.
   */
  kuerzen?: boolean;
}

export interface Schreiboptionen extends Omit<FixedWidthOptions, 'felder'> {
  felder: readonly Schreibfeld[];
  /** Ob eine Kopfzeile mit den Feldnamen vorangestellt wird. */
  kopfzeile?: boolean;
}

export interface Ueberlauf {
  /** Die Zeilennummer in der Ausgabe, ab 1. */
  zeile: number;
  feld: string;
  wert: string;
  laenge: number;
  erlaubt: number;
}

export interface Festbreitenausgabe {
  text: string;
  /** Werte, die nicht ins Feld passten — der Grund, warum nichts still gekürzt wird. */
  ueberlaeufe: Ueberlauf[];
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/**
 * Die Felder müssen sich beschreiben lassen, bevor geschrieben wird.
 *
 * Zwei Felder, die einander überlappen, ergeben eine Datei, die niemand mehr
 * zurücklesen kann — und das fiele erst dem Empfänger auf.
 */
export function pruefeFelder(felder: readonly Schreibfeld[]): string[] {
  const maengel: string[] = [];

  if (felder.length === 0) {
    maengel.push('Für feste Feldbreiten muss beschrieben sein, welches Feld an welcher Stelle steht');
  }

  for (const feld of felder) {
    if (feld.start < 1) {
      maengel.push(`Das Feld „${feld.name}" beginnt an Stelle ${feld.start}; gezählt wird ab 1`);
    }

    if (feld.laenge < 1) {
      maengel.push(`Das Feld „${feld.name}" hat die Länge ${feld.laenge}`);
    }

    if ((feld.fuellzeichen ?? ' ').length !== 1) {
      maengel.push(`Das Füllzeichen von „${feld.name}" muss genau ein Zeichen sein`);
    }
  }

  const sortiert = [...felder].sort((links, rechts) => links.start - rechts.start);

  for (let stelle = 1; stelle < sortiert.length; stelle += 1) {
    const vorher = sortiert[stelle - 1];
    const jetzt = sortiert[stelle];

    if (jetzt.start < vorher.start + vorher.laenge) {
      maengel.push(
        `„${vorher.name}" (${vorher.start}-${vorher.start + vorher.laenge - 1}) und „${jetzt.name}" ` +
          `(ab ${jetzt.start}) überlappen einander`
      );
    }
  }

  return maengel;
}

/**
 * Schreibt die Zeilen nach der Feldbeschreibung.
 *
 * Lücken zwischen den Feldern werden mit Leerzeichen gefüllt: Die
 * Feldbeschreibung bestimmt die Stellen, nicht die Reihenfolge der Werte. Ein
 * Feld, für das kein Wert vorliegt, steht leer da — es fällt nicht weg, sonst
 * verschöbe sich alles dahinter.
 */
export function schreibeFixedWidth(
  felder: readonly string[],
  zeilen: readonly (readonly string[])[],
  optionen: Schreiboptionen
): Festbreitenausgabe {
  const maengel = pruefeFelder(optionen.felder);

  if (maengel.length > 0) {
    throw new Error(maengel.join(' '));
  }

  const ueberlaeufe: Ueberlauf[] = [];
  const ausgabe: string[] = [];

  if (optionen.kopfzeile) {
    /*
     * Die Kopfzeile ist selbst eine Zeile fester Breite — ein Name, der nicht
     * ins Feld passt, wird hier gekürzt und nicht als Überlauf gemeldet. Sie
     * ist eine Beschriftung; die Daten darunter sind die Zusage.
     *
     * Sie folgt der **Ausrichtung des Feldes**: Über einer rechtsbündigen
     * Kundennummer steht die Beschriftung rechtsbündig, damit sie über ihrer
     * eigenen Kante sitzt. Nur das Füllzeichen wird zum Leerzeichen — Nullen
     * vor einem Feldnamen wären keine Beschriftung mehr.
     */
    ausgabe.push(
      baue(
        optionen.felder.map((feld) => feld.name.slice(0, feld.laenge)),
        optionen.felder.map((feld) => ({ ...feld, kuerzen: true, fuellzeichen: ' ' })),
        0,
        ueberlaeufe
      )
    );
  }

  zeilen.forEach((zeile, stelle) => {
    const werte = optionen.felder.map((feld) => {
      const spalte = felder.indexOf(feld.name);

      return spalte === -1 ? '' : (zeile[spalte] ?? '');
    });

    ausgabe.push(baue(werte, optionen.felder, stelle + 1, ueberlaeufe));
  });

  return { text: ausgabe.join(CR + LF) + CR + LF, ueberlaeufe };
}

function baue(
  werte: readonly string[],
  felder: readonly Schreibfeld[],
  zeile: number,
  ueberlaeufe: Ueberlauf[]
): string {
  /*
   * Gebaut wird über ein Feld von Zeichen und nicht durch Aneinanderhängen:
   * Die Felder dürfen in beliebiger Reihenfolge beschrieben sein, und zwischen
   * ihnen dürfen Lücken liegen. Wer aneinanderhängt, verschiebt die halbe Zeile,
   * sobald jemand die Beschreibung umsortiert.
   */
  const breite = felder.reduce((weit, feld) => Math.max(weit, feld.start - 1 + feld.laenge), 0);
  const zeichen = new Array<string>(breite).fill(' ');

  felder.forEach((feld, stelle) => {
    const gesetzt = passe(werte[stelle] ?? '', feld, zeile, ueberlaeufe);

    for (let index = 0; index < feld.laenge; index += 1) {
      zeichen[feld.start - 1 + index] = gesetzt[index];
    }
  });

  return zeichen.join('');
}

/** Füllt den Wert auf die Feldlänge auf — oder meldet, dass er nicht passt. */
function passe(wert: string, feld: Schreibfeld, zeile: number, ueberlaeufe: Ueberlauf[]): string {
  const fuell = feld.fuellzeichen ?? ' ';

  if (wert.length > feld.laenge) {
    if (!feld.kuerzen) {
      ueberlaeufe.push({ zeile, feld: feld.name, wert, laenge: wert.length, erlaubt: feld.laenge });

      /*
       * Das Feld bleibt leer statt halb gefüllt. Ein gekürzter Wert sähe für
       * den Empfänger wie ein vollständiger aus; ein leeres Feld ist eine
       * sichtbare Lücke, und der Prüffall daneben sagt, welche.
       */
      return fuell.repeat(feld.laenge);
    }

    /* Gekürzt wird an der Seite, an der auch aufgefüllt würde. */
    return feld.ausrichtung === 'RECHTS' ? wert.slice(wert.length - feld.laenge) : wert.slice(0, feld.laenge);
  }

  const fehlt = fuell.repeat(feld.laenge - wert.length);

  return feld.ausrichtung === 'RECHTS' ? fehlt + wert : wert + fehlt;
}

/** Die Ausgabe als Bytes — mit derselben Kodierungswahl wie beim CSV. */
export function alsFestbreitenBytes(ausgabe: Festbreitenausgabe, encoding?: Encoding): Uint8Array {
  return alsBytes(ausgabe.text, encoding);
}

/**
 * Eine Feldbeschreibung aus Namen und Breiten — die Stellen ergeben sich.
 *
 * Von Hand jedes `start` einzutragen ist die Stelle, an der sich jemand
 * verzählt, und der Fehler fällt erst dem Empfänger auf.
 */
export function felderAus(
  angaben: readonly { name: string; laenge: number; ausrichtung?: Feld['ausrichtung']; fuellzeichen?: string; kuerzen?: boolean }[],
  zaehlung: Positionszaehlung = 'ZEICHEN'
): Schreibfeld[] {
  void zaehlung;

  let start = 1;

  return angaben.map((angabe) => {
    const feld: Schreibfeld = { ...angabe, start };

    start += angabe.laenge;

    return feld;
  });
}
