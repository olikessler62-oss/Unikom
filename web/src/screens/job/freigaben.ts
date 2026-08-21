import type { Credential } from '../../api/types.js';

/**
 * Welcher Zugang zu einem Freigabepfad gehört.
 *
 * ## Warum das hier noch einmal steht
 *
 * Dieselbe Regel liegt im Server (`domain/credentials/Credential.ts`) und wird
 * bewusst nicht geteilt: Der Server entscheidet, die Oberfläche schlägt vor.
 * Ein gemeinsames Modul würde die beiden Rollen vermischen — und die Oberfläche
 * dürfte dann mitreden, wo sie nur anzeigen soll. Weicht etwas ab, fällt es an
 * einem Lauf auf, der einen anderen Zugang benutzt als das Formular zeigte.
 *
 * ## Warum der längste Anfang gewinnt
 *
 * Zwei Zugänge auf demselben Server sind der Regelfall: einer, der auf
 * `\\SERVER01\Austausch` alles darf, und einer, der nur in
 * `\\SERVER01\Austausch\Fremd` hineinsehen darf. Der genauere gewinnt. Der
 * gröbere wäre der mit den weiteren Rechten — und der ist beim Lesen nie die
 * richtige Wahl.
 */
export function zugangFuerFreigabe(zugaenge: readonly Credential[], pfad: string): Credential | undefined {
  const gesucht = vereinheitlicht(pfad);

  if (!gesucht) {
    return undefined;
  }

  return zugaenge
    .filter((zugang) => passt(vereinheitlicht(zugang.freigabe ?? ''), gesucht))
    .sort((a, b) => vereinheitlicht(b.freigabe ?? '').length - vereinheitlicht(a.freigabe ?? '').length)[0];
}

/**
 * Ein Pfad in einer Schreibweise.
 *
 * Windows unterscheidet weder Groß- und Kleinschreibung noch die Richtung der
 * Trennzeichen. Ein Zugang, der wegen eines Schrägstrichs nicht gefunden wird,
 * sieht aus wie einer, den es nicht gibt.
 */
function vereinheitlicht(text: string): string {
  // Zeichengleich zur Fassung im Server. Zwei Schreibweisen desselben Gedankens
  // wären zwei, die auseinanderlaufen.
  return text.replace(/[\\/]+/g, String.fromCharCode(92)).replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Ob ein Pfad unter einem Anfang liegt — an der Grenze eines Gliedes.
 *
 * `\\srv\austausch` ist **kein** Anfang von `\\srv\austausch-alt`, auch wenn
 * die Zeichen es nahelegen. Ohne diese Grenze bekäme eine fremde Freigabe den
 * Zugang der benachbarten, und niemand sähe warum.
 */
function passt(anfang: string, pfad: string): boolean {
  if (anfang === '') {
    return false;
  }

  return pfad === anfang || pfad.startsWith(anfang + String.fromCharCode(92));
}
