/**
 * Ob ein Dateiname zu einem Muster passt.
 *
 * `*` und `?` gelten wie im Explorer, alles andere ist wörtlich zu nehmen — und
 * das ist der Grund für das Maskieren: In `Umsatz.2026.csv` ist der Punkt ein
 * Punkt. Unmaskiert stünde er für „ein beliebiges Zeichen", und `Umsatz_2026x`
 * gälte als Treffer.
 *
 * Groß- und Kleinschreibung sind gleich: Unter Windows sind sie es im
 * Dateisystem auch, und ein Muster, das dort passt und auf einem Linux-Server
 * nicht, wäre ein Fehler, den niemand beim Einrichten bemerkt.
 *
 * ## Warum das in der Domäne steht
 *
 * Weil zwei Dinge davon abhängen, die nichts miteinander zu tun haben: welche
 * Dateien ein Durchgang liest, und ob ein Stapel vollständig ist. Läge die
 * Regel bei einem der beiden, hätte das andere eine zweite — und die erste
 * abweichende Auslegung eines Sternchens wäre ein Fehler, den man nur im
 * Ergebnis sieht.
 */
export function passt(name: string, muster?: string): boolean {
  if (!muster || muster.trim() === '') {
    return true;
  }

  return musterAlsRegex(muster).test(name);
}

export function musterAlsRegex(muster: string): RegExp {
  const maskiert = muster.replace(/[.+^${}()|[\]\\]/g, (zeichen) => '\\' + zeichen);
  const mitPlatzhaltern = maskiert.split('*').join('.*').split('?').join('.');

  return new RegExp('^' + mitPlatzhaltern + '$', 'i');
}
