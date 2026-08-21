import type { Konfliktfall } from './Konfliktfall.js';

/**
 * Ausleitungen des Konfliktbestands (SPEC-01, Abschnitt 23; SPEC-07,
 * Dateimodell und Abschnitt 5).
 *
 * ```text
 * Konfliktbestand (SQLite)  ──┬──► Konfliktdatei      zur Ansicht, zur Weitergabe
 *   UUID, Status,             │
 *   Entscheidungen,           └──► Konfliktzieldatei  zur erneuten Verarbeitung
 *   Historie
 * ```
 *
 * ## Eine Ausleitung führt den Bestand nicht
 *
 * Sie ist eine Abschrift. Genau deshalb darf sie nach Ablauf der
 * Aufbewahrungsfrist fortgeräumt werden, ohne dass etwas verloren geht:
 * Konfliktfall, Entscheidungen und Historie bleiben in der Datenbank. „Die
 * Nachvollziehbarkeit hängt damit nicht an einer Datei, die irgendwann
 * fortgeräumt wird."
 *
 * Umgekehrt heißt das: Eine Ausleitung darf nie die einzige Stelle sein, an der
 * etwas steht. Sie trägt die UUIDs mit, damit ein Fall auch außerhalb von
 * Unikom wiedererkennbar bleibt — nicht, damit er dort weiterlebt.
 */
export type Ausleitungsart = 'KONFLIKTE' | 'ZIEL';

export interface Ausleitung {
  id: string;
  tenantId: string;
  art: Ausleitungsart;
  /** Der Lauf, dessen Fälle ausgeleitet wurden. */
  laufId?: string;
  /** Wohin geschrieben wurde. */
  pfad: string;
  name: string;
  /** Wie viele Fälle darin stehen. */
  faelle: number;
  erstellt: string;
  erstelltVonName?: string;
  /**
   * Wann die Datei fortgeräumt wurde.
   *
   * Der Eintrag bleibt stehen. Wer im März wissen will, warum eine Datei vom
   * Januar nicht mehr da ist, findet hier die Antwort — und nicht eine Lücke,
   * die nach einem Fehler aussieht.
   */
  entferntAm?: string;
}

/**
 * Der Bestand der Ausleitungen.
 *
 * Er weiß, welche Dateien Unikom geschrieben hat. Ohne ihn wäre die Bereinigung
 * ein Programm, das in einem Verzeichnis nach Dateinamen sucht, die es für die
 * eigenen hält — und irgendwann räumt es eine fremde fort.
 *
 * Es gibt kein `delete`: Was fortgeräumt wird, ist die **Datei**. Der Eintrag
 * bleibt und trägt ab dann `entferntAm`.
 */
export interface Ausleitungsbestand {
  list(tenantId?: string): Promise<Ausleitung[]>;
  save(ausleitung: Ausleitung): Promise<void>;
}

/** Ob ein Lauf durch ist — mehr braucht die Bereinigung nicht zu wissen. */
export interface Laufauskunft {
  abgeschlossen(laufId: string): Promise<boolean>;
}

/**
 * Wie lange eine Ausleitung liegen bleibt, wenn niemand etwas anderes sagt.
 *
 * Lang genug, um eine Datei weiterzugeben und eine Rückfrage abzuwarten, kurz
 * genug, um eine Frist zu sein und nicht „für immer". Der Bestand selbst ist
 * davon nicht berührt.
 */
export const AUFBEWAHRUNG_TAGE = 30;

const MS_JE_TAG = 24 * 60 * 60 * 1000;

/** Die feste Spaltenfolge der Konfliktdatei — vorn steht, was den Fall benennt. */
export const KONFLIKTSPALTEN: readonly string[] = [
  'konflikt_uuid',
  'lauf',
  'datensatz',
  'art',
  'kritikalitaet',
  'status',
  'ursache',
  'regel',
  'erwartet',
  'vorgefunden',
  'naechste_schritte',
  'quellen',
  'entstanden',
  'geaendert',
];

/**
 * Die Konfliktdatei: ein Fall je Zeile.
 *
 * ## Warum die Streitfelder mitkommen
 *
 * SPEC-07, Abschnitt 4, verlangt für die Darstellung eines Prüffalls die
 * betroffenen Daten, die vorhandenen Werte und die zugehörigen Quellen. Eine
 * Ausleitung, die nur „Wertkonflikt in Zeile 412" sagt, ist zum Weitergeben
 * unbrauchbar: Der Empfänger muss zurückfragen, was denn nun in Streit steht.
 *
 * Je Streitfeld entsteht deshalb eine Spalte, und darin stehen die
 * konkurrierenden Werte mit ihrer Quelle — `Meier (a.csv) | Meyer (b.csv)`.
 * Nicht eine Zeile je Feld: Ein Fall soll ein Fall bleiben, sonst zählt der
 * Empfänger falsch.
 */
