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
  const einzeln = mustergruppe(muster);

  if (einzeln.length === 0) {
    return true;
  }

  return einzeln.some((eines) => musterAlsRegex(eines).test(name));
}

/**
 * Ein Eingabefeld in seine Muster zerlegt.
 *
 * **Das Komma trennt.** In einem Dateinamen, der maschinell verarbeitet wird,
 * hat es nichts verloren — und wer `Filiale_*.csv, Umsatz_*.csv` schreibt,
 * meint zwei Muster. Vorher wurde das Komma wörtlich genommen: Gesucht wurde
 * eine einzige Datei, deren Name ein Komma enthält, es passte nichts, und der
 * Lauf endete jede Nacht mit „nichts zu tun". Eine naheliegende Eingabe, die
 * stillschweigend gar nichts tat.
 *
 * Leere Stücke fallen fort, damit ein Komma am Ende oder ein doppeltes nicht zu
 * einem Muster wird, das auf alles passt.
 */
export function mustergruppe(muster: string | undefined): string[] {
  if (!muster) {
    return [];
  }

  return muster
    .split(',')
    .map((stueck) => stueck.trim())
    .filter((stueck) => stueck !== '');
}

/**
 * Ob ein Dateiname eine der ausgewählten Endungen trägt.
 *
 * Ohne Auswahl passt jeder Name. Das ist die bisherige Regel und bleibt sie:
 * Was ein Leser öffnen kann, kommt mit. Wer eine Auswahl trifft, schränkt
 * darüber hinaus ein — er kann damit nichts erreichen, was der Leser nicht
 * ohnehin könnte.
 *
 * ## Warum neben dem Muster
 *
 * `*.csv` leistet dasselbe, solange es um **eine** Endung geht. Bei dreien
 * stünden dort `*.csv, *.txt, *.xml` — und wer zusätzlich nach dem Namen
 * filtern will, schreibt jede Endung noch einmal hinter jeden Namen. Die
 * beiden Fragen sind verschieden: welche Namen, und welche Formate.
 *
 * Verglichen wird, wie ein Anwender es meint: `csv`, `.csv` und `.CSV` sind
 * dieselbe Endung. Ein Filter, der am vergessenen Punkt scheitert, nähme jede
 * Nacht nichts mit — und niemand sähe den Grund.
 */
export function passtEndung(name: string, endungen?: readonly string[]): boolean {
  const gewaehlt = (endungen ?? []).map(bloss).filter((eine) => eine !== '');

  if (gewaehlt.length === 0) {
    return true;
  }

  const klein = name.toLowerCase();

  return gewaehlt.some((eine) => klein.endsWith('.' + eine));
}

/** Eine Endung ohne führenden Punkt und ohne Schreibweise. */
function bloss(endung: string): string {
  return endung.trim().replace(/^\.+/, '').toLowerCase();
}

export function musterAlsRegex(muster: string): RegExp {
  const maskiert = muster.replace(/[.+^${}()|[\]\\]/g, (zeichen) => '\\' + zeichen);
  const mitPlatzhaltern = maskiert.split('*').join('.*').split('?').join('.');

  return new RegExp('^' + mitPlatzhaltern + '$', 'i');
}

/**
 * Die Marke, die im Muster die Stelle des Stapelmerkmals bezeichnet.
 *
 * `Filiale_Nord_{stapel}.csv` trifft dieselben Dateien wie
 * `Filiale_Nord_*.csv` — und sagt zusätzlich, **welcher Teil** des Namens die
 * Zugehörigkeit ausmacht. Aus `Filiale_Nord_2026-08-21.csv` wird damit der
 * Schlüssel `2026-08-21`.
 *
 * ## Warum im Namen und nicht im Inhalt
 *
 * Ein Wert in einer Spalte verlangt, dass die Datei aufgemacht wird, bevor
 * überhaupt entschieden ist, ob sie verarbeitet wird — und dass jede Zeile
 * denselben Wert trägt. Der Name trägt die Zugehörigkeit ohnehin: Wer
 * Tageslieferungen bekommt, hat das Datum im Namen, weil er die Dateien sonst
 * gar nicht auseinanderhalten könnte.
 */
export const STAPELMARKE = '{stapel}';

/**
 * Ob ein Name zum Muster passt — und welches Stapelmerkmal darin steht.
 *
 * Ohne Marke im Muster gibt es keinen Schlüssel; dann verhält sich das hier wie
 * `passt`. Mehr als eine Marke ist ein Einrichtungsfehler und wird gemeldet,
 * statt stillschweigend die erste zu nehmen: Zwei Stellen, die beide „das
 * Merkmal" heißen, können verschiedene Werte tragen.
 */
export function passtMitSchluessel(
  name: string,
  muster: string | undefined
): { passt: boolean; schluessel?: string; fehler?: string } {
  const einzeln = mustergruppe(muster);

  if (einzeln.length === 0) {
    return { passt: true };
  }

  /*
   * Jedes Muster für sich. Das erste, das trifft, bestimmt den Schlüssel — und
   * damit ist auch gesagt, was bei zwei Mustern mit Marke gilt: Sie sind
   * Alternativen, nicht zwei Merkmale.
   */
  for (const eines of einzeln) {
    const einzelfall = eineMitSchluessel(name, eines);

    if (einzelfall.passt || einzelfall.fehler) {
      return einzelfall;
    }
  }

  return { passt: false };
}

function eineMitSchluessel(
  name: string,
  muster: string
): { passt: boolean; schluessel?: string; fehler?: string } {
  const teile = muster.split(STAPELMARKE);

  if (teile.length > 2) {
    return { passt: false, fehler: `„${muster}" trägt ${STAPELMARKE} mehr als einmal` };
  }

  if (teile.length === 1) {
    return { passt: musterAlsRegex(muster).test(name) };
  }

  /*
   * Der Teil vor und der Teil hinter der Marke werden wie gewöhnliche Muster
   * übersetzt; dazwischen steht eine Fanggruppe. Sie ist **nicht** gierig:
   * `Filiale_{stapel}_Nord.csv` soll bei `Filiale_A_B_Nord.csv` das kürzere
   * `A` liefern und nicht `A_B` — wer mehr will, schreibt es hin.
   */
  const [vorn, hinten] = teile;
  const regex = new RegExp('^' + alsTeilmuster(vorn) + '(.+?)' + alsTeilmuster(hinten) + '$', 'i');
  const treffer = regex.exec(name);

  return treffer ? { passt: true, schluessel: treffer[1] } : { passt: false };
}

/** Ein Musterstück ohne Anker — dieselben Regeln wie in `musterAlsRegex`. */
function alsTeilmuster(stueck: string): string {
  const maskiert = stueck.replace(/[.+^${}()|[\]\\]/g, (zeichen) => '\\' + zeichen);

  return maskiert.split('*').join('.*').split('?').join('.');
}
