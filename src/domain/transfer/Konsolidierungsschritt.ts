import type { Referenzverweis } from '../consolidation/Referenzquelle.js';
import type { Aehnlichkeitsregeln } from '../consolidation/Aehnlichkeit.js';
import type { Aufteilung, Schritt, Zusammenfuehrung } from '../mapping/Umformung.js';
import type { Dublettenregel } from '../consolidation/Dubletten.js';
import type { Ergaenzungsregel } from '../consolidation/Ergaenzung.js';
import type { Mehrfachtrefferregel, OhneHauptsatz } from '../consolidation/Mehrfachtreffer.js';
import type { Entscheidungsregeln } from '../consolidation/Prioritaet.js';
import type { Betriebsart, Blattwahl, Konsolidierungsart } from '../consolidation/Quellen.js';
import type { Schluessel } from '../consolidation/Schluessel.js';

/**
 * Was am Workflow steht, damit die Konsolidierung ohne einen Menschen laufen
 * kann (SPEC-06, Abschnitt 11; SPEC-01, Abschnitt 13).
 *
 * ```text
 * Prüflauf   Regeln kommen mit der Anfrage    ein Mensch sieht zu
 * Nachtlauf  Regeln stehen am Workflow        niemand sieht zu
 * ```
 *
 * Bis hierher gab es nur die obere Zeile: Die Konsolidierung lief über die
 * Schnittstelle, und alles, was sie wissen musste, stand in der Anfrage. Für
 * einen Lauf um drei Uhr nachts gibt es keine Anfrage — also muss es hier
 * stehen.
 *
 * ## Was ein Lauf nicht selbst entscheidet
 *
 * Die **Mindestkonfidenz** steht nicht hier. Sie kommt aus der Hierarchie der
 * Einstellungen (Mandant, Profil, Lauf) und nie aus dem, was jemand mitschickt
 * — wer sie am Workflow senken dürfte, könnte sich eine automatische
 * Entscheidung bestellen, die im Prüflauf noch ein Konflikt war.
 *
 * Die **Referenzbestände** stehen ebenfalls nicht hier. Ein Referenzbestand ist
 * eine Datenmenge und keine Einstellung; ihn in den Workflow zu kopieren hieße,
 * die Kundenliste in jedem Workflow zu halten, der sie abgleicht — und beim
 * nächsten Umzug hätte man so viele Stände wie Workflows.
 *
 * Was hier steht, ist der **Verweis** darauf: die Kennung einer verwalteten
 * Referenzquelle samt der Regel, wie nachgeschlagen wird. Die Regel gehört zum
 * Durchgang und nicht zur Quelle — dieselbe Kundenliste wird im einen Workflow
 * über die Kundennummer nachgeschlagen und im anderen über die Postleitzahl.
 */
export interface Konsolidierungsregeln {
  betriebsart: Betriebsart;
  art: Konsolidierungsart;
  /** Beim Anreichern: der Dateiname der führenden Quelle. */
  fuehrend?: string;
  schluessel?: Schluessel;
  zielfelder?: readonly string[];
  /**
   * Verwaltete Referenzquellen, gegen die abgeglichen wird (SPEC-04 §6, §8).
   *
   * Nur die Kennung, nicht die Daten. Ohne diesen Verweis war der
   * Referenzabgleich vom Workflow aus unerreichbar: gebaut, aber nie
   * aufgerufen.
   */
  referenzen?: readonly Referenzverweis[];
  /**
   * Ohne die Mindestkonfidenz — sie kommt aus der Hierarchie der
   * Einstellungen. Als `Omit` und nicht als Bitte im Kommentar: Wer sie am
   * Workflow senken dürfte, könnte sich eine automatische Entscheidung
   * bestellen, die im Prüflauf noch ein Konflikt war.
   */
  entscheidung?: Omit<Entscheidungsregeln, 'mindestKonfidenz'>;
  dubletten?: Dublettenregel;
  mehrfachtreffer?: Mehrfachtrefferregel;
  ohneHauptsatz?: OhneHauptsatz;
  ergaenzung?: Ergaenzungsregel;
  aehnlichkeit?: Aehnlichkeitsregeln;
}

/**
 * Welche Dateien in den Lauf gehen.
 *
 * „Nicht ausdrücklich ausgewählte oder eindeutig über eine Regel bestimmte
 * Dateien dürfen nicht automatisch Bestandteil einer Konsolidierung werden"
 * (SPEC-06, Abschnitt 2). Ein Verzeichnis allein ist keine solche Regel — was
 * dort zufällig liegt, gehört nicht dazu, nur weil es dort liegt. Deshalb ist
 * das Muster hier die Regel, und ohne Muster gelten die Dateien, die der
 * vorangehende Schritt in diesem Lauf abgelegt hat: eine Liste, keine
 * Momentaufnahme eines Verzeichnisses.
 */
export interface Dateiwahl {
  /** Ein Namensmuster wie `Filiale_*.csv`; `*` und `?` gelten wie im Explorer. */
  muster?: string;
  /** Bei Arbeitsmappen: welches Blatt. Ohne Angabe gilt die Regel aus SPEC-06 §8. */
  blatt?: Blattwahl;
}

/**
 * Was vor dem Konsolidieren mit den Feldern geschieht (SPEC-09 §8 und §9).
 *
 * Die Reihenfolge steht fest: putzen, aufteilen, zusammenführen. Sie hat nur
 * eine sinnvolle Antwort — siehe `Umformungslauf` —, und eine einstellbare
 * verlangte von jedem, der einen Workflow einrichtet, eine Entscheidung
 * darüber.
 */
export interface Umformungsplan {
  /** Einzelne Felder putzen: Feldname und was damit geschieht. */
  felder?: readonly { feld: string; schritte: readonly Schritt[] }[];
  aufteilungen?: readonly Aufteilung[];
  zusammenfuehrungen?: readonly Zusammenfuehrung[];
}

/** Die voreingestellten Regeln eines neuen Konsolidierungsschritts. */
export const STANDARDREGELN: Konsolidierungsregeln = { betriebsart: 'SAMMELN', art: 'APPEND' };