export function konfliktdatei(faelle: readonly Konfliktfall[]): { felder: string[]; zeilen: string[][] } {
  const streitfelder: string[] = [];

  for (const fall of faelle) {
    for (const feld of fall.felder) {
      if (!streitfelder.includes(feld.feld)) {
        streitfelder.push(feld.feld);
      }
    }
  }

  const felder = [...KONFLIKTSPALTEN, ...streitfelder];

  const zeilen = faelle.map((fall) => [
    fall.id,
    fall.laufId,
    fall.datensatz,
    fall.art,
    fall.kritikalitaet,
    fall.status,
    fall.ursache,
    fall.regel ?? '',
    fall.erwartet,
    fall.vorgefunden,
    fall.naechsteSchritte,
    fall.quellen.join(', '),
    fall.entstanden,
    fall.geaendert,
    ...streitfelder.map((name) => angebote(fall, name)),
  ]);

  return { felder, zeilen };
}

/** Die konkurrierenden Werte eines Feldes, mit ihrer Quelle. */
function angebote(fall: Konfliktfall, feld: string): string {
  const streit = fall.felder.find((eintrag) => eintrag.feld === feld);

  if (!streit) {
    return '';
  }

  return streit.angebote.map((angebot) => `${angebot.wert} (${angebot.quelle})`).join(' | ');
}

/**
 * Ob eine Ausleitung fortgeräumt werden darf.
 *
 * Drei Bedingungen, und alle drei stehen in SPEC-07, Abschnitt 5:
 *
 * 1. Die Frist ist um.
 * 2. Sie liegt noch da — zweimal löschen ist kein Fortschritt.
 * 3. **Der Lauf ist erfolgreich abgeschlossen.** „Für nicht erfolgreich
 *    abgeschlossene oder noch in Bearbeitung befindliche Läufe dürfen für
 *    Fortsetzung, Konfliktbearbeitung, Fehleranalyse oder Wiederherstellung
 *    erforderliche Dateien nicht vorzeitig gelöscht werden." Eine Aufräumung,
 *    die nur auf das Datum sieht, nimmt genau dem die Unterlagen weg, der
 *    gerade einen misslungenen Lauf untersucht.
 *
 * Ist der Lauf **unbekannt**, bleibt die Datei liegen. Das ist die
 * unbequemere Antwort und die richtige: Eine Frist, die im Zweifel löscht,
 * löscht irgendwann das, was jemand gebraucht hätte.
 *
 * Eine Ausleitung **ohne Lauf** — über den ganzen Bestand — hat keinen Lauf,
 * dessen Untersuchung sie stören könnte. Für sie zählt nur die Frist.
 */
export function darfFortgeraeumtWerden(
  ausleitung: Ausleitung,
  lauf: { abgeschlossen: boolean } | undefined,
  optionen: { tage?: number; jetzt: Date }
): boolean {
  if (ausleitung.entferntAm) {
    return false;
  }

  if (ausleitung.laufId !== undefined && !lauf?.abgeschlossen) {
    return false;
  }

  return abgelaufen(ausleitung, optionen);
}

/** Ob die Frist um ist. Eine Frist von null Tagen räumt nichts fort, sondern schaltet ab. */
export function abgelaufen(ausleitung: Ausleitung, optionen: { tage?: number; jetzt: Date }): boolean {
  const tage = optionen.tage ?? AUFBEWAHRUNG_TAGE;

  if (tage <= 0) {
    return false;
  }

  const erstellt = Date.parse(ausleitung.erstellt);

  if (Number.isNaN(erstellt)) {
    return false;
  }

  return optionen.jetzt.getTime() - erstellt >= tage * MS_JE_TAG;
}

/**
 * Der Dateiname einer Ausleitung.
 *
 * Er trägt Art, Lauf und Zeitpunkt. Zwei Ausleitungen desselben Laufs am selben
 * Tag dürfen sich nicht überschreiben — die erste wäre weg, und niemand hätte
 * es gesehen.
 */
export function ausleitungsname(art: Ausleitungsart, laufId: string | undefined, jetzt: Date): string {
  const stempel = jetzt.toISOString().replace(/[:.]/g, '-');
  const wovon = laufId ? `_${laufId}` : '';

  return `${art === 'ZIEL' ? 'konfliktziel' : 'konflikte'}${wovon}_${stempel}.csv`;
}
