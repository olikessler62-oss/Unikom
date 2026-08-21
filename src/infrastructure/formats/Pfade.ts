/**
 * Der Weg zurück: aus flachen Feldnamen wieder eine verschachtelte Struktur
 * (SPEC-03, Abschnitt 7 und 8).
 *
 * Beim Lesen wird `{"kunde":{"adresse":{"ort":"Köln"}}}` zu einem Feld
 * `kunde.adresse.ort`. Beim Schreiben muss daraus wieder das Gebilde werden —
 * und zwar **dasselbe**. Deshalb steht die Zerlegung hier einmal und wird von
 * beiden Schreibern benutzt: Zwei Auslegungen desselben Namens gingen eines
 * Tages auseinander, und dann käme aus einer gelesenen Datei eine andere
 * heraus, als hineinging.
 *
 * Drei Glieder gibt es:
 *
 * ```text
 * kunde.adresse.ort        Name   →  Name  →  Name
 * positionen[0].artikel    Name mit Stelle  →  Name
 * kunde.@id                Name  →  Attribut   (nur XML)
 * ```
 */
export type Glied =
  | { art: 'NAME'; name: string }
  | { art: 'STELLE'; name: string; index: number }
  | { art: 'ATTRIBUT'; name: string };

const MIT_STELLE = /^(.*)\[(\d+)\]$/;

export function zerlegePfad(pfad: string): Glied[] {
  /*
   * Leere Glieder fallen fort.
   *
   * Ein Feld darf „Bestell Nr." heißen, und der Punkt am Ende ist Teil des
   * Namens und keine Stufe. Ohne diese Zeile entstünde daraus ein Element
   * „Bestell_Nr" mit einem namenlosen Kind darin — sichtbar falsch, aber erst
   * beim Empfänger.
   *
   * Dass ein Punkt *in der Mitte* eine Stufe bedeutet, bleibt: Genau so wird
   * beim Lesen flachgelegt, und die Umkehrung muss dieselbe Regel benutzen. Wer
   * einen Punkt im Namen behalten will, gibt den Zielpfad ausdrücklich an
   * (`zuordnung`).
   */
  return pfad
    .split('.')
    .filter((teil) => teil !== '')
    .map((teil) => {
      if (teil.startsWith('@')) {
        return { art: 'ATTRIBUT', name: teil.slice(1) };
      }

      const stelle = MIT_STELLE.exec(teil);

      return stelle ? { art: 'STELLE', name: stelle[1], index: Number(stelle[2]) } : { art: 'NAME', name: teil };
    });
}

/**
 * Ob ein Name als XML-Element taugen würde.
 *
 * Ein Feld darf „Bestell Nr." heißen; ein Element darf es nicht. Wer das nicht
 * prüft, schreibt eine Datei, die kein Parser der Welt wieder aufmacht — und
 * merkt es beim Empfänger.
 */
const ELEMENTNAME = /^[A-Za-z_À-ɏ][A-Za-z0-9_\-.À-ɏ]*(:[A-Za-z_][A-Za-z0-9_\-.]*)?$/;

export function istElementname(name: string): boolean {
  return ELEMENTNAME.test(name);
}

/**
 * Macht aus einem Feldnamen einen brauchbaren Elementnamen.
 *
 * Ersetzt wird, was nicht erlaubt ist; beginnt der Name mit einer Ziffer, kommt
 * ein Unterstrich davor. Das Ergebnis ist nicht schön, aber lesbar — und die
 * Umbenennung wird gemeldet, statt heimlich zu geschehen.
 */
export function alsElementname(name: string): string {
  const ersetzt = name.replace(/[^A-Za-z0-9_\-.À-ɏ:]/g, '_');

  return istElementname(ersetzt) ? ersetzt : `_${ersetzt}`;
}
