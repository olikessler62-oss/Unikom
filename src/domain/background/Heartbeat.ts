/**
 * Heartbeat und Prozessüberwachung (SPEC-01, Abschnitt 15; SPEC-02,
 * Abschnitt 52).
 *
 * ```text
 * RUNNING
 *    │
 *    ├── Heartbeat vorhanden → läuft
 *    │
 *    └── Heartbeat fehlt     → INTERRUPTED
 * ```
 *
 * ## Warum das nötig ist
 *
 * „Der Status darf nicht dauerhaft auf RUNNING stehen bleiben." Ein Lauf, dem
 * der Strom ausging, hat niemanden mehr, der ihn auf `FAILED` setzen könnte —
 * genau das ist der Punkt: Der Prozess, der den Fehler eintragen müsste, ist der
 * verschwundene. Deshalb schreibt er im Betrieb regelmäßig ein Lebenszeichen,
 * und **ein anderer** liest es.
 *
 * „Ein Neustart des Rechners darf nicht dazu führen, dass eine Verarbeitung
 * fälschlicherweise als erfolgreich abgeschlossen betrachtet wird" — und
 * genauso wenig, dass sie für immer als laufend gilt.
 *
 * ## Die Frist ist großzügig, und das mit Absicht
 *
 * Ein Worker, der gerade eine 800-MB-Datei entschlüsselt, schreibt für eine
 * Weile nichts. Ihn deshalb für tot zu erklären und seinen Lauf auf
 * `INTERRUPTED` zu setzen, während er weiterarbeitet, wäre der schlimmere
 * Fehler: Danach stünden zwei Wahrheiten über denselben Lauf im Bestand. Lieber
 * eine Minute zu lange warten als einmal zu früh urteilen.
 */
export interface Herzschlag {
  /** Der Prozess — eine Kennung, die einen Neustart nicht überlebt. */
  prozess: string;
  /** Wann zuletzt gemeldet. */
  zuletzt: string;
  /** Woran er gerade arbeitet; leer heißt: wartet auf Arbeit. */
  laufId?: string;
  /** Rechnername und Prozessnummer — für die Ferndiagnose. */
  host?: string;
  pid?: number;
  /** Seit wann dieser Prozess läuft. */
  gestartet: string;
}

/** Wie oft der Worker ein Lebenszeichen schreibt. */
export const HERZSCHLAG_ALLE_MS = 15_000;

/**
 * Ab wann ein ausbleibendes Lebenszeichen als Abbruch gilt.
 *
 * Das Vierfache des Abstands: Drei Schläge dürfen ausfallen, bevor geurteilt
 * wird. Bei einem einzigen ausgefallenen Schlag urteilte man über eine
 * Sekunde Verzögerung — und eine Sekunde Verzögerung hat jeder Rechner, der
 * gerade etwas anderes tut.
 */
export const ALS_ABGEBROCHEN_NACH_MS = HERZSCHLAG_ALLE_MS * 4;

export function istVerstummt(schlag: Herzschlag, jetzt: Date, frist = ALS_ABGEBROCHEN_NACH_MS): boolean {
  return jetzt.getTime() - Date.parse(schlag.zuletzt) > frist;
}

/** Wie lange her, in Worten — für die Meldung, die ein Mensch liest. */
export function seit(schlag: Herzschlag, jetzt: Date): string {
  const sekunden = Math.max(0, Math.round((jetzt.getTime() - Date.parse(schlag.zuletzt)) / 1000));

  if (sekunden < 90) {
    return `${sekunden} Sekunden`;
  }

  const minuten = Math.round(sekunden / 60);

  return minuten < 90 ? `${minuten} Minuten` : `${Math.round(minuten / 60)} Stunden`;
}

export interface Herzschlagbestand {
  melden(schlag: Herzschlag): Promise<void>;
  alle(): Promise<Herzschlag[]>;
  /** Ein Prozess, der sich ordentlich verabschiedet, räumt sein Lebenszeichen fort. */
  abmelden(prozess: string): Promise<void>;
}
