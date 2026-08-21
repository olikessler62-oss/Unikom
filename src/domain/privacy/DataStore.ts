/**
 * Die Bestände, in denen personenbezogene Daten liegen können (FR_009).
 *
 * Ein Verzeichnis statt einer Liste im Kopf: Auskunft, Löschauftrag und die
 * Auskunftsseite lesen alle dieselbe Anmeldung. Ein neuer Bestand, der sich
 * hier einträgt, ist damit sofort in allen dreien enthalten — und einer, der es
 * nicht tut, fällt beim Vergleich mit FR_009, Abschnitt 2, auf.
 */
export type Ablageort = 'DATENBANK' | 'DATEISYSTEM';
export type Personenbezug = 'JA' | 'MITTELBAR' | 'NEIN';

/**
 * Was mit einem Fund geschehen kann.
 *
 * LOESCHEN   — der Datensatz verschwindet.
 * SCHWAERZEN — der Datensatz bleibt, der Wert darin wird unkenntlich. Für
 *              Protokolle: Dass ein Lauf stattgefunden hat, ist die Tatsache,
 *              die bleiben muss; der Name in der Zeile ist es nicht.
 * ANZEIGEN   — Unikom rührt nichts an, sondern sagt, wo es liegt. Für Dateien,
 *              deren Inhalt es nicht kennt: Eine fremde Ergebnisdatei
 *              umzuschreiben wäre anmaßend und im Zweifel falsch.
 */
export type Behandlung = 'LOESCHEN' | 'SCHWAERZEN' | 'ANZEIGEN';

export interface Fund {
  /** Wo es liegt, für einen Menschen lesbar. */
  wo: string;
  /** Was dort steht — gekürzt, und nie mehr als nötig. */
  auszug: string;
  /** Wann es entstanden ist, sofern bekannt. */
  wann?: string;
}

export interface Bestandsauskunft {
  key: string;
  name: string;
  treffer: number;
  behandlung: Behandlung;
  funde: Fund[];
  /** Was Unikom hier **nicht** kann — gehört in die Antwort, nicht in eine Fußnote. */
  hinweis?: string;
}

export interface Bestand {
  key: string;
  /** Wie er in FR_009, Abschnitt 2, heißt. */
  name: string;
  inhalt: string;
  ort: Ablageort;
  personenbezug: Personenbezug;
  /** Die geltende Frist, in Worten. */
  aufbewahrung: string;
  behandlung: Behandlung;
  /**
   * Ob dieser Bestand sich auf einen Mandanten eingrenzen lässt.
   *
   * Die Angabe steht hier, weil die Oberfläche einen Mandanten anbieten darf.
   * Ein Filter, der stillschweigend nichts filtert, ist beim Suchen lästig und
   * beim Löschen ein Schaden: Wer „Mustermann, nur Mandant A" aufträgt und
   * dabei die Zeilen von Mandant B mitschwärzt, hat mehr getan als beauftragt
   * — und niemand erfährt davon. Ein Bestand, der es nicht kann, sagt es;
   * `PrivacyService.erase` führt ihn dann nicht aus, sondern legt ihn vor.
   */
  mandantenweise: boolean;
  /**
   * Sucht nach dem Begriff; `tenantId` grenzt auf einen Mandanten ein.
   *
   * `grenze` begrenzt die zurückgegebenen Fundstellen, nicht die Zählung: Die
   * Anzeige verträgt keine zehntausend Zeilen, die Ausleitung an eine betroffene
   * Person darf dagegen nichts weglassen. `treffer` ist in beiden Fällen die
   * volle Zahl.
   */
  suchen(begriff: string, tenantId?: string, grenze?: number): Promise<Bestandsauskunft>;
  /**
   * Führt die Behandlung aus und gibt zurück, wie viele Stellen betroffen
   * waren. Bestände mit `behandlung: 'ANZEIGEN'` tun nichts und geben 0.
   */
  ausfuehren(begriff: string, tenantId?: string): Promise<number>;
}

/** Höchstens so viele Fundstellen je Bestand gehen an den Bildschirm. */
export const MAX_FUNDE = 50;

/**
 * Und so viele in die Ausleitung.
 *
 * Eine Auskunft nach Artikel 15 muss vollständig sein; eine, die bei fünfzig
 * Zeilen aufhört, ohne es zu sagen, ist keine. Eine Grenze bleibt trotzdem
 * stehen, damit ein Begriff wie „GmbH" den Rechner nicht zum Stehen bringt —
 * sie liegt nur so hoch, dass sie im Ernstfall nicht greift, und wenn sie es
 * doch tut, steht es im Dokument.
 */
export const MAX_FUNDE_AUSLEITUNG = 10_000;

/** Der Text, der an die Stelle eines geschwärzten Wertes tritt. */
export const GESCHWAERZT = '[gelöscht]';

/**
 * Ein Suchbegriff muss etwas hergeben.
 *
 * Zwei Zeichen treffen halbe Datenbanken, und ein Löschauftrag über einen
 * halben Bestand ist keiner — er ist ein Unfall.
 */
export const MIN_BEGRIFF = 3;

export function assertBegriffIsUsable(begriff: string): string {
  const gesucht = begriff.trim();

  if (gesucht.length < MIN_BEGRIFF) {
    throw new Error(
      `Der Suchbegriff „${begriff}“ ist zu kurz; mindestens ${MIN_BEGRIFF} Zeichen. ` +
        'Ein zu kurzer Begriff trifft zu viel, und beim Löschen ist das nicht mehr zu berichtigen'
    );
  }

  return gesucht;
}
