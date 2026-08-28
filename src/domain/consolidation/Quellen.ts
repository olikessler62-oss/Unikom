/**
 * Mehrere Quellen in einem Lauf (SPEC-06, Abschnitt 2 und 4; SPEC-02,
 * Abschnitt 26).
 *
 * ## Zwei Einstellungen, nicht eine
 *
 * ```text
 * Betriebsart          Konsolidierungsart
 * ANREICHERN  ──┐      APPEND   Datensätze nebeneinander
 *               ├──×── MERGE    Datensätze ineinander
 * SAMMELN     ──┘
 * ```
 *
 * **Anreichern:** Eine Quelle führt, die übrigen ergänzen sie. Ein Datensatz
 * einer Zusatzquelle ohne Bezug zur führenden Quelle ist ein Konflikt
 * (SPEC-02, Abschnitt 30).
 *
 * **Sammeln:** Alle Quellen sind gleichwertig. Ein fehlender Bezug ist hier
 * kein Konflikt, weil es keine Quelle gibt, auf die er sich beziehen müsste.
 *
 * Warum getrennt: SPEC-02, Abschnitt 26, verlangte für jede Dateigruppe genau
 * eine Hauptdatei, und Abschnitt 30 machte jeden Datensatz ohne Bezug darauf
 * zum Konflikt. Bei einem Append zweier gleichartiger Filiallisten wäre damit
 * jeder Datensatz der zweiten Datei ein Konflikt gewesen. Ob eine Quelle führt,
 * ist deshalb eine eigene Einstellung neben Append und Merge (SPEC-06,
 * Abschnitt 4).
 *
 * ## Was hier bewusst fehlt
 *
 * Es gibt keine Funktion, die Quellen sucht. „Nicht ausdrücklich ausgewählte
 * oder eindeutig über eine Regel bestimmte Dateien dürfen nicht automatisch
 * Bestandteil einer Konsolidierung werden" (SPEC-06, Abschnitt 2) — die Liste
 * kommt von außen, und diese Datei nimmt sie entgegen.
 */
export type Betriebsart = 'ANREICHERN' | 'SAMMELN';
export type Konsolidierungsart = 'APPEND' | 'MERGE';

/**
 * Was über den Datenstand einer Quelle bekannt ist (SPEC-06, Abschnitt 5).
 *
 * Alle drei Zeitpunkte sind ISO-Text und alle drei sind freiwillig: Eine CSV
 * vom FTP hat ein Änderungsdatum, ein Tabellenblatt aus einer Mappe nicht
 * unbedingt. Was fehlt, darf keine Entscheidung tragen.
 */
export interface Datenstand {
  /** Wann die Quelle entstanden ist. */
  erstellt?: string;
  /** Wann sie zuletzt verändert wurde. */
  geaendert?: string;
  /** Wann Unikom sie gelesen hat. */
  eingelesen?: string;
}

export interface Quelle {
  /** Eindeutig innerhalb des Laufs — jede Herkunftsangabe verweist darauf. */
  id: string;
  /** Wie sie einem Menschen gegenüber heißt: der Dateiname. */
  name: string;
  /** Bei XLSX das Tabellenblatt (SPEC-06, Abschnitt 8). */
  blatt?: string;
  felder: readonly string[];
  zeilen: readonly (readonly string[])[];
  /**
   * Die Nummern, die diese Zeilen in der Datei hatten.
   *
   * Fehlt sie, sind es 1, 2, 3 … — der Normalfall einer vollständig
   * gelesenen Quelle. Sie wird gebraucht, sobald eine Quelle **geteilt**
   * wird: Bei blockweiser Verarbeitung enthält ein Block nur einen Teil der
   * Zeilen, und ohne die ursprünglichen Nummern zeigte jede Herkunftsangabe
   * auf die falsche Zeile. Das fiele niemandem auf — die Nummern sähen
   * plausibel aus.
   */
  zeilenNummern?: readonly number[];
  stand?: Datenstand;
}

/** Ein Datensatz, wie die Konsolidierung ihn sieht — mit seiner Herkunft. */
export interface Datensatz {
  /** Die `id` der Quelle. */
  quelle: string;
  /** Die Zeile innerhalb der Quelle, ab 1 — für die Rückverfolgbarkeit. */
  zeile: number;
  werte: ReadonlyMap<string, string>;
  stand?: Datenstand;
}

/** Wie eine Quelle in einer Meldung genannt wird. */
export function bezeichnung(quelle: Quelle): string {
  return quelle.blatt ? `${quelle.name}, Blatt „${quelle.blatt}"` : quelle.name;
}

/**
 * Die Zeilen einer Quelle als Datensätze.
 *
 * Der Datenstand der Quelle geht an jeden Datensatz mit. Er ist damit
 * genaugenommen redundant — aber die Prioritätsentscheidung bekommt einzelne
 * Werte vorgelegt und nicht ganze Quellen, und ein Wert ohne seinen Zeitpunkt
 * ist für eine Aktualitätsregel wertlos.
 */
export function datensaetze(quelle: Quelle): Datensatz[] {
  return quelle.zeilen.map((zeile, stelle) => {
    const werte = new Map<string, string>();

    quelle.felder.forEach((feld, spalte) => {
      werte.set(feld, zeile[spalte] ?? '');
    });

    return {
      quelle: quelle.id,
      zeile: quelle.zeilenNummern?.[stelle] ?? stelle + 1,
      werte,
      stand: quelle.stand,
    };
  });
}

/** Alle Datensätze mehrerer Quellen, in der Reihenfolge der Quellenliste. */
export function alleDatensaetze(quellen: readonly Quelle[]): Datensatz[] {
  return quellen.flatMap(datensaetze);
}

/**
 * Welches Tabellenblatt gemeint ist (SPEC-06, Abschnitt 8).
 *
 * Auswählbar über den Namen **oder** die Position. Und wenn das ausdrücklich
 * konfigurierte Blatt fehlt, wird kein anderes ersatzweise verwendet: Ein
 * Bericht, der stillschweigend „Tabelle1" liest, weil „Umsatz 2026" nicht da
 * ist, ist schlimmer als gar kein Bericht — er sieht richtig aus.
 */
export type Blattwahl = { name: string } | { position: number };

export type Blattergebnis =
  | { ok: true; name: string; position: number }
  | { ok: false; meldung: string; vorhanden: readonly string[] };

export function waehleBlatt(vorhanden: readonly string[], wahl: Blattwahl): Blattergebnis {
  if ('name' in wahl) {
    const stelle = vorhanden.findIndex((name) => name === wahl.name);

    return stelle >= 0
      ? { ok: true, name: vorhanden[stelle], position: stelle + 1 }
      : {
          ok: false,
          meldung:
            `Das eingerichtete Tabellenblatt „${wahl.name}" gibt es in dieser Mappe nicht. ` +
            `Vorhanden sind: ${vorhanden.map((name) => `„${name}"`).join(', ') || 'kein einziges'}. ` +
            'Ersatzweise ein anderes Blatt zu lesen, wäre eine stille Annahme über den Inhalt',
          vorhanden,
        };
  }

  const name = vorhanden[wahl.position - 1];

  return name !== undefined
    ? { ok: true, name, position: wahl.position }
    : {
        ok: false,
        meldung:
          `Diese Mappe hat kein ${wahl.position}. Tabellenblatt, sondern ${vorhanden.length}. ` +
          'Eine Auswahl über die Position verschiebt sich, sobald jemand ein Blatt einfügt - ' +
          'der Name ist die stabilere Angabe',
        vorhanden,
      };
}
