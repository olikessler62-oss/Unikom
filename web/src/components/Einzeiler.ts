/**
 * Eine mehrzeilige Angabe, gezeigt als eine Zeile.
 *
 * ```text
 * Norddeutsche Handels AG            ← eine Zeile: bleibt, wie sie ist
 *
 * Norddeutsche Handels AG            ← mehrere Zeilen: nur die erste,
 * Ansprechpartner: Frau Ohlsen          und ein Zeichen dafür,
 * Abrechnung monatlich                  dass mehr dahintersteht
 *   ↓
 * Norddeutsche Handels AG …
 * ```
 *
 * ## Warum die Punkte hier entstehen und die Kürzung nach Breite nicht
 *
 * Zwei Kürzungen treffen zusammen, und nur eine davon ist eine Frage des Textes:
 * Was **nach der ersten Zeile** steht, kann kein Feld zeigen, das eine Zeile
 * hoch ist — das weiß man am Text und rechnet nichts. Ob die erste Zeile in die
 * Breite des Feldes passt, hängt dagegen an der Schrift, an der Fensterbreite
 * und daran, wie die Fläche gerade geteilt ist; das weiß nur der Browser, und
 * er kürzt selbst (`text-overflow: ellipsis`).
 *
 * Beide setzen dasselbe Zeichen. Wer die Zeile ansieht, sieht deshalb nur eines:
 * „hier steht mehr" — und muss nicht wissen, welche der beiden Grenzen zuerst
 * kam.
 *
 * ## Warum ein Zeichen und nicht drei Punkte
 *
 * `…` ist ein Auslassungszeichen, `...` sind drei Satzzeichen hintereinander.
 * Der Browser setzt für seine eigene Kürzung das Zeichen; stünde daneben die
 * getippte Fassung, wären es in derselben Zeile zwei verschiedene Breiten für
 * dieselbe Aussage.
 */
export const MEHR = '…';

/**
 * Die erste Zeile — mit `…`, wenn danach noch etwas steht.
 *
 * Leerzeilen am Ende zählen nicht als „noch etwas": Wer beim Tippen zweimal die
 * Eingabetaste drückt und aufhört, hat nichts geschrieben, was verborgen wäre.
 * Ein Zeichen, das auf nichts hinweist, ist eine Zusage, die das Fenster beim
 * Öffnen nicht einlöst.
 */
export function alsEineZeile(text: string): string {
  const zeilen = text.split(/\r?\n/);
  const weiter = zeilen.slice(1).some((zeile) => zeile.trim() !== '');

  if (!weiter) {
    return zeilen[0] ?? '';
  }

  /*
   * Der Leerraum am Ende der ersten Zeile fällt fort: Sonst stünde zwischen
   * Wort und Zeichen eine Lücke, deren Breite davon abhinge, wie oft jemand
   * vor der Eingabetaste noch die Leertaste getroffen hat.
   */
  const kopf = (zeilen[0] ?? '').trimEnd();

  return kopf === '' ? MEHR : `${kopf} ${MEHR}`;
}
