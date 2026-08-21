/**
 * Der Zugang zum Dateisystem, als Anschluss und nicht als Aufruf.
 *
 * Der Konsolidierungslauf soll sich prüfen lassen, ohne dass ein Test
 * Verzeichnisse anlegt und wieder aufräumt — und ohne dass ein misslungener
 * Test Reste hinterlässt, an denen der nächste scheitert. Deshalb steht hier
 * eine Schnittstelle mit drei Verben; das Echte liegt in der Infrastruktur.
 */
export interface Verzeichniseintrag {
  name: string;
  /** ISO-Zeitpunkt der letzten Änderung; er wird zum Datenstand der Quelle. */
  geaendert?: string;
  groesse?: number;
}

export interface Dateiablage {
  /** Die Dateien eines Verzeichnisses, ohne Unterverzeichnisse. */
  liste(verzeichnis: string): Promise<Verzeichniseintrag[]>;
  lies(pfad: string): Promise<Uint8Array>;
  /** Legt fehlende Verzeichnisse an — ein Lauf soll nicht daran scheitern. */
  schreibe(pfad: string, inhalt: Uint8Array): Promise<void>;
  /**
   * Nimmt eine Datei fort.
   *
   * Gebraucht wird das von der Bereinigung der Ausleitungen (SPEC-07,
   * Abschnitt 5) — dem einzigen Ort, an dem Unikom etwas löscht, das es selbst
   * geschrieben hat. Eine Datei, die schon fort ist, ist kein Fehler; ein
   * Verzeichnis, das sich nicht anfassen lässt, sehr wohl.
   */
  entferne(pfad: string): Promise<void>;
  /** Verbindet Verzeichnis und Namen nach den Regeln des Wirtssystems. */
  pfad(verzeichnis: string, name: string): string;
}
