import type { Dateikennung } from '../../api/types.js';

/**
 * Dateiangaben als Zeilen — und wieder zurück.
 *
 * ## Warum das ein eigenes Stück ist
 *
 * Zwei Flächen fragen inzwischen dasselbe: „Welche Dateien" nach den Namen im
 * Abholverzeichnis, „Mehrere Dateien zusammenführen" nach Primär- und
 * Sekundär-Datei. Beide zeigen dieselbe Reihe aus Auswahlfeld, Eingabefeld,
 * Papierkorb — und beide müssen leere Zeilen wegwerfen, Zeilen kürzen, wenn
 * eine Zahl sinkt, und aus einem Pfad einen Dateinamen machen.
 *
 * Das ist Rechnen und kein Zeichnen. Es steht hier, weil es sich ohne Browser
 * prüfen lässt, und weil eine Regel wie „zuerst die leeren, dann die untersten"
 * an genau einer Stelle stehen soll.
 */

/**
 * Ein Namensmuster als Zeilen — dieselbe Angabe, nur bedienbar.
 *
 * `*Umsatz*` kommt als „Merkmal im Namen: Umsatz" zurück, alles andere als
 * Dateiname. Die Rückrichtung ist damit eindeutig für den Fall, den sie
 * hergestellt hat — und wo sie es nicht ist, steht das Muster wörtlich da und
 * trifft dieselben Dateien. Eine falsche Sorte ist hier keine falsche Regel.
 *
 * Nichts eingetragen ergibt **eine** leere Zeile und keine leere Liste: Ohne
 * Zeile gäbe es kein Feld, in das man das erste Muster tippen könnte.
 */
export function alsZeilen(muster: string | undefined): (Dateikennung | undefined)[] {
  const stuecke = (muster ?? '')
    .split(',')
    .map((stueck) => stueck.trim())
    .filter((stueck) => stueck !== '');

  if (stuecke.length === 0) {
    return [undefined];
  }

  return stuecke.map((eines) => {
    const innen = eines.slice(1, -1);

    return eines.length > 2 && eines.startsWith('*') && eines.endsWith('*') && !innen.includes('*')
      ? { art: 'MERKMAL' as const, wert: innen }
      : { art: 'NAME' as const, wert: eines };
  });
}

/**
 * Die Zeilen als Muster — das, was der Lauf liest.
 *
 * Ein Merkmal wird zu `*Merkmal*`: irgendwo im Namen. Eine ausgesuchte Datei
 * steht mit ihrem Namen da und trifft damit genau sich selbst. Leere Zeilen
 * fallen fort — ein leeres Muster träfe alles.
 */
export function alsMuster(zeilen: (Dateikennung | undefined)[]): string | undefined {
  const stuecke = gefuellte(zeilen).map((eine) =>
    eine.art === 'MERKMAL' ? `*${eine.wert.trim()}*` : eine.wert.trim()
  );

  return stuecke.length > 0 ? stuecke.join(', ') : undefined;
}

/** Die Zeilen, die etwas tragen — das ist, was in den Auftrag geht. */
export function gefuellte(reihen: (Dateikennung | undefined)[]): Dateikennung[] {
  return reihen.filter((eine): eine is Dateikennung => Boolean(eine && eine.wert.trim() !== ''));
}

/**
 * Die Liste auf so viele Zeilen kürzen, wie erlaubt sind.
 *
 * **Zuerst die leeren, dann die untersten.** Wer die Zahl senkt, will Platz
 * schaffen und nicht etwas verlieren, das er eingetragen hat — eine leere Zeile
 * zwischen zwei gefüllten ist das Erste, was fort kann. Erst wenn danach immer
 * noch zu viele dastehen, fällt von unten weg, weil dort das Zuletzt-Getippte
 * steht und man es am ehesten wiederfindet.
 *
 * Eine Zeile bleibt immer stehen: Ohne sie gäbe es kein Feld mehr, in das man
 * die erste Sekundär-Datei eintragen könnte.
 */
export function kuerze(reihen: (Dateikennung | undefined)[], ziel: number): (Dateikennung | undefined)[] {
  const rest = [...reihen];

  for (let i = rest.length - 1; i >= 0 && rest.length > ziel; i -= 1) {
    if (!rest[i] || rest[i]?.wert.trim() === '') {
      rest.splice(i, 1);
    }
  }

  while (rest.length > ziel) {
    rest.pop();
  }

  return rest.length > 0 ? rest : [undefined];
}

/**
 * Der letzte Teil eines Pfades — mit beiden Trennzeichen, die vorkommen.
 *
 * Wer eine Datei aussucht, meint sie und nicht ihren Weg: Verglichen wird
 * später gegen den Dateinamen im Abholverzeichnis, und ein voller Pfad träfe
 * dort nie. Beide Trennzeichen, weil ein Pfad aus dem Fenster mit `/` kommt und
 * einer aus Windows mit dem anderen.
 */
export function dateiname(pfad: string): string {
  const trenner = Math.max(pfad.lastIndexOf('/'), pfad.lastIndexOf(String.fromCharCode(92)));

  return trenner === -1 ? pfad : pfad.slice(trenner + 1);
}
