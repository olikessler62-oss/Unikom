import type { Referenzregel } from './Referenz.js';

/**
 * Verwaltete Referenzquellen (SPEC-04, Abschnitt 6 und 8).
 *
 * ```text
 * Referenzquelle              der Eintrag: Name, Datei, Version
 *      │
 *      ▼  wird zum Lauf gelesen
 * Referenzbestand             die Daten, eingefroren
 * ```
 *
 * ## Warum es diesen Eintrag geben muss
 *
 * Der Referenzabgleich ist seit Etappe 5 gebaut und vom Workflow aus nicht
 * erreichbar: Ein Lauf übergab nie einen Referenzbestand, weil es keine Stelle
 * gab, an der einer steht. Ihn in den Workflow zu kopieren war nie eine Option
 * — dann hielte jeder Workflow, der die Kundenliste abgleicht, seine eigene,
 * und beim nächsten Umzug wüsste niemand, welche gilt.
 *
 * Also steht hier der **Verweis** und nicht die Datenmenge: ein Name, eine
 * Datei, eine Version. Die Daten bleiben, wo sie sind, und werden zum Lauf
 * gelesen.
 *
 * ## Die Version ist keine Zierde
 *
 * „Ein Lauf, der sich nicht auf eine Version berufen kann, ist nicht
 * reproduzierbar" (SPEC-06, Abschnitt 13). Wer im März wissen will, warum ein
 * Datensatz im Januar durchging und heute ein Prüffall ist, muss sagen können,
 * welcher Stand der Postleitzahlenliste damals galt.
 *
 * Deshalb trägt jede Quelle eine Version — von Hand vergeben, oder aus dem
 * Änderungsdatum der Datei abgeleitet. Abgeleitet ist die Voreinstellung und
 * nicht die bessere Antwort: Sie ist genau, aber nichtssagend. Wer
 * „PLZ-Verzeichnis 2026-Q1" einträgt, sagt einem Menschen mehr.
 */
export interface Referenzquelle {
  id: string;
  tenantId: string;
  /** Wie sie in Regeln und Berichten genannt wird. */
  name: string;
  /** Wozu sie da ist — für den, der sie in einem Jahr vorfindet. */
  beschreibung?: string;
  /** Das Verzeichnis, in dem die Datei liegt. */
  verzeichnis: string;
  /** Der Dateiname; ohne Angabe die erste lesbare Datei des Verzeichnisses. */
  datei?: string;
  /**
   * Die Version, auf die sich ein Lauf beruft.
   *
   * Leer heißt: aus dem Änderungsdatum der Datei ableiten. Eine erfundene
   * Version wäre schlimmer als keine — sie sähe aus wie eine Zusage.
   */
  version?: string;
  /** Was beim letzten Nachsehen darin stand — nur zur Anzeige. */
  gesehen?: Referenzstand;
  angelegt: string;
  angelegtVonName?: string;
}

/** Was beim letzten Nachsehen in der Datei stand. */
export interface Referenzstand {
  datei: string;
  felder: readonly string[];
  zeilen: number;
  geaendert?: string;
  /** Wann Unikom zuletzt nachgesehen hat. */
  geprueft: string;
  /** Was der Leser anzumerken hatte. */
  hinweise?: readonly string[];
}

/**
 * Eine Referenzquelle, wie ein Konsolidierungsdurchgang sie benutzt.
 *
 * Der Verweis auf die Quelle **und** die Regel, wie nachgeschlagen wird. Die
 * Regel gehört zum Durchgang und nicht zur Quelle: Dieselbe Kundenliste wird im
 * einen Workflow über die Kundennummer nachgeschlagen und im anderen über die
 * Postleitzahl.
 */
export interface Referenzverweis extends Referenzregel {
  /** Die Kennung der verwalteten Quelle. */
  quelleId: string;
}

export interface Referenzquellenbestand {
  list(tenantId?: string): Promise<Referenzquelle[]>;
  byId(id: string): Promise<Referenzquelle | undefined>;
  save(quelle: Referenzquelle): Promise<void>;
  entferne(id: string): Promise<void>;
}

/**
 * Die Version, auf die sich ein Lauf beruft.
 *
 * Ohne eigene Angabe das Änderungsdatum der Datei. Das ist genau und
 * nichtssagend — aber es ist eine Tatsache, und eine Tatsache lässt sich
 * nachprüfen. Kennt niemand das Änderungsdatum, bleibt die Version leer: Ein
 * „unbekannt", das wie eine Version aussieht, wäre die schlechtere Auskunft.
 */
export function versionVon(quelle: Referenzquelle, geaendert?: string): string | undefined {
  const eigen = quelle.version?.trim();

  if (eigen) {
    return eigen;
  }

  return geaendert ?? quelle.gesehen?.geaendert;
}

/**
 * Was einer Referenzquelle fehlt, um benutzbar zu sein.
 *
 * Geprüft wird beim Anlegen und nicht erst im Nachtlauf. Eine Quelle ohne
 * Verzeichnis fällt sonst genau dann auf, wenn niemand da ist, der sie
 * eintragen könnte.
 */
export function maengel(quelle: Pick<Referenzquelle, 'name' | 'verzeichnis'>): string[] {
  const gefunden: string[] = [];

  if (!quelle.name.trim()) {
    gefunden.push('Der Referenzquelle fehlt ein Name - unter ihm wird sie in Regeln und Berichten genannt');
  }

  if (!quelle.verzeichnis.trim()) {
    gefunden.push('Der Referenzquelle fehlt das Verzeichnis, in dem ihre Datei liegt');
  }

  return gefunden;
}
