/**
 * Benachrichtigungen (SPEC-01, Abschnitt 19 bis 22; SPEC-02, Abschnitt 51).
 *
 * ## Drei Stufen, und die Tabelle ist verbindlich
 *
 * ```text
 * Stufe                 Center  Windows  Popup  E-Mail    Fenster nach vorn
 * INFORMATION           ja      nein     nein   optional  nein
 * AKTION_ERFORDERLICH   ja      ja       ja     ja        ja
 * KRITISCH              ja      ja       ja     ja        ja
 * ```
 *
 * Die erste Zeile ist die wichtige. **Eine erfolgreiche Verarbeitung meldet sich
 * im Benachrichtigungscenter und sonst nirgends** — kein Popup, kein Fenster,
 * das sich nach vorn schiebt. Wer jeden Erfolg als Popup bekommt, klickt auch
 * das Konfliktfenster weg, ohne es gelesen zu haben.
 *
 * ## Persistent, weil das Wegklicken kein Bearbeiten ist
 *
 * „Offene, noch nicht bearbeitete bzw. bestätigte Benachrichtigungen werden
 * persistent gespeichert. Sie dürfen nicht verloren gehen, nur weil der Benutzer
 * das Popup schließt, der Browser geschlossen wird, der Rechner neu gestartet
 * wird."
 *
 * Deshalb gibt es zwei verschiedene Dinge: **gesehen** und **bestätigt**. Ein
 * geschlossenes Popup ist gesehen. Erledigt ist ein Fall erst, wenn jemand sagt,
 * dass er erledigt ist.
 */
export type Meldestufe = 'INFORMATION' | 'AKTION_ERFORDERLICH' | 'KRITISCH';

/** Über welche Wege eine Stufe hinausgeht (SPEC-01, Abschnitt 21). */
export interface Kanaele {
  center: boolean;
  windows: boolean;
  popup: boolean;
  email: boolean;
  /** Ob das Fenster sich in den Vordergrund schiebt. */
  nachVorn: boolean;
}

export const KANAELE: Record<Meldestufe, Kanaele> = {
  INFORMATION: { center: true, windows: false, popup: false, email: false, nachVorn: false },
  AKTION_ERFORDERLICH: { center: true, windows: true, popup: true, email: true, nachVorn: true },
  KRITISCH: { center: true, windows: true, popup: true, email: true, nachVorn: true },
};

/**
 * Wo eine Meldung entstanden ist — sie bestimmt, was der Benutzer tun kann.
 *
 * Ohne Anlass wäre eine Meldung ein Satz auf dem Bildschirm; mit Anlass ist sie
 * ein Weg zu der Stelle, an der sich etwas erledigen lässt.
 */
export type Meldeanlass =
  | 'LAUF_ERFOLGREICH'
  | 'LAUF_FEHLER'
  | 'LAUF_ABGEBROCHEN'
  | 'KONFLIKTE_ENTSTANDEN'
  | 'FREIGABE_ERFORDERLICH'
  /**
   * Ein Termin ist verstrichen, ohne dass etwas geschah.
   *
   * Der einzige Anlass, der aus einem **Nicht**-Ereignis entsteht — und
   * deshalb der wichtigste: Ein Lauf, der fehlschlägt, meldet sich. Ein Lauf,
   * der gar nicht erst anfängt, meldet gar nichts, und niemand vermisst um
   * drei Uhr nachts eine Nachricht, die nie kam.
   */
  | 'VERARBEITUNG_AUSGEBLIEBEN';

/**
 * Welche Stufe ein Anlass hat (SPEC-02, Abschnitt 51).
 *
 * „Ein neu entstandener Konfliktbestand ist eine Meldung der Stufe ‚Aktion
 * erforderlich‘; ein unerwarteter Abbruch und ein technischer Fehler sind
 * kritische Ereignisse."
 */
export const ANLASS_STUFE: Record<Meldeanlass, Meldestufe> = {
  LAUF_ERFOLGREICH: 'INFORMATION',
  LAUF_FEHLER: 'KRITISCH',
  LAUF_ABGEBROCHEN: 'KRITISCH',
  KONFLIKTE_ENTSTANDEN: 'AKTION_ERFORDERLICH',
  FREIGABE_ERFORDERLICH: 'AKTION_ERFORDERLICH',
  VERARBEITUNG_AUSGEBLIEBEN: 'KRITISCH',
};

export interface Benachrichtigung {
  id: string;
  tenantId: string;
  anlass: Meldeanlass;
  stufe: Meldestufe;
  /** Eine Zeile, die für sich steht — auch in einer Windows-Blase. */
  titel: string;
  /** Was geschehen ist, in Sätzen. */
  text: string;
  /** Wohin die Meldung führt: der Lauf, der Konfliktbestand, das Ergebnis. */
  ziel?: { art: 'LAUF' | 'KONFLIKTE' | 'ERGEBNIS'; id: string };
  entstanden: string;
  /** Wann sie jemandem gezeigt wurde — ein geschlossenes Popup zählt. */
  gesehen?: string;
  /** Wann jemand sie als erledigt bezeichnet hat. Das ist etwas anderes. */
  bestaetigt?: string;
  bestaetigtVon?: string;
}

/** Ob diese Meldung noch aussteht — die Frage, die der Notification Agent stellt. */
export function istOffen(meldung: Benachrichtigung): boolean {
  return meldung.bestaetigt === undefined;
}

/**
 * Ob sie beim nächsten Start erneut gezeigt werden soll (SPEC-01, Abschnitt 22).
 *
 * „Beim nächsten Start des Notification Agents können offene kritische
 * Meldungen erneut angezeigt werden." Nur die dringenden: Eine Information von
 * vorgestern noch einmal aufzuklappen, erzieht dazu, alles wegzuklicken.
 */
export function erneutZeigen(meldung: Benachrichtigung): boolean {
  return istOffen(meldung) && KANAELE[meldung.stufe].popup;
}

/**
 * Eine Meldung, die für sich steht.
 *
 * Der Titel muss ohne den Text verständlich sein: In einer Windows-Blase steht
 * oft nur er, und „Verarbeitung beendet" beantwortet dort keine Frage.
 */
export function meldung(
  anlass: Meldeanlass,
  teile: { titel: string; text: string; ziel?: Benachrichtigung['ziel'] }
): Omit<Benachrichtigung, 'id' | 'tenantId' | 'entstanden'> {
  return { anlass, stufe: ANLASS_STUFE[anlass], ...teile };
}

export interface Benachrichtigungsbestand {
  anlegen(meldung: Benachrichtigung): Promise<void>;
  /** Die Meldungen eines Mandanten, jüngste zuerst. */
  list(tenantId: string, nurOffene?: boolean): Promise<Benachrichtigung[]>;
  gesehen(id: string, zeitpunkt: string): Promise<void>;
  bestaetigen(id: string, benutzer: string, zeitpunkt: string): Promise<void>;
}
