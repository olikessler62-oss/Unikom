import type { SourceTrace } from '../source/SourceAdapter.js';

/**
 * Wohin eine Übertragung schreibt.
 *
 * Das Gegenstück zum SourceAdapter, und mit Absicht kleiner: Eine Quelle wird
 * durchsucht, gefiltert, beobachtet — ein Ziel nimmt entgegen. Fünf Verben
 * genügen, und genau fünf Stellen der Pipeline haben vorher unmittelbar ins
 * Dateisystem gegriffen.
 *
 * **Der Weg führt immer über den Arbeitsbereich.** `place` bekommt einen Pfad
 * auf der eigenen Platte, nie einen Strom. Das ist keine Bequemlichkeit,
 * sondern die Zusage des Erzeugnisses: Geprüft, entschlüsselt und gehasht wird
 * dort, und was im Ziel liegt, ist vollständig. Ein Durchleiten von Server zu
 * Server würde bei jedem Verbindungsabbruch einen Torso beim Empfänger
 * hinterlassen, der aussieht wie eine Datei.
 *
 * **Sichtbar wird eine Datei erst am Ende.** Lokal ist das ein Umbenennen im
 * selben Verzeichnis; entfernt ein Hochladen unter Arbeitsnamen und dann
 * dasselbe Umbenennen. Ein Empfänger, der sein Eingangsverzeichnis abfragt,
 * darf nie eine halb geschriebene Datei zu fassen bekommen.
 */
export interface DestinationAdapter {
  /** Von außen gesetzt; jeder Schritt meldet sich hierüber. */
  trace?: SourceTrace;

  /**
   * Stellt sicher, dass in das Verzeichnis geschrieben werden kann — es also
   * vorhanden und beschreibbar ist. Wirft mit einem Grund, den ein Anwender
   * lesen kann; das ist die erste Stelle, an der ein Lauf scheitern darf.
   */
  prepareDirectory(directory: string, mayCreate: boolean): Promise<void>;

  /** Ob dort schon etwas liegt. Entscheidet über Überspringen und Umbenennen. */
  exists(targetPath: string): Promise<boolean>;

  /**
   * Legt die fertige Datei aus dem Arbeitsbereich an ihren Platz. Danach ist
   * sie da oder es wurde geworfen — ein Dazwischen gibt es nicht.
   *
   * `runId` ist keine Beigabe fürs Protokoll: Auf einem entfernten Ziel geht
   * sie in den Arbeitsnamen ein, damit zwei Läufe nicht in dieselbe halbe
   * Datei schreiben. Das lokale Ziel braucht sie nicht, weil dort jeder Lauf
   * seinen eigenen Arbeitsbereich hat.
   */
  place(stagedPath: string, targetPath: string, runId: string): Promise<void>;

  /** Die Größe im Ziel, als Gegenprobe zu dem, was geschickt wurde. */
  sizeOf(targetPath: string): Promise<number>;

  /**
   * Ein Dateiname innerhalb des Zielverzeichnisses, als vollständiger Pfad.
   *
   * Hier sitzt der Ausbruchsschutz: Ein Name, den eine entfernte Quelle
   * geliefert hat, darf nicht aus dem Zielverzeichnis herausführen. Deshalb
   * baut die Pipeline keine Zielpfade mehr selbst zusammen.
   */
  resolve(directory: string, filename: string): string;

  /** Der Verzeichnisteil eines Zielpfads — für die Aufzeichnung des Laufs. */
  parentOf(targetPath: string): string;

  /** Der Namensteil eines Zielpfads. */
  nameOf(targetPath: string): string;

  /** Beschreibt das Ziel für Meldungen, ohne Zugangsdaten. */
  describe(): string;

  /** Gibt eine Netzverbindung frei; das lokale Ziel braucht das nicht. */
  dispose?(): Promise<void>;
}
