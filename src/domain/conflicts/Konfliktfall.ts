/**
 * Der Konfliktfall (SPEC-07).
 *
 * ## Der Bestand liegt in der Datenbank, nicht in einer Datei
 *
 * Konflikt-UUID, Status, Entscheidungen, Historie und der Bearbeitungsstand
 * des Benutzers liegen in SQLite. Die vier Dateien aus dem Dateimodell sind
 * **Ausleitungen** daraus:
 *
 * ```text
 * Originaldatei      unverändert, ohne Konflikt-Metadaten
 * Arbeitsdatei       Zwischenstand, ohne Konflikt-UUID
 * Konfliktdatei      Ausleitung zur Ansicht      ← trägt die UUIDs mit
 * Konfliktzieldatei  Ausleitung zur Nachverarbeitung
 * ```
 *
 * Wird eine Ausleitung nach Ablauf der Aufbewahrungsfrist fortgeräumt, bleiben
 * Fall, Entscheidungen und Historie erhalten. Die Nachvollziehbarkeit hängt
 * damit nicht an einer Datei, die irgendwann verschwindet.
 *
 * ## Warum die Sperre kein Status ist
 *
 * „In Bearbeitung" ist keine Stufe im Lebenszyklus, sondern eine Aussage
 * darüber, wer gerade daran sitzt. Ein Fall ist **offen und gesperrt**, nicht
 * „gesperrt statt offen". Als Status geführt, ginge beim Entsperren die
 * Information verloren, was er vorher war — und ein abgebrochener Browser
 * hinterließe Fälle in einem Zustand, den keine Regel mehr verlässt.
 */
export type Kritikalitaet = 'INFORMATION' | 'WARNUNG' | 'KONFLIKT' | 'PRUEFFALL' | 'KRITISCH';

/**
 * Der Lebenszyklus aus SPEC-07, Abschnitt 13.
 *
 * ```text
 * OFFEN ──┬─→ ZURUECKGESTELLT ──┐
 *         │                     │
 *         ├─────────────────────┴─→ BEREINIGT ──→ ERNEUT_VERARBEITET ──→ ERFOLGREICH_VERARBEITET
 *         │
 *         └─→ AKZEPTIERT
 * ```
 *
 * **Ein bereinigter Konflikt ist noch nicht erledigt.** Erst wenn die
 * anschließende Verarbeitung durchgelaufen ist, gilt er als erfolgreich
 * verarbeitet — dazwischen liegt ein eigener Verarbeitungslauf, der auch
 * scheitern kann.
 */
export type Konfliktstatus =
  | 'OFFEN'
  | 'ZURUECKGESTELLT'
  | 'BEREINIGT'
  | 'AKZEPTIERT'
  | 'ERNEUT_VERARBEITET'
  | 'ERFOLGREICH_VERARBEITET';

/**
 * Welcher Statuswechsel erlaubt ist.
 *
 * Die Tabelle steht hier und nicht verstreut in den Dienstmethoden. Eine
 * Zustandsmaschine, die an fünf Stellen einzeln geprüft wird, ist an einer
 * davon anders — und dann steht irgendwann ein Fall auf „erfolgreich
 * verarbeitet", den niemand entschieden hat.
 */
const UEBERGAENGE: Record<Konfliktstatus, readonly Konfliktstatus[]> = {
  OFFEN: ['ZURUECKGESTELLT', 'BEREINIGT', 'AKZEPTIERT'],
  // Zurückgestellt heißt „später", nicht „gelöst": Von hier führt jeder Weg
  // zurück in die Bearbeitung.
  ZURUECKGESTELLT: ['OFFEN', 'BEREINIGT', 'AKZEPTIERT'],
  // Eine nachträgliche Korrektur ist erlaubt und löscht nichts — sie ist ein
  // weiterer Schritt in der Historie (SPEC-07, Abschnitt 12).
  BEREINIGT: ['BEREINIGT', 'OFFEN', 'ZURUECKGESTELLT', 'AKZEPTIERT', 'ERNEUT_VERARBEITET'],
  AKZEPTIERT: ['OFFEN', 'BEREINIGT', 'ERNEUT_VERARBEITET'],
  ERNEUT_VERARBEITET: ['ERFOLGREICH_VERARBEITET', 'OFFEN'],
  // Das Ende. Was danach kommt, ist ein neuer Fall mit eigener UUID.
  ERFOLGREICH_VERARBEITET: [],
};

export function darfWechseln(von: Konfliktstatus, nach: Konfliktstatus): boolean {
  return UEBERGAENGE[von].includes(nach);
}

