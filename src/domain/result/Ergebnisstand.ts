import type { Ergebnispruefung } from './Ergebnispruefung.js';
import type { Freigabevermerk, Verarbeitungsstatus } from './Freigabe.js';

/**
 * Der Ergebnisbestand eines Laufs (SPEC-06, Abschnitt 13 und 14).
 *
 * „Jeder Konsolidierungslauf erzeugt einen eigenständigen Ergebnisbestand.
 * Historische Ergebnisstände und Entscheidungen bleiben unverändert erhalten.
 * Ein vorheriger gültiger Ergebnisstand muss, sofern verfügbar,
 * wiederherstellbar sein."
 *
 * ## Wiederherstellen heißt kopieren, nicht zurückspulen
 *
 * ```text
 * Stand 1  (freigegeben)
 * Stand 2  (Korrektur, verworfen)
 * Stand 3  ← „Stand 1 wiederhergestellt", verweist auf 1 und auf 2
 * ```
 *
 * Ein Stand wird nie verändert und nie gelöscht. Wer einen früheren
 * wiederherstellt, erzeugt einen **neuen** mit demselben Inhalt und einem
 * Verweis auf die Herkunft. Sonst verschwände die Zwischenzeit aus der
 * Geschichte — und mit ihr die Frage, warum jemand zurückgehen musste.
 */
export interface Ergebnisstand {
  id: string;
  tenantId: string;
  /** Der Verarbeitungslauf, der ihn erzeugt hat. */
  laufId: string;
  /**
   * Der Workflow, aus dem der Lauf stammt.
   *
   * Er steht **am Stand** und nicht in der Anfrage. Als Parameter der Übergabe
   * wäre er das Schlupfloch: Wer ihn wegließe, käme an der Prüfung vorbei, ob
   * Modul 3 in diesem Ablauf überhaupt eingeschaltet ist — und eine Bedingung,
   * die sich durch Weglassen erfüllen lässt, ist keine.
   */
  jobId: string;
  /**
   * Der Lauf, auf dem dieser aufsetzt (SPEC-01, Abschnitt 9).
   *
   * Eine Korrektur läuft als eigener Verarbeitungslauf mit eigener Kennung, der
   * auf den ursprünglichen verweist — nicht als stiller zweiter Anlauf desselben.
   */
  ausLauf?: string;
  /** Der Stand, aus dem dieser durch Wiederherstellung hervorging. */
  wiederhergestelltAus?: string;
  felder: string[];
  zeilen: string[][];
  pruefung: Ergebnispruefung;
  status: Verarbeitungsstatus;
  freigabe?: Freigabevermerk;
  entstanden: string;
}

/** Ob dieser Stand als gültiges Ergebnis gilt (SPEC-08, Abschnitt 13). */
export function istGueltig(stand: Ergebnisstand): boolean {
  /*
   * Nur die Freigabe zählt, nicht der Status allein. Ein Lauf kann technisch
   * `COMPLETED` heißen und trotzdem auf eine Freigabe warten — „ein nicht
   * freigegebenes Ergebnis ist kein gültiges Ergebnis. Es darf von Modul 3
   * nicht übernommen werden."
   */
  return stand.freigabe !== undefined && stand.status !== 'WAITING_FOR_RELEASE' && stand.status !== 'FAILED';
}

export interface Ergebnisbestand {
  list(tenantId: string, laufId?: string): Promise<Ergebnisstand[]>;
  byId(id: string): Promise<Ergebnisstand | undefined>;
  /**
   * Anlegen. Es gibt bewusst kein `update` für Inhalt und Prüfung — nur die
   * Freigabe kommt später hinzu, und dafür gibt es `freigabeVermerken`.
   */
  save(stand: Ergebnisstand): Promise<void>;
  freigabeVermerken(id: string, status: Verarbeitungsstatus, vermerk: Freigabevermerk): Promise<void>;
}
