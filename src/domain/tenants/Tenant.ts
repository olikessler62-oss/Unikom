import type { Region } from './Region.js';
import type { Meldeeinstellungen } from '../background/Postausgang.js';
import type { Konfliktverhalten } from '../conflicts/Konfliktverhalten.js';
import type { Mandanteneinstellungen } from '../consolidation/Einstellungen.js';

/**
 * A client of the operator — "Mandant" in the interface.
 *
 * This is not the SaaS kind of tenant. Unikom runs on the operator's own
 * machine and serves exactly one company. That company, however, may be a
 * service provider who collects, processes and delivers data for several of
 * their own clients, and those must not get mixed up.
 *
 * A company with a single source server simply has one tenant and never has to
 * think about it.
 */
export interface Tenant {
  id: string;
  /** Shown everywhere; has to be unique so two clients cannot be confused. */
  name: string;
  description?: string;
  /**
   * Everything this tenant's jobs write stays below this directory, and that is
   * checked rather than trusted. Without it a typo in a destination path drops
   * one client's files into another client's folder, and nobody notices.
   *
   * Optional: an installation with a single client gains nothing from it. As
   * soon as it is set, it is enforced.
   */
  rootDirectory?: string;
  /**
   * Wonach die Datums- und Zeitangaben dieses Mandanten gelesen werden.
   *
   * Fehlt sie, gilt `DEFAULT_REGION` — siehe `regionOf`. Sie steht hier und
   * nicht an der Installation, weil ein Dienstleister Kunden in mehreren
   * Ländern hat: `04/03/2026` ist beim einen der 4. März und beim anderen der
   * 3. April, und beide Lesarten gelingen ohne Fehlermeldung.
   */
  region?: Region;
  /**
   * Die Einstellungen dieses Mandanten für die Konsolidierung — die Ebene, die
   * in der Hierarchie immer gewinnt (SPEC-02, Abschnitt 40).
   *
   * Sprache und Zeitzone stehen bewusst **nicht** darin: Die trägt `region`,
   * und zwei Orte für dieselbe Angabe sind einer zu viel. Welcher gälte, wenn
   * sie auseinanderlaufen, wäre eine Frage ohne gute Antwort.
   */
  consolidation?: Mandanteneinstellungen;
  /**
   * Wohin Meldungen dieses Mandanten hinausgehen (SPEC-01, Abschnitt 20).
   *
   * Am Mandanten und nicht an der Installation: Empfänger sind je Kunde
   * verschieden, und bei einem Dienstleister ist es auch der Postausgang — der
   * eine will über seinen eigenen Server versenden, weil sein Spamfilter nur
   * den kennt. An der Installation stünde eine Anschrift, die für alle gilt und
   * für niemanden stimmt.
   */
  benachrichtigung?: Meldeeinstellungen;
  /**
   * Wie lange Ausleitungen des Konfliktbestands liegen bleiben (SPEC-07 §5).
   *
   * Am Mandanten und nicht an der Installation: Der eine Kunde gibt
   * Konfliktdateien an seinen Lieferanten weiter und braucht sie wochenlang,
   * der nächste will sie nach drei Tagen fort haben. Eine Zahl für alle wäre
   * für niemanden die richtige.
   *
   * Ohne Angabe gilt die Voreinstellung. **Null schaltet ab** und löscht nicht
   * sofort — abschalten und „sofort forträumen" dürfen nicht dieselbe Eingabe
   * sein.
   */
  ausleitungenTage?: number;
  /**
   * Wie lange Archivpakete liegen bleiben (FR_006, Runde 10).
   *
   * Dieselbe Form wie `ausleitungenTage` und mit Absicht dieselbe Bedeutung
   * der Null: **abgeschaltet**, nicht „sofort fort". Zwei Aufbewahrungsangaben,
   * bei denen die Null Verschiedenes hieße, wären die Falle, in die genau
   * einmal jemand tritt.
   *
   * Am Mandanten und nicht an der Installation, aus demselben Grund wie dort:
   * Der eine Kunde muss Lieferscheine sieben Jahre vorhalten, der nächste will
   * personenbezogene Daten nach einem Quartal fort haben.
   *
   * Ohne Angabe gilt `ARCHIV_TAGE`.
   */
  archivTage?: number;
  /**
   * Wie dieser Mandant mit offenen Konflikten umgeht — siehe
   * `Konfliktverhalten`.
   *
   * Am Mandanten und nicht an der Installation, aus demselben Grund wie die
   * beiden Angaben darüber: Der eine Kunde will am Morgen über jeden offenen
   * Fall stolpern, der nächste arbeitet eine Liste ab und will dabei nicht
   * alle zehn Minuten ein Fenster wegklicken.
   */
  konflikte?: Konfliktverhalten;
  /** A disabled tenant keeps its history; its jobs no longer run. */
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantRepository {
  list(): Promise<Tenant[]>;
  getById(id: string): Promise<Tenant | undefined>;
  findByName(name: string): Promise<Tenant | undefined>;
  save(tenant: Tenant): Promise<Tenant>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

/** Identifier of the tenant an installation starts with. */
export const DEFAULT_TENANT_ID = 'default';
export const DEFAULT_TENANT_NAME = 'Standard';