/** Die Stufen, ab denen der Fall nicht mehr auf eine Entscheidung wartet. */
export function istErledigt(status: Konfliktstatus): boolean {
  return status === 'AKZEPTIERT' || status === 'BEREINIGT' || status === 'ERNEUT_VERARBEITET' || status === 'ERFOLGREICH_VERARBEITET';
}

/** Ein Wert, wie ihn eine Quelle geliefert hat — die Grundlage der Gegenüberstellung. */
export interface Wertangebot {
  quelle: string;
  wert: string;
  /** Was sonst noch für oder gegen ihn spricht: Datenstand, Zeile, Regel. */
  metadaten?: Readonly<Record<string, string>>;
}

/** Ein Feld, über das zu entscheiden ist (SPEC-07, Abschnitt 4 und 7). */
export interface Streitfeld {
  feld: string;
  /** Die konkurrierenden Werte, vergleichbar gegenübergestellt. */
  angebote: Wertangebot[];
  /** Der Zieltyp — er gilt auch bei manueller Eingabe (Abschnitt 7). */
  typ?: string;
  /** Ob das Feld leer bleiben darf. */
  leerErlaubt?: boolean;
}

export interface Sperre {
  benutzer: string;
  benutzerName?: string;
  seit: string;
}

export interface Konfliktfall {
  /** Bleibt über den gesamten Lebenszyklus erhalten (Abschnitt 12). */
  id: string;
  tenantId: string;
  /** Der Lauf, in dem er entstanden ist. */
  laufId: string;
  /** Woran der betroffene Datensatz zu erkennen ist. */
  datensatz: string;
  art: string;
  kritikalitaet: Kritikalitaet;
  status: Konfliktstatus;
  /** Warum eine manuelle Prüfung nötig ist (Abschnitt 2). */
  ursache: string;
  /** Welche Regel oder Bedingung den Prüffall ausgelöst hat. */
  regel?: string;
  erwartet: string;
  vorgefunden: string;
  naechsteSchritte: string;
  quellen: string[];
  felder: Streitfeld[];
  /** Die Werte, auf die man sich geeinigt hat — erst nach einer Entscheidung. */
  ergebnis?: Readonly<Record<string, string>>;
  entstanden: string;
  geaendert: string;
  /**
   * Der Fall, aus dem dieser hervorging.
   *
   * „Entsteht bei der erneuten Verarbeitung ein neuer Konflikt, muss dieser als
   * neuer Konfliktfall nachvollziehbar mit dem vorausgegangenen
   * Bearbeitungsvorgang verknüpft werden" (Abschnitt 13). Nicht derselbe Fall
   * mit neuem Status: ein neuer Fall mit einem Faden zum alten.
   */
  entstandenAus?: string;
  sperre?: Sperre;
  /**
   * Zählt bei jeder Änderung hoch.
   *
   * Wer entscheidet, nennt die Fassung, auf der seine Entscheidung beruht.
   * Stimmt sie nicht mehr, wird abgelehnt — „bereits vorhandene Bearbeitungen
   * dürfen nicht unbemerkt überschrieben werden" (Abschnitt 11). Eine Sperre
   * allein genügt dafür nicht: Sie läuft ab, und dann säßen zwei Leute wieder
   * gleichzeitig am selben Fall.
   */
  fassung: number;
}

/**
 * Wie dringend ein Fall ist, wenn niemand etwas anderes eingestellt hat
 * (SPEC-07, Abschnitt 3).
 *
 * Bewusst nur die Kritikalität und der Zeitpunkt — beides steht am Fall und
 * behauptet nichts. „Eine fachliche Priorität darf nicht ohne entsprechende
 * Grundlage automatisch angenommen werden": Aus „betrifft das Feld Betrag"
 * eine höhere Dringlichkeit abzuleiten wäre eine fachliche Annahme über den
 * Betrieb des Kunden, und die kann Unikom nicht treffen.
 */
export const KRITIKALITAET_RANG: Record<Kritikalitaet, number> = {
  KRITISCH: 0,
  PRUEFFALL: 1,
  KONFLIKT: 2,
  WARNUNG: 3,
  INFORMATION: 4,
};

/** Ob dieser Fall eine erneute Verarbeitung verhindert (Abschnitt 13). */
export function verhindertFreigabe(fall: Konfliktfall): boolean {
  if (istErledigt(fall.status)) {
    return false;
  }

  /*
   * Ein offener Hinweis hält nichts auf; ein offener kritischer Fall schon.
   * Dazwischen entscheidet die Einstellung — und bis es sie gibt, gilt die
   * vorsichtigere Lesart: Was als Konflikt oder Prüffall eingestuft wurde,
   * wartet auf eine Entscheidung.
   */
  return fall.kritikalitaet !== 'INFORMATION' && fall.kritikalitaet !== 'WARNUNG';
}
