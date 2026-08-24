/**
 * Wie ein Mandant mit offenen Konflikten umgehen will.
 *
 * ## Warum das am Mandanten steht
 *
 * Ein Konflikt entsteht um zwei Uhr nachts, und niemand sitzt davor. Was dann
 * geschehen soll, ist keine technische Frage, sondern eine des Betriebs: Der
 * eine Kunde will am Morgen über jeden offenen Fall stolpern, bis er ihn
 * entschieden hat; der nächste arbeitet eine Liste ab und will dabei nicht
 * alle zehn Minuten ein Fenster wegklicken.
 *
 * Am Mandanten und nicht an der Installation — aus demselben Grund wie
 * `benachrichtigung` und `ausleitungenTage`: Ein Dienstleister betreut mehrere
 * Kunden auf derselben Maschine, und eine Einstellung für alle wäre für
 * niemanden die richtige.
 *
 * ## Drei Arten der Vorlage und nicht ein Schalter
 *
 * ```text
 * EINMAL              zeigt sich einmal, danach nur noch in der Glocke
 * WIEDERVORLAGE       zeigt sich nach Ablauf der Frist erneut
 * BEI_JEDEM_OEFFNEN   zeigt sich bei jedem Wechsel der Ansicht
 * ```
 *
 * Ein Ja/Nein wäre kürzer und träfe die Sache nicht: „Nicht mehr zeigen" und
 * „später noch einmal zeigen" sind verschiedene Entscheidungen, und wer nur
 * die Wahl zwischen „nie" und „immer" hat, wählt „nie".
 *
 * ## Warum die Voreinstellung nicht die lauteste ist
 *
 * Voreingestellt ist die Wiedervorlage. Ein Fenster, das bei jedem Klick
 * wiederkommt, wird nach der dritten Woche weggeklickt, ohne gelesen zu
 * werden — und dann ist auch das eine weg, auf das es ankam. Wer es trotzdem
 * so will, stellt es ein; das ist eine bewusste Entscheidung und keine, in die
 * jemand hineinrutscht.
 *
 * ## Der Mülleimer ist kein neuer Zustand
 *
 * „Akzeptieren" gibt es im Lebenszyklus bereits: den Konflikt sehenden Auges
 * hinnehmen, mit Name, Zeitpunkt und Bemerkung in der Historie. Was hier
 * eingestellt wird, ist nicht ein neuer Weg, sondern die **Erlaubnis** — ob
 * ein Fall weggelegt werden darf oder ob jeder entschieden werden muss.
 *
 * Nicht darin: ob ein Ergebnis auch in Teilen ausgeliefert werden darf. Diese
 * Einstellung wirkt erst, wenn der Lauf die Zeilen aufteilt, und bis dahin
 * wäre sie eine Behauptung auf dem Bildschirm, die niemand einlöst.
 */
export type Vorlageart = 'EINMAL' | 'WIEDERVORLAGE' | 'BEI_JEDEM_OEFFNEN';

/** Die Arten in fester Reihenfolge — sie bestimmt die Anzeige. */
export const VORLAGEARTEN: readonly Vorlageart[] = ['EINMAL', 'WIEDERVORLAGE', 'BEI_JEDEM_OEFFNEN'];

export interface Konfliktverhalten {
  /** Wie sich ein offener Konflikt meldet, bis er entschieden ist. */
  vorlage?: Vorlageart;
  /** Nach wie vielen Stunden erneut — nur bei `WIEDERVORLAGE`. */
  wiedervorlageStunden?: number;
  /**
   * Ob ein Fall hingenommen werden darf, statt entschieden zu werden.
   *
   * `false` heißt nicht, dass der Fall verschwindet: Er bleibt offen, bis
   * jemand ihn bereinigt. Genau das ist der Zweck.
   */
  akzeptierenErlaubt?: boolean;
}

/**
 * Was gilt, solange niemand etwas anderes eingestellt hat.
 *
 * Einen Tag, weil ein Konflikt, den niemand innerhalb eines Arbeitstages
 * angesehen hat, nicht durch ein zweites Fenster nach einer Stunde besser
 * wird — und weil ein Kunde, der eine Nachtverarbeitung hat, am Morgen
 * ohnehin hinsieht.
 */
export const VERHALTEN_ALLGEMEIN: Required<Konfliktverhalten> = {
  vorlage: 'WIEDERVORLAGE',
  wiedervorlageStunden: 24,
  akzeptierenErlaubt: true,
};

/** Die kürzeste Frist, die noch eine Frist ist. */
export const KUERZESTE_WIEDERVORLAGE = 1;

/**
 * Das Eingestellte über der Voreinstellung — jedes Feld für sich.
 *
 * Feldweise und nicht „ganz oder gar nicht": Wer nur die Frist ändert, will
 * nicht nebenbei die Erlaubnis zum Akzeptieren mitverstellen.
 */
export function verhaltenVon(gesetzt?: Konfliktverhalten): Required<Konfliktverhalten> {
  return {
    vorlage: gesetzt?.vorlage ?? VERHALTEN_ALLGEMEIN.vorlage,
    wiedervorlageStunden: gesetzt?.wiedervorlageStunden ?? VERHALTEN_ALLGEMEIN.wiedervorlageStunden,
    akzeptierenErlaubt: gesetzt?.akzeptierenErlaubt ?? VERHALTEN_ALLGEMEIN.akzeptierenErlaubt,
  };
}

/**
 * Ob ein Fall, der schon einmal vor Augen stand, sich wieder zeigen darf.
 *
 * `gesehen` ist der Zeitpunkt, an dem er das letzte Mal jemandem gezeigt
 * wurde — nicht der, an dem jemand ihn erledigt hat. Ein geschlossenes Fenster
 * ist gesehen und nicht bearbeitet, und diese Unterscheidung ist der Grund,
 * warum eine Wiedervorlage überhaupt möglich ist.
 *
 * Ein unlesbarer Zeitpunkt zählt wie „noch nie gezeigt". Die Alternative wäre,
 * ihn stillschweigend als „eben erst gezeigt" zu lesen — und dann verschwände
 * ein offener Konflikt wegen eines kaputten Zeitstempels.
 */
export function zeigtSichWieder(
  gesehen: string | undefined,
  verhalten: Required<Konfliktverhalten>,
  jetzt: Date
): boolean {
  if (verhalten.vorlage === 'BEI_JEDEM_OEFFNEN') {
    return true;
  }

  if (gesehen === undefined) {
    return true;
  }

  if (verhalten.vorlage === 'EINMAL') {
    return false;
  }

  const zuletzt = Date.parse(gesehen);

  if (Number.isNaN(zuletzt)) {
    return true;
  }

  return jetzt.getTime() - zuletzt >= verhalten.wiedervorlageStunden * 3_600_000;
}
