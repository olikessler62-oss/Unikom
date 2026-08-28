import type { Konfliktfall } from '../conflicts/Konfliktfall.js';
import type { Ergebnisstand } from '../result/Ergebnisstand.js';

/**
 * Was auf einen Menschen wartet — die Zahl neben dem Menüpunkt.
 *
 * ```text
 * Handlungsbedarf (3)
 *   ↳ Konflikte    2   der Lauf konnte nicht entscheiden
 *   ↳ Freigaben    1   das Ergebnis darf noch nicht hinaus
 * ```
 *
 * ## Warum es diese Zahl gibt
 *
 * Ein Menüpunkt ohne sie verlangt, dass man ihn zur Sicherheit täglich
 * anklickt — und wer das dreimal umsonst getan hat, tut es beim vierten Mal
 * nicht mehr. Die Zahl beantwortet die Frage von außen: Muss ich hinsehen?
 *
 * ## Was zählt und was nicht
 *
 * Gezählt wird, was **jetzt** eine Entscheidung braucht:
 *
 * ```text
 * OFFEN            ja    niemand hat ihn angesehen
 * ZURUECKGESTELLT  nein  jemand hat ihn angesehen und vertagt
 * BEREINIGT        nein  entschieden
 * AKZEPTIERT       nein  sehenden Auges stehen gelassen
 * ```
 *
 * Der zweite Fall ist der, an dem sich die Zahl entscheidet. Ein
 * zurückgestellter Fall kommt wieder — aber nicht heute, und niemand hat ihn
 * übersehen. Zählte er mit, sänke die Zahl beim Zurückstellen nie, und dann
 * stünde dort dauerhaft eine Vier, die nichts mehr bedeutet. Eine Zahl, die
 * sich nicht abarbeiten lässt, ist keine Aufforderung mehr, sondern Tapete.
 *
 * Bei den Ergebnissen ist es einfacher: Genau eines wartet — der Stand, der
 * noch keine Freigabe hat. Ein gescheiterter wartet nicht, er ist gescheitert.
 */
export interface Handlungsbedarf {
  /** Konflikte, die noch niemand angesehen hat. */
  konflikte: number;
  /** Ergebnisstände, die auf eine Freigabe warten. */
  freigaben: number;
  /** Beides zusammen — die Zahl in der Klammer. */
  gesamt: number;
}

export const KEIN_BEDARF: Handlungsbedarf = { konflikte: 0, freigaben: 0, gesamt: 0 };

export function handlungsbedarf(
  faelle: readonly Konfliktfall[],
  staende: readonly Ergebnisstand[]
): Handlungsbedarf {
  const konflikte = faelle.filter((fall) => fall.status === 'OFFEN').length;
  const freigaben = staende.filter((stand) => stand.status === 'WAITING_FOR_RELEASE').length;

  return { konflikte, freigaben, gesamt: konflikte + freigaben };
}

/**
 * Mehrere Mandanten zu einer Zahl.
 *
 * Das Menü steht über allen Kunden und nicht in einem: Wer acht betreut, will
 * morgens **eine** Zahl sehen und nicht achtmal nachsehen, ob irgendwo etwas
 * liegt. Wessen Fall es ist, steht im Bildschirm dahinter.
 */
export function zusammen(teile: readonly Handlungsbedarf[]): Handlungsbedarf {
  return teile.reduce(
    (summe, teil) => ({
      konflikte: summe.konflikte + teil.konflikte,
      freigaben: summe.freigaben + teil.freigaben,
      gesamt: summe.gesamt + teil.gesamt,
    }),
    KEIN_BEDARF
  );
}
