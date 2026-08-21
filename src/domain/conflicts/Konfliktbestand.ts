import type { Konfliktfilter } from './Auswahl.js';
import type { Bearbeitungsstand } from './Fortschritt.js';
import type { Bearbeitungsschritt } from './Historie.js';
import type { Konfliktfall } from './Konfliktfall.js';

/**
 * Der Bestand der Konfliktfälle (SPEC-07, Dateimodell).
 *
 * „Die Konfliktbearbeitung führt ihren Bestand in der Datenbank. Konflikt-UUID,
 * Status, Entscheidungen, Bearbeitungshistorie und der Bearbeitungsfortschritt
 * des Benutzers liegen in SQLite."
 *
 * Die Schnittstelle kennt deshalb kein `delete`. Ein Konfliktfall wird nicht
 * gelöscht — er wird erledigt. Was fortgeräumt wird, sind die Ausleitungen, und
 * die liegen im Dateisystem, nicht hier.
 *
 * Das Filtern steht mit in der Schnittstelle, obwohl es `filtere` in `Auswahl`
 * schon gibt: Bei zehntausend Fällen alle zu laden, um neun anzuzeigen, wäre
 * eine Entscheidung gegen jede Installation, die größer ist als die
 * Vorführung. Die Umsetzung im Arbeitsspeicher darf `filtere` benutzen; die
 * über SQLite baut ein `WHERE`.
 */
export interface Konfliktbestand {
  list(tenantId: string, filter?: Konfliktfilter): Promise<Konfliktfall[]>;
  byId(id: string): Promise<Konfliktfall | undefined>;
  /** Anlegen oder ersetzen — der Fall trägt seine Fassung selbst. */
  save(fall: Konfliktfall): Promise<void>;
  historie(fallId: string): Promise<Bearbeitungsschritt[]>;
  /** Nur anfügen. Es gibt keinen Weg, einen Schritt zu ändern. */
  schrittAnfuegen(schritt: Bearbeitungsschritt): Promise<void>;
  standOf(benutzer: string, tenantId: string): Promise<Bearbeitungsstand | undefined>;
  standSpeichern(stand: Bearbeitungsstand): Promise<void>;
}
