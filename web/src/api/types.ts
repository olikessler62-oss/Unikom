/**
 * What the API sends. Kept as its own definitions rather than importing the
 * server types: dates arrive as strings over JSON, and the interface should
 * notice when a field disappears instead of silently reading undefined.
 */

export type Role = 'ADMIN' | 'STANDARD';

export type Permission =
  | 'VIEW'
  | 'RUN_JOBS'
  | 'MANAGE_JOBS'
  | 'MANAGE_CREDENTIALS'
  | 'MANAGE_USERS'
  | 'HANDLE_CONFLICTS';

/**
 * Vier Module werden verkauft — Übertragen eingeschlossen; entfernte Quellen und
 * Verschlüsselung sind Fähigkeiten darin, keine Produkte daneben.
 */
export type Feature =
  | 'TRANSFER'
  | 'REMOTE_SOURCES'
  | 'ENCRYPTION'
  | 'CONSOLIDATION'
  | 'DATA_IMPORT'
  | 'CONVERSION';

export interface User {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  /** Drei Stellen, eindeutig; der Server vergibt sie aus dem Namen. */
  initials: string;
  /** Vor- und Nachname zusammen — abgeleitet, nicht getrennt gepflegt. */
  displayName: string;
  role: Role;
  enabled: boolean;
  /** Darf Konfliktdaten sehen; hängt am Benutzer, nicht an der Stufe. */
  handleConflicts: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
}

/**
 * Wie lange diese Installation bezahlt ist. Der Server entscheidet damit, die
 * Oberfläche berichtet es nur — geprüft wird vor jeder Übertragung, nicht hier.
 */
export type LicenceState = 'UNLICENSED' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | 'INVALID';

export interface Licence {
  state: LicenceState;
  /** Ob Übertragungen starten dürfen. Alles andere bleibt immer erreichbar. */
  mayRun: boolean;
  customer?: string;
  licenceId?: string;
  validUntil?: string;
  daysRemaining?: number;
  problem?: string;
  features?: Feature[];
}

export interface Identity {
  user: User;
  permissions: Permission[];
  mustChangePassword: boolean;
  csrfToken?: string;
  features?: Feature[];
  licence?: Licence;
}

export interface Tenant {
  id: string;
  name: string;
  description?: string;
  rootDirectory?: string;
  /**
   * Wonach die Datums- und Zeitangaben dieses Mandanten gelesen werden. Der
   * Server schickt sie immer mit — auch die Voreinstellung, damit die
   * Oberfläche nichts erschließen muss.
   */
  region?: { locale: string; timeZone: string };
  /** Ob die Angabe am Mandanten steht oder die Voreinstellung ist. */
  regionIsDefault?: boolean;
  dateOrder?: 'DAY_FIRST' | 'MONTH_FIRST' | 'YEAR_FIRST';
  /** Der 3. April 2026 in der Schreibweise dieses Mandanten. */
  dateSample?: string;
  enabled: boolean;
  jobCount?: number;
  /** Wohin die Meldungen dieses Mandanten hinausgehen. */
  benachrichtigung?: Meldeeinstellungen;
  /** Die Konsolidierungseinstellungen dieses Kunden — die Ebene, die gewinnt. */
  consolidation?: Mandanteneinstellungen;
  /** Was gilt, wo am Mandanten nichts steht. Kommt vom Server. */
  voreinstellungen?: Required<Mandanteneinstellungen> & { locale: string; timeZone: string };
  /** Wie lange Ausleitungen liegen bleiben; leer heißt: Voreinstellung. */
  ausleitungenTage?: number;
  /** Wie lange Archivpakete liegen bleiben; leer heißt: Voreinstellung. */
  archivTage?: number;
  /** Wie dieser Mandant mit offenen Konflikten umgeht. */
  konflikte?: Konfliktverhalten;
  /** Was gilt, solange dort nichts steht. Kommt vom Server. */
  konflikteVoreinstellung?: Required<Konfliktverhalten>;
}

/**
 * Wie sich ein offener Konflikt meldet, bis er entschieden ist.
 *
 * ```text
 * EINMAL              zeigt sich einmal, danach nur noch in der Glocke
 * WIEDERVORLAGE       zeigt sich nach Ablauf der Frist erneut
 * BEI_JEDEM_OEFFNEN   zeigt sich bei jedem Wechsel der Ansicht
 * ```
 */
export type Vorlageart = 'EINMAL' | 'WIEDERVORLAGE' | 'BEI_JEDEM_OEFFNEN';

/**
 * Was mit einer Lieferung geschieht, in der Zeilen dem Schema nicht genügen.
 *
 * ```text
 * NUR_VOLLSTAENDIG  eine Datei mit Fehlern wird gar nicht verarbeitet
 * IN_TEILEN         die guten Zeilen laufen weiter, die schlechten
 *                   wandern in eine eigene Datei nach „Gescheitert"
 * ```
 */
export type Auslieferungsart = 'NUR_VOLLSTAENDIG' | 'IN_TEILEN';

export interface Konfliktverhalten {
  vorlage?: Vorlageart;
  /** Nach wie vielen Stunden erneut — nur bei `WIEDERVORLAGE`. */
  wiedervorlageStunden?: number;
  /** Ob ein Fall hingenommen werden darf, statt entschieden zu werden. */
  akzeptierenErlaubt?: boolean;
  /** Ob eine Lieferung mit fehlerhaften Zeilen geteilt werden darf. */
  auslieferung?: Auslieferungsart;
}

/**
 * Was ein Mandant für die Konsolidierung einstellen kann (SPEC-02 §40).
 *
 * Sprache und Zeitzone stehen bewusst nicht darin — die trägt `region`, und
 * zwei Orte für dieselbe Angabe sind einer zu viel.
 */
export interface Mandanteneinstellungen {
  /** Ab welcher zweistelligen Jahreszahl das vorige Jahrhundert gemeint ist. */
  jahrhundertGrenze?: number;
  /** Werte, die als „nichts" gelten. */
  nullWerte?: string[];
  /** Wie viele Werte je Feld geprüft werden. */
  stichprobe?: number;
  /** Worauf erweitert wird, wenn die Stichprobe nicht reicht. */
  stichprobeGrenze?: number;
  /** Ab welchem Anteil passender Werte ein Typ als sicher gilt. */
  mindestKonfidenz?: number;
}

/**
 * Der Postausgang eines Mandanten.
 *
 * Das Kennwort steht **nicht** hier: `zugangId` verweist auf einen hinterlegten
 * Zugang. Ein Kennwort in den Einstellungen wäre über jede Sicherung und jede
 * Fehlermeldung mitgereist.
 */
export interface Postausgang {
  host: string;
  port: number;
  verschluesselung: 'STARTTLS' | 'IMPLIZIT' | 'KEINE';
  zugangId?: string;
  absender: string;
}

export interface Meldeeinstellungen {
  empfaenger: string[];
  /** Auch dann schreiben, wenn nichts anliegt. */
  auchBeiErfolg?: boolean;
  postausgang?: Postausgang;
}

/**
 * `SHARE` steht neben `LOCAL`, obwohl beide über das Dateisystem laufen: Eine
 * Freigabe kann eigene Anmeldedaten verlangen, ein Verzeichnis auf der eigenen
 * Platte nie.
 */
export type SourceType = 'LOCAL' | 'SHARE' | 'SFTP' | 'FTPS';

export interface SourceConfig {
  type: SourceType;
  directory: string;
  /**
   * Wo diese Verbindung auf dem Server beginnt, wenn nicht im Anmeldeordner.
   * Jeder eingegebene Pfad wird von hier aus gelesen, und keiner darf hinaus.
   */
  remoteWorkingDirectory?: string;
  host?: string;
  port?: number;
  timeoutSeconds?: number;
  /** `SHA256:<base64>`, the way OpenSSH prints it. */
  hostKeyFingerprint?: string;
  allowUnknownHostKey?: boolean;
  validateCertificates?: boolean;
  trustedCertificate?: string;
  implicitFtps?: boolean;
}

export interface Schedule {
  type: 'INTERVAL' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'CRON';
  intervalMinutes?: number;
  executionTime?: string;
  weekdays?: number[];
  cronExpression?: string;
  timezone: string;
  missedRunPolicy: 'SKIP';
}

/**
 * Woher ein Kettenglied liest und wohin es schreibt.
 *
 * `PRECEDING` und `FOLLOWING` sind Verweise, keine Pfade: ändert jemand das Ziel
 * des Gliedes davor, folgt dieses mit. Ein vorbestücktes Textfeld wäre genau bis
 * zu dieser Änderung richtig und danach still falsch.
 */
export type StageInput =
  | { from: 'PRECEDING' }
  | { from: 'DIRECTORY'; directory: string; art?: 'LOCAL' | 'SHARE'; credentialId?: string };
export type StageOutput = { to: 'FOLLOWING' } | { to: 'DIRECTORY'; directory: string };

/**
 * Jedes Glied außer dem Übertragen. Eine Form für alle: sie unterscheiden sich
 * darin, was sie mit den Daten tun, nicht darin, wie sie eingehängt sind.
 */
/** Wohin das Ergebnis geht — entweder, oder. */
export type Lieferziel = 'DATENBANK' | 'DATEI';

export type Lieferformat = 'CSV' | 'JSON' | 'XML';

/**
 * Das dritte Glied: Daten exportieren/importieren.
 *
 * Das Konvertieren ist kein eigenes Glied, sondern ein Häkchen am Export — wer
 * in eine Datenbank importiert, konvertiert davor keine Datei.
 */
export interface DeliverConfig extends StageConfig {
  ziel: Lieferziel;
  konvertieren?: { format: Lieferformat };
}

export interface StageConfig {
  enabled: boolean;
  input: StageInput;
  /** Fehlt, wo das Glied nicht in ein Verzeichnis schreibt. */
  output?: StageOutput;
}

/**
 * Das zweite Glied: Daten konsolidieren — mit den Regeln, nach denen es das
 * ohne einen Menschen tut.
 *
 * Die Regeln stehen am Workflow und nicht in der Anfrage: Ein Lauf um drei Uhr
 * nachts hat niemanden, den er fragen könnte. Was hier fehlt, steht bewusst
 * nicht hier — die Mindestkonfidenz kommt aus den Einstellungen des Mandanten,
 * und Referenzbestände sind Daten und keine Einstellung.
 */
/** Wann zwei Werte als derselbe gelten. */
export interface Wertvergleich {
  grossKleinEgal?: boolean;
  leerzeichenEgal?: boolean;
  umlauteEgal?: boolean;
  satzzeichenEgal?: boolean;
}

/**
 * Wer gewinnt, wenn zwei Quellen dasselbe Feld verschieden füllen.
 *
 * Die Mindestkonfidenz steht **nicht** hier: Sie kommt aus den Einstellungen
 * des Mandanten. Wer sie am Workflow senken dürfte, könnte sich eine
 * automatische Entscheidung bestellen, die im Prüflauf noch ein Konflikt war.
 */
export interface Entscheidungsregeln {
  /** Die allgemeine Quellenreihenfolge, beste zuerst. */
  quellen?: string[];
  /** Für einzelne Felder eine eigene Reihenfolge. */
  jeFeld?: Record<string, string[]>;
  /** Ob bei Gleichstand das neuere Änderungsdatum entscheiden darf. */
  aktualitaet?: boolean;
  vergleich?: Wertvergleich;
}

/** Fehlende Werte aus vergleichbaren Datensätzen ergänzen. */
export interface Ergaenzungsregel {
  /** Woran sich „vergleichbar" bemisst. */
  vergleichbarAn: string[];
  /** Welche Felder ergänzt werden dürfen. */
  felder: string[];
  /** Wie viele vergleichbare Datensätze den Wert mindestens tragen müssen. */
  mindestens?: number;
}

/** Ähnliche, aber nicht gleiche Datensätze suchen — sie werden zu Fragen. */
export interface Aehnlichkeitsregeln {
  felder: string[];
  /** Ab wann zwei Datensätze als verdächtig gelten (0 bis 1). */
  schwelle?: number;
  /** Ab wie vielen Datensätzen abgebrochen wird, statt lange zu rechnen. */
  hoechstens?: number;
}

/** Was geschieht, wenn eine Zusatzquelle mehr als einen passenden Satz hat. */
export type Mehrfachtrefferregel =
  | { regel: 'KONFLIKT' }
  | { regel: 'ALLE' }
  | { regel: 'FELD'; feld: string; nimm: 'GROESSTER' | 'KLEINSTER' };

/**
 * Der Verweis eines Durchgangs auf eine verwaltete Referenzquelle (SPEC-04 §6).
 *
 * Die Regel gehört zum Durchgang und nicht zur Quelle: Dieselbe Kundenliste
 * wird im einen Workflow über die Kundennummer nachgeschlagen und im anderen
 * über die Postleitzahl.
 */
export interface Referenzverweis {
  quelleId: string;
  /** Die Felder des Datensatzes, mit denen nachgeschlagen wird. */
  felder: string[];
  /** Wie dieselben Felder in der Referenz heißen; ohne Angabe gleich. */
  referenzfelder?: string[];
  /** Was übernommen wird: Zielfeld ← Referenzfeld. Leer heißt: nur prüfen. */
  uebernehmen?: { feld: string; aus: string }[];
  ohneTreffer?: 'WARNUNG' | 'KONFLIKT' | 'IGNORIEREN';
}

export interface Konsolidierungsregeln {
  betriebsart: Betriebsart;
  art: Konsolidierungsart;
  /** Beim Anreichern: der Dateiname der führenden Quelle. */
  fuehrend?: string;
  schluessel?: { felder: string[] };
  ohneHauptsatz?: OhneHauptsatz;
  dubletten?: { auswahl: Dublettenauswahl; verbleib: Dublettenverbleib };
  entscheidung?: Entscheidungsregeln;
  ergaenzung?: Ergaenzungsregel;
  aehnlichkeit?: Aehnlichkeitsregeln;
  mehrfachtreffer?: Mehrfachtrefferregel;
  /** Verwaltete Referenzquellen, gegen die abgeglichen wird (SPEC-04 §6, §8). */
  referenzen?: Referenzverweis[];
}

/**
 * Was mit einem einzelnen Wert geschieht (SPEC-09, Abschnitt 8).
 *
 * `ERSETZEN` sucht **wörtlich**, nicht als Muster: Wer „." eingibt, meint einen
 * Punkt, und niemand rechnet damit, dass sein Ersetzen jedes Zeichen trifft.
 */
export type Umformungsschritt =
  | { art: 'TRIMMEN' }
  | { art: 'GROSS' }
  | { art: 'KLEIN' }
  /** Namenspartikel bleiben klein; eine leere Liste macht jedes Wort groß. */
  | { art: 'ANFANGSGROSS'; partikel?: string[] }
  | { art: 'ERSETZEN'; suchen: string; ersetzen: string }
  | { art: 'VORANSTELLEN'; text: string }
  | { art: 'ANHAENGEN'; text: string }
  | { art: 'AUSSCHNITT'; von: number; bis?: number }
  | {
      art: 'DATUM';
      gelesenAls: 'DAY_FIRST' | 'MONTH_FIRST' | 'YEAR_FIRST';
      schreibeAls: 'ISO' | 'TAG_ZUERST' | 'MONAT_ZUERST';
      jahrhundertGrenze?: number;
    }
  | { art: 'ZAHL'; gelesenAls: string; schreibeAls: string; nachkommastellen?: number };

export type Trennung =
  | { art: 'ZEICHEN'; zeichen: string }
  | { art: 'STELLEN'; stellen: number[] };

/**
 * Was mit mehr Teilen geschieht, als es Zielfelder gibt.
 *
 * Es gibt bewusst **kein** stillschweigendes Abschneiden: „Bei Transformationen
 * dürfen keine Quellinformationen unbeabsichtigt verloren gehen", und ein
 * abgeschnittener Namensteil sieht im Ergebnis aus wie ein Name.
 */
export type Ueberschuss = 'AN_LETZTES' | 'PRUEFFALL';

export interface Aufteilung {
  quelle: string;
  ziele: string[];
  trennung: Trennung;
  ueberschuss?: Ueberschuss;
  schritte?: Umformungsschritt[];
}

export interface Zusammenfuehrung {
  ziel: string;
  quellen: string[];
  trenner: string;
  schritte?: Umformungsschritt[];
}

/** Die Reihenfolge steht fest: putzen, aufteilen, zusammenführen. */
export interface Umformungsplan {
  felder?: { feld: string; schritte: Umformungsschritt[] }[];
  aufteilungen?: Aufteilung[];
  zusammenfuehrungen?: Zusammenfuehrung[];
}

/**
 * Was die eingestellten Umformungen mit einer echten Datei tun (SPEC-09 §11).
 *
 * Der Server liest die Datei mit **demselben** Leser und formt sie mit
 * **derselben** Maschine wie der nächtliche Lauf. Eine Vorschau, die anders
 * rechnet als der Lauf, führt genau die Entscheidungen herbei, die sie
 * verhindern soll.
 */
export interface Feldvorschau {
  feld: string;
  neu: boolean;
  veraendert: boolean;
}

export interface Zeilenvorschau {
  zeile: number;
  vorher: Record<string, string>;
  nachher: Record<string, string>;
  geaendert: string[];
}

export interface Umformungspruefall {
  quelle: string;
  zeile: number;
  feld: string;
  wert: string;
  hinweis: string;
}

export interface Umformungsvorschau {
  datei: string;
  datensaetze: number;
  gezeigt: number;
  felder: Feldvorschau[];
  zeilen: Zeilenvorschau[];
  /** Was verloren ginge — der eigentliche Grund für die Vorschau. */
  pruefaelle: Umformungspruefall[];
  hinweise: string[];
}

/**
 * Welchem internen Feld eine Spalte entspricht (SPEC-09 §11).
 *
 * Die andere Frage an dieselbe Datei: Die Umformungsvorschau zeigt, was mit den
 * **Werten** geschieht — diese hier, ob „Kd-Nr.", „KdNr" und „Kundennummer"
 * dasselbe meinen.
 */
export interface Zuordnungsvorschau {
  datei: string;
  datensaetze: number;
  spalten: Spaltenvorschau[];
  /** Die Zahlen, auf die ein Mensch zuerst sieht. */
  uebernommen: number;
  vorgeschlagen: number;
  offen: number;
  /** Die internen Felder zur Auswahl — damit niemand eine Kennung tippen muss. */
  felder: { intern: string; label: string; typen: string[] }[];
  hinweise: string[];
}

/**
 * Eine Ausleitung des Konfliktbestands (SPEC-01 §23; SPEC-07, Dateimodell).
 *
 * Sie ist eine Abschrift und führt den Bestand nicht — deshalb darf sie nach
 * Ablauf der Frist fortgeräumt werden, ohne dass etwas verloren geht.
 */
export interface Ausleitung {
  id: string;
  tenantId: string;
  art: 'KONFLIKTE' | 'ZIEL';
  laufId?: string;
  pfad: string;
  name: string;
  faelle: number;
  erstellt: string;
  erstelltVonName?: string;
  /** Wann die Datei fortgeräumt wurde; der Eintrag bleibt. */
  entferntAm?: string;
}

/**
 * Eine verwaltete Referenzquelle (SPEC-04 §6, §8).
 *
 * Hier steht der Verweis und nicht die Datenmenge: Die Datei bleibt, wo sie
 * ist, und wird zum Lauf gelesen.
 */
export interface Referenzquelle {
  id: string;
  tenantId: string;
  name: string;
  beschreibung?: string;
  verzeichnis: string;
  datei?: string;
  /** Leer heißt: das Änderungsdatum der Datei. */
  version?: string;
  gesehen?: {
    datei: string;
    felder: string[];
    zeilen: number;
    geaendert?: string;
    geprueft: string;
    hinweise?: string[];
  };
  angelegt: string;
  angelegtVonName?: string;
}

export type Zuordnungssicherheit = 'EINDEUTIG' | 'VORSCHLAG' | 'MEHRDEUTIG';

export interface Spaltenvorschau {
  /** Wie die Spalte in der Quelle heißt. */
  spalte: string;
  /** Das interne Feld — fehlt, wenn nichts zuzuordnen war. */
  intern?: string;
  label?: string;
  sicherheit: Zuordnungssicherheit;
  konfidenz: number;
  /** Warum — in Sätzen, die ein Mensch prüfen kann. */
  gruende: string[];
  /** Bei Mehrdeutigkeit: was sonst noch in Frage kam. */
  kandidaten?: { intern: string; label: string }[];
  /** Ob dahinter eine bestätigte Regel steht — dann ist es keine Vermutung. */
  ausRegel?: string;
  istRegel: boolean;
  typ: string;
  beispiele: string[];
  leer: number;
}

/**
 * Ein weiterer Durchgang der Konsolidierung (SPEC-06 §7).
 *
 * Erst die Filialdateien zusammenlegen, dann das Ergebnis anreichern. Jeder
 * Durchgang sagt für sich, wo er liest und wo er schreibt.
 */
export interface Konsolidierungsdurchgang {
  name?: string;
  input: StageInput;
  output?: StageOutput;
  regeln?: Konsolidierungsregeln;
  dateien?: Dateiwahl;
  umformung?: Umformungsplan;
}

/**
 * Ein erwarteter Beteiligter eines Stapels (SPEC-06 §2).
 *
 * Der Name steht in jeder Meldung: „es fehlt ‚Filiale Süd'" beantwortet die
 * Frage, die um sieben Uhr morgens gestellt wird — „2 von 3" nicht.
 */
export interface Platz {
  name: string;
  muster: string;
}

/** Woran eine bestimmte Datei eines Stapels zu erkennen ist (SPEC-06 §2). */
export interface Dateikennung {
  /**
   * `NAME`: der Dateiname mit `*`. `MERKMAL`: ein Teil, der darin vorkommt.
   * `DATEI`: eine im Verzeichnis ausgesuchte Datei.
   */
  art: 'NAME' | 'MERKMAL' | 'DATEI';
  wert: string;
}

export interface Stapelbedingung {
  /** Woran Primär- und Sekundär-Datei zu erkennen sind — am Namen oder an einem Teil davon. */
  primaer?: Dateikennung;
  /** Die weiteren Dateien des Stapels — so viele, wie eingetragen sind. */
  sekundaer?: Dateikennung[];
  plaetze: Platz[];
  /** Wie viele Dateien insgesamt; ohne Angabe die Zahl der Plätze. */
  anzahl?: number;
  /** Wartezeit ab der **ersten** Datei; ohne Angabe wird unbegrenzt gewartet. */
  fristSekunden?: number;
}

/** Wohin die Eingangsdateien nach dem Durchgang wandern. */
export interface Abholung {
  /** Wohin die verschlüsselte Kopie der Eingangsdateien geht. */
  archiv?: string;
  arbeit?: string;
  erledigt?: string;
  gescheitert?: string;
}

export interface Dateiwahl {
  /** Welche Dateitypen mitkommen; ohne Angabe alle lesbaren. */
  endungen?: string[];
  muster?: string;
  blatt?: { name: string } | { position: number };
  stapel?: Stapelbedingung;
  /** Wie lange eine Datei unverändert liegen muss, bevor sie als fertig gilt. */
  reifeSekunden?: number;
  abholung?: Abholung;
}

export type Ergebnisformat = 'CSV' | 'FESTBREITEN';

/** Ein Feld fester Breite in der Ausgabe (SPEC-03 §6). */
export interface Festbreitenfeld {
  name: string;
  /** Erste Stelle, ab 1 gezählt. */
  start: number;
  laenge: number;
  ausrichtung?: 'LINKS' | 'RECHTS';
  fuellzeichen?: string;
  /** Ob ein zu langer Wert gekürzt werden darf. Ohne Angabe nicht. */
  kuerzen?: boolean;
}

/**
 * Prüfung der Eingangsdateien vor der Verarbeitung (SPEC-03 §7, SPEC-08 §2).
 *
 * `profil` verweist auf ein Schema des Mandanten; `datei` ist die alte
 * JSON-Schema-Datei. Es steht genau eines da.
 */
export interface Schemapruefungsregel {
  /** Die Kennung des Eingangsprofils, gegen das geprüft wird. */
  profil?: string;
  datei?: string;
  /** Ohne Angabe wird eine verletzende Datei nicht verarbeitet. */
  bei?: 'WARNEN' | 'ABBRECHEN';
}

export interface KonsolidierungConfig extends StageConfig {
  name?: string;
  schema?: Schemapruefungsregel;
  /** Wie die Ergebnisdatei geschrieben wird; ohne Angabe als CSV. */
  format?: Ergebnisformat;
  festbreiten?: { felder: Festbreitenfeld[]; kopfzeile?: boolean };
  regeln?: Konsolidierungsregeln;
  dateien?: Dateiwahl;
  /** Was nach diesem Durchgang noch läuft (SPEC-06 §7). */
  weitere?: Konsolidierungsdurchgang[];
  /** Was vor dem Konsolidieren mit den Feldern geschieht (SPEC-09 §8, §9). */
  umformung?: Umformungsplan;
}

/** Die Glieder, aus denen ein Workflow gebaut wird — Namen, keine Nummern. */
export type StageId = 'TRANSFER' | 'CONSOLIDATE' | 'DELIVER';

export interface Job {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;

  sourceType: SourceType;
  sourceConfig: SourceConfig;
  sourceDirectory: string;
  credentialId?: string;
  /**
   * Was die Quelle liefert — das Gegenstück zu `encryptionConfig`, das
   * beschreibt, was ins Ziel geht. Zwei Einstellungen, weil es zwei Schlüssel
   * sind: der des Absenders öffnet, der eigene verschließt.
   */
  sourceEncryption?: {
    enabled: boolean;
    keyCredentialId?: string;
    /** Ohne dies wird eine unverschlüsselte Datei abgelehnt. */
    acceptPlaintext?: boolean;
  };

  filenamePrefix?: string;
  allowedExtensions: string[];
  ignoredTemporaryExtensions: string[];
  minimumFileAgeSeconds: number;
  stabilityCheck: {
    enabled: boolean;
    intervalSeconds: number;
    requiredStableChecks: number;
    compareSize: boolean;
    compareLastModified: boolean;
  };

  destinationDirectory: string;
  createDestinationDirectory: boolean;
  /** Wohin geschrieben wird; fehlt heißt Dateisystem. */
  destinationType?: SourceType;
  /**
   * Verbindungsangaben des Ziels — nur für SFTP und FTPS. Eine Freigabe braucht
   * keine: Sie hat einen Pfad und womöglich einen Zugang, aber keinen Port und
   * keinen Hostkey.
   */
  destinationConfig?: SourceConfig;
  destinationCredentialId?: string;
  conflictStrategy: 'SKIP' | 'OVERWRITE' | 'RENAME' | 'NEW_NAME';
  /** Der Name für NEW_NAME — ohne Endung, die bringt die Datei mit. */
  conflictFilename?: string;
  /** Schreibweise des Zeitstempels; fehlt heißt Tag zuerst. */
  timestampNotation?: 'DAY_FIRST' | 'MONTH_FIRST';
  encryptionConfig: {
    enabled: boolean;
    provider: 'NONE' | 'AES_256_GCM';
    keyCredentialId?: string;
    /** Schon beim Abholen verschlüsseln — unabhängig davon, was im Ziel liegt. */
    onPickup?: boolean;
  };
  sourceSuccessAction: 'KEEP' | 'MOVE' | 'DELETE';
  sourceArchiveDirectory?: string;

  maxConcurrentFiles?: number;
  detectContentDuplicates?: boolean;
  /**
   * Wie ausführlich dieser Workflow protokolliert; fehlt heißt jeder Schritt.
   *
   * Ohne `INFO`: „Das Wesentliche" stand einmal dafür und ist gestrichen — die
   * Angabe sagt nichts aus. Als Stufe einer *Zeile* gibt es `INFO` weiter, nur
   * nicht mehr als Schwelle eines Workflows.
   */
  logLevel?: 'DEBUG' | 'WARNING' | 'ERROR';
  retention?: { logDays?: number; historyDays?: number };

  /** Daten übertragen; fehlt heißt: läuft. So verhielt sich jeder Job bisher. */
  transfer?: { enabled: boolean };
  /** Daten konsolidieren. */
  consolidation?: KonsolidierungConfig;
  /** Daten exportieren/importieren — ein Glied mit einer Verzweigung. */
  delivery?: DeliverConfig;

  executionMode: 'MANUAL' | 'AUTOMATIC' | 'MANUAL_AND_AUTOMATIC';
  schedule?: Schedule;
  nextExecutionAt?: string;
  lastExecutionAt?: string;
  createdAt?: string;
  updatedAt?: string;

  /** Filled by the list: modules this job needs but the licence lacks. */
  missingFeatures?: Feature[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  filesFound?: number;
  /** Was auf dem Weg geschah — Auflösen, Verbinden, Hostkey, Anmelden, Lesen. */
  steps?: string[];
}

/** Ein Verzeichnis auf dem entfernten Server, wie der Server es nennt. */
export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  /** Ohne das Remote-Arbeitsverzeichnis — so, wie es ins Eingabefeld gehört. */
  relativePath: string;
}

export interface RemoteDirectoryResult {
  ok: boolean;
  message: string;
  path?: string;
  relativePath?: string;
  parentPath?: string;
  entries: RemoteDirectoryEntry[];
  filesFound?: number;
  /** Orte, an denen dieser Mandant schon arbeitet — im Fenster obenan. */
  known?: RemoteDirectoryEntry[];
  /** Mehrere Lesarten der Eingabe gibt es wirklich — dann wird nicht geraten. */
  ambiguous?: string[];
  /** Alle geprüften Lesarten, in der Reihenfolge der Prüfung. */
  tried?: string[];
  /** Die Dateien des Verzeichnisses — für Felder, in denen eine Datei gewählt wird. */
  files?: RemoteDirectoryEntry[];
}

export interface DirectoryCheckResult {
  ok: boolean;
  message: string;
  exists: boolean;
  writable: boolean;
  wouldBeCreated?: boolean;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export interface RunSummary {
  runId: string;
  jobId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  filesFound: number;
  filesProcessed: number;
  filesSucceeded: number;
  filesSkipped: number;
  filesFailed: number;
}

export type FileStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'SKIPPED' | 'FAILED';

export interface TransferFile {
  id: string;
  transferRunId: string;
  jobId: string;
  sourcePath: string;
  sourceFilename: string;
  sourceSize?: number;
  destinationFilename?: string;
  destinationSize?: number;
  sha256?: string;
  status: FileStatus;
  resolution?: 'TRANSFERRED' | 'DUPLICATE';
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  jobId?: string;
  runId?: string;
  filename?: string;
  /** Wer die Handlung veranlasst hat; fehlt bei allem, was der Zeitplan tut. */
  userId?: string;
  /** Sein Anmeldename zum Zeitpunkt der Handlung — nicht der heutige. */
  username?: string;
  /** Stelle im Protokoll. Die Leitwarte holt damit nur, was neu ist. */
  sequence?: number;
}

export type RunControlState = 'RUNNING' | 'PAUSED' | 'CANCELLED';

/** Ein Lauf, der gerade in Arbeit ist — die Zeilen der Leitwarte. */
export interface ActiveRun {
  runId: string;
  jobId: string;
  jobName: string;
  tenantId: string;
  startedAt: string;
  state: RunControlState;
}

export interface RunDetail extends RunSummary {
  jobName?: string;
  files: TransferFile[];
  logs: LogEntry[];
}

export interface Dashboard {
  activeJobs: number;
  runsToday: number;
  filesTransferredToday: number;
  filesFailedToday: number;
  runningJobs: string[];
  nextExecutions: { jobId: string; jobName: string; nextExecutionAt: string }[];
}

export interface Credential {
  id: string;
  tenantId?: string;
  name: string;
  type: 'USERNAME_PASSWORD' | 'SSH_PRIVATE_KEY' | 'ENCRYPTION_KEY';
  username?: string;
  /** Die Windows-Freigabe, für die dieser Zugang gilt. */
  freigabe?: string;
}

/** Woher eine Aussage über die Struktur stammt (FR_008). */
export type Herkunft = 'OBSERVED' | 'CONFIGURED' | 'INFERRED' | 'AI_SUGGESTED' | 'CONFIRMED';

export type Erkennungsmodus = 'AUTOMATIK' | 'EINSTELLUNGEN' | 'BEIDE';

export interface DiscoveredColumn {
  name?: string;
  type: string;
  confidence: number;
  herkunft: Herkunft;
}

export interface DataBlock {
  start: number;
  end: number;
  headerLine?: number;
  strategy: string;
  /** Bei einer E-Mail: aus welchem Teil dieser Block stammt. */
  source?: string;
  columns: DiscoveredColumn[];
  rows: string[][];
  confidence: number;
  reasons: string[];
}

export interface KnownStructure {
  id: string;
  name: string;
  /** Die Version, gegen die verglichen wurde — immer die aktuelle. */
  version: number;
  score: number;
  abweichungen: number;
}

/** Die drei Ebenen der Konfigurationshierarchie (SPEC-02, Abschnitt 40). */
export type Ebene = 'ALLGEMEIN' | 'PROFIL' | 'MANDANT';

export interface WirksameEinstellungen {
  locale: string;
  timeZone: string;
  jahrhundertGrenze: number;
  nullWerte: string[];
  stichprobe: number;
  stichprobeGrenze: number;
  mindestKonfidenz: number;
}

/**
 * Womit ein Lauf gelesen hat (SPEC-01, Abschnitt 10).
 *
 * Die Werte stehen darin und nicht als Verweis: Wer am Mandanten die Region
 * ändert, ändert sonst rückwirkend die Lesart jedes vergangenen Laufs.
 */
export interface Snapshot {
  id: string;
  profileId?: string;
  profileName?: string;
  profileVersion?: number;
  einstellungen: WirksameEinstellungen;
  herkunft: Record<keyof WirksameEinstellungen, Ebene>;
}

export interface EffektiveEinstellung {
  name: string;
  label: string;
  wert: unknown;
  ebene: Ebene;
  ebenen: { ebene: Ebene; wert: unknown }[];
}

export interface Profilversion {
  version: number;
  erstellt: string;
  erstelltVonName?: string;
  notiz?: string;
  einstellungen: Record<string, unknown>;
  spalten: number;
}

/** Wie verbindlich eine hinterlegte Angabe ist (FR_008, Abschnitt 4). */
export type Verbindlichkeit = 'HINWEIS' | 'EINSCHRAENKUNG' | 'VORGABE';

export type Feldtyp =
  | 'STRING'
  | 'INTEGER'
  | 'DECIMAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'TIME'
  | 'DATETIME'
  | 'BINARY'
  | 'NULL';

export interface Spaltenvorgabe {
  /** Die Stelle, ab 1 — so, wie ein Mensch sie zählt. */
  position: number;
  name?: string;
  type?: Feldtyp;
}

export interface Strukturvorgabe {
  verbindlichkeit: Verbindlichkeit;
  columns?: number;
  minColumns?: number;
  spalten?: Spaltenvorgabe[];
  /** Der Datenblock beginnt nach einer Zeile, die diesen Text enthält. */
  beginntNach?: string;
}

/**
 * Was ein Wert erfüllen muss.
 *
 * Das, was früher in einer JSON-Schema-Datei stand — `required`, `pattern`,
 * `minimum`, `enum` —, nur benannt statt kodiert. `NICHT_ZUKUNFT` gibt es
 * dazu; ein JSON Schema kann es nicht.
 */
export type Pruefung =
  | { art: 'PFLICHT' }
  | { art: 'FORMAT'; muster: string; beschreibung: string }
  | { art: 'BEREICH'; min?: number; max?: number }
  | { art: 'NICHT_ZUKUNFT' }
  | { art: 'AUS_LISTE'; werte: string[] };

export interface Qualitaetsregel {
  id: string;
  /** Wie sie einem Menschen gegenüber heißt. */
  name: string;
  feld: string;
  pruefung: Pruefung;
  schwere: Schwere;
  /** `WENN Zahlungsart = Lastschrift DANN …` — ohne sie gilt die Regel immer. */
  wenn?: { feld: string; ist: string };
  erklaerung?: string;
}

/** Wie zwei Werte verglichen werden, bevor sie als gleich gelten. */
export interface Vergleich {
  grossKleinEgal?: boolean;
  leerzeichenEgal?: boolean;
  umlauteEgal?: boolean;
  satzzeichenEgal?: boolean;
}

export interface Schluessel {
  /** Die Felder, aus denen er gebildet wird — die Reihenfolge zählt. */
  felder: string[];
  /** Wo eine Quelle die Felder anders nennt: Quelle → Feldnamen, gleiche Reihenfolge. */
  jeQuelle?: Record<string, string[]>;
  vergleich?: Vergleich;
}

/** Ein Eingangsprofil (SPEC-02, Abschnitt 3) mit seiner Versionskette. */
export interface Eingangsprofil {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  version: number;
  columns?: { position: number; name?: string; type?: string }[];
  verbindlichkeit: string;
  /** Die ganze Struktur — `columns` und `verbindlichkeit` darüber sind ihr Auszug. */
  vorgabe: Strukturvorgabe;
  regeln?: Qualitaetsregel[];
  schluessel?: Schluessel;
  einstellungen: Record<string, unknown>;
  versionen: Profilversion[];
  confirmedByName?: string;
  matches: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryAnswer {
  region: { locale: string; timeZone: string };
  /** Nur bei einer E-Mail: was in ihrem Kopf stand. */
  message?: { from?: string; subject?: string; date?: string; attachments: string[] };
  knownStructures: KnownStructure[];
  /** Welches Eingangsprofil die Analyse benutzt hat, falls eines passte. */
  usedStructure?: string;
  /** Womit gelesen wurde — Profil, Version und die geltenden Einstellungen. */
  snapshot: Snapshot;
  blocks: DataBlock[];
  ignoredLines: number[];
  notes: string[];
  chosen?: {
    start: number;
    end: number;
    columns: DiscoveredColumn[];
    configurationMatch: number;
    patternMatch: number;
    overallConfidence: number;
    abweichungen: { position: number; name?: string; hinterlegt: string; erkannt: string }[];
  };
}

/* ---------- Auskunft, Löschauftrag und Auskunftsseite (FR_009) ---------- */

export type Behandlung = 'LOESCHEN' | 'SCHWAERZEN' | 'ANZEIGEN';

export interface Fund {
  wo: string;
  auszug: string;
  wann?: string;
}

export interface Bestandsauskunft {
  key: string;
  name: string;
  treffer: number;
  behandlung: Behandlung;
  funde: Fund[];
  hinweis?: string;
}

export interface Auskunft {
  begriff: string;
  tenantId?: string;
  bestaende: Bestandsauskunft[];
  treffer: number;
  /** Wo Unikom von sich aus nichts tun wird. */
  nurAnzeige: string[];
}

export interface Loeschbericht {
  begriff: string;
  tenantId?: string;
  entfernt: { key: string; name: string; behandlung: Behandlung; stellen: number }[];
  offen: Bestandsauskunft[];
  zeitpunkt: string;
  veranlasser?: string;
  /** Der Beleg, der im selben Zug entstanden ist — eine spätere Suche fände nichts mehr. */
  beleg: { filename: string; text: string };
}

/** Ein Bestand, wie er auf der Auskunftsseite steht — ohne die Suchfunktionen. */
export interface Bestandsangabe {
  key: string;
  name: string;
  inhalt: string;
  ort: 'DATENBANK' | 'DATEISYSTEM';
  personenbezug: 'JA' | 'MITTELBAR' | 'NEIN';
  aufbewahrung: string;
  behandlung: Behandlung;
  mandantenweise: boolean;
}

export interface Frist {
  was: string;
  wert: string;
  voreingestellt: boolean;
  hinweis?: string;
}

export interface Mandantsfristen {
  tenantId: string;
  name: string;
  fristen: Frist[];
  workflows: { jobId: string; name: string; enabled: boolean; fristen: Frist[] }[];
}

export interface PrivacyReport {
  bestaende: Bestandsangabe[];
  mandanten: { id: string; name: string; rootDirectory?: string }[];
  fristen: Mandantsfristen[];
  zusagen: string[];
}

/* ---------- Mappings (SPEC-02, Abschnitt 15 bis 19) ---------- */

export interface Mappingregel {
  id: string;
  art: 'WERT' | 'FELD';
  ebene: Ebene;
  tenantId?: string;
  profileId?: string;
  feld?: string;
  von: string;
  nach: string;
  herkunft: 'AUSGELIEFERT' | 'BENUTZER' | 'GELERNT';
  bestaetigt: boolean;
  bestaetigungen: number;
  anwendungen: number;
  /** Einmal beobachtet, noch keine Regel — wirkt nicht. */
  vorlaeufig: boolean;
  /** Ob sie gerade wirkt — die Frage, die ein Mensch als erste stellt. */
  wirkt: boolean;
  erstellt: string;
  erstelltVonName?: string;
  zurueckgenommen?: string;
}

export interface Mappingliste {
  regeln: Mappingregel[];
  /** Die ausgelieferte Bezeichnungsliste, für die Auswahl der internen Felder. */
  felder: { intern: string; label: string; typen: string[] }[];
}

/** Die Vorschau vor der Anwendung (SPEC-09, Abschnitt 11). */
export interface Mappingvorschau {
  tenantId: string;
  profilId?: string;
  zuordnungen: {
    spalte: string;
    intern?: string;
    label?: string;
    sicherheit: 'EINDEUTIG' | 'VORSCHLAG' | 'MEHRDEUTIG';
    konfidenz: number;
    gruende: string[];
    kandidaten?: { intern: string; label: string }[];
    ausRegel?: string;
    istRegel: boolean;
  }[];
  uebernommen: number;
  vorgeschlagen: number;
  offen: number;
}

/* ---------- Qualität (SPEC-04 §2, §4, §5; SPEC-08 §5 bis §9) ---------- */

export type Schwere = 'INFO' | 'WARNUNG' | 'KONFLIKT' | 'FEHLER';

export interface Befund {
  /** Die Zeile, ab 1. Null heißt: eine Feststellung über den Bestand als Ganzes. */
  zeile: number;
  feld?: string;
  schwere: Schwere;
  /** Was ist. */
  ursache: string;
  /** Was daraus folgt. */
  auswirkung: string;
  wert?: string;
  regel?: string;
}

export interface Qualitaetsbericht {
  felder: string[];
  zeilen: string[][];
  typen: Record<string, string | undefined>;
  aenderungen: { zeile: number; feld: string; vorher: string; nachher: string; schritte: string[] }[];
  befunde: Befund[];
  /** Zeilen, die als Prüffall an einen Menschen gehen. */
  pruefzeilen: number[];
  /** Ob die Verarbeitung anhalten muss. */
  blockiert: boolean;
  zusammenfassung: Record<Schwere, number>;
}

/* ---------- Konsolidierung mehrerer Quellen (Etappe 5) ---------- */

export type Betriebsart = 'ANREICHERN' | 'SAMMELN';
export type Konsolidierungsart = 'APPEND' | 'MERGE';
export type Dublettenauswahl =
  | 'ERSTER'
  | 'LETZTER'
  | 'PRIORITAET'
  | 'ZUSAMMENFUEHREN'
  | 'ALLE_BEHALTEN'
  | 'ENTSCHEIDEN';
export type Dublettenverbleib = 'MITGEBEN' | 'SEPARAT' | 'VERWERFEN';
export type OhneHauptsatz = 'KONFLIKT' | 'UEBERNEHMEN' | 'UEBERSPRINGEN';
export type Mehrfachtreffer = 'KONFLIKT' | 'ALLE' | 'FELD';

export type Entscheidungsgrund =
  | 'KONFLIKTBEARBEITUNG'
  | 'EINIG'
  | 'EINZIGER_WERT'
  | 'BENUTZERREGEL'
  | 'FELDPRIORITAET'
  | 'QUELLENPRIORITAET'
  | 'AKTUALITAET'
  | 'MEHRHEIT';

export interface Feldergebnis {
  feld: string;
  wert: string;
  quelle: string;
  grund: Entscheidungsgrund;
  begruendung: string;
  konfidenz: number;
  uebergangen: { quelle: string; wert: string }[];
  pruefhinweis?: string;
}

/** Ein Konflikt, wie SPEC-06, Abschnitt 10, ihn verlangt — sieben Angaben. */
export interface Konsolidierungskonflikt {
  art: string;
  quelle?: string;
  blatt?: string;
  zeile?: number;
  feld?: string;
  schluessel?: string;
  erwartet: string;
  vorgefunden: string;
  ursache: string;
  naechsteSchritte: string;
}

export interface Konsolidierungsbericht {
  quellen: { id: string; name: string; blatt?: string; datensaetze: number; stand?: string }[];
  felder: string[];
  zeilen: {
    werte: string[];
    herkunft: { quelle: string; zeile: number }[];
    entscheidungen: Feldergebnis[];
    schluessel?: string;
  }[];
  konflikte: Konsolidierungskonflikt[];
  dubletten: {
    schluessel: string;
    anzahl: number;
    exakt: boolean;
    art: 'INNERHALB' | 'UEBERGREIFEND' | 'BEIDES';
    quellen: string[];
    behandlung: string;
  }[];
  zurueckgestellt: { quelle: string; zeile: number; verbleib: Dublettenverbleib; grund: string; werte: string[] }[];
  /** Ähnliche, aber nicht gleiche Datensätze — Fragen, keine Zusammenführungen. */
  verdacht: {
    wert: number;
    links: { quelle: string; zeile: number };
    rechts: { quelle: string; zeile: number };
    felder: { feld: string; links: string; rechts: string; wert: number }[];
  }[];
  ergaenzungen: { quelle: string; zeile: number; feld: string; wert: string; belege: number; begruendung: string }[];
  ergaenzungsluecken: { quelle: string; zeile: number; feld: string; begruendung: string; werte: string[] }[];
  referenzen: {
    bestand: string;
    version?: string;
    treffer: number;
    ohneTreffer: number;
    mehrdeutig: number;
    uebernahmen: number;
  }[];
  hinweise: string[];
  zusammenfassung: {
    quellen: number;
    gelesen: number;
    ergebnis: number;
    zusammengefuehrt: number;
    dubletten: number;
    konflikte: number;
    ergaenzt: number;
    verdacht: number;
  };
}

/* ---------- Konfliktbearbeitung (Etappe 6, SPEC-07) ---------- */

export type Kritikalitaet = 'INFORMATION' | 'WARNUNG' | 'KONFLIKT' | 'PRUEFFALL' | 'KRITISCH';

export type Konfliktstatus =
  | 'OFFEN'
  | 'ZURUECKGESTELLT'
  | 'BEREINIGT'
  | 'AKZEPTIERT'
  | 'ERNEUT_VERARBEITET'
  | 'ERFOLGREICH_VERARBEITET';

export type Entscheidungsart =
  | 'BEREINIGEN'
  | 'ZUSAMMENFUEHREN'
  | 'NICHT_ZUSAMMENFUEHREN'
  | 'AKZEPTIEREN'
  | 'ZURUECKSTELLEN'
  | 'WIEDERAUFNEHMEN';

export interface Streitfeld {
  feld: string;
  typ?: string;
  leerErlaubt?: boolean;
  angebote: { quelle: string; wert: string; metadaten?: Record<string, string> }[];
}

export interface Konfliktfall {
  id: string;
  tenantId: string;
  laufId: string;
  datensatz: string;
  art: string;
  kritikalitaet: Kritikalitaet;
  status: Konfliktstatus;
  ursache: string;
  regel?: string;
  erwartet: string;
  vorgefunden: string;
  naechsteSchritte: string;
  quellen: string[];
  felder: Streitfeld[];
  ergebnis?: Record<string, string>;
  entstanden: string;
  geaendert: string;
  entstandenAus?: string;
  sperre?: { benutzer: string; benutzerName?: string; seit: string };
  fassung: number;
}

export interface Bearbeitungsschritt {
  nummer: number;
  fallId: string;
  art: string;
  zeitpunkt: string;
  benutzer: string;
  benutzerName?: string;
  vonStatus?: Konfliktstatus;
  nachStatus?: Konfliktstatus;
  vorher?: Record<string, string>;
  nachher?: Record<string, string>;
  entscheidung?: string;
  regel?: string;
  vorgang?: string;
  bemerkung?: string;
}

/**
 * Was aus einer Freigabe geworden ist — der Rückweg (SPEC-07, Abschnitt 13).
 *
 * Die Freigabe **ist** der Lauf: Sie räumt nicht nur den Bestand auf, sondern
 * rechnet die ursprüngliche Lieferung noch einmal, diesmal mit den getroffenen
 * Entscheidungen.
 */
export interface Korrekturergebnis {
  gelungen: boolean;
  laufId: string;
  faelle: number;
  abgeschlossen: number;
  meldung: string;
  /** Die Konfliktzieldatei — der Nachweis, nicht der Weg. */
  zieldatei: { felder: string[]; zeilen: string[][] };
}

export interface Freigabestand {
  gesamt: number;
  bereinigt: number;
  offen: number;
  zurueckgestellt: number;
  akzeptiert: number;
  kritischOffen: number;
  erneutVerarbeitet: number;
  erfolgreich: number;
  freigabeMoeglich: boolean;
  hindernisse: { id: string; datensatz: string; kritikalitaet: Kritikalitaet; status: Konfliktstatus; ursache: string }[];
}

export interface Konfliktliste {
  faelle: Konfliktfall[];
  gruppen?: { name: string; anzahl: number; ids: string[] }[];
  einstieg: { gilt: true; fallId: string; position: number } | { gilt: false; grund: string };
  stand: Freigabestand;
}

export interface Konfliktansicht {
  fall: Konfliktfall;
  historie: Bearbeitungsschritt[];
  bearbeitbar: boolean;
  grund?: string;
}

export interface Anwendung {
  werte: Record<string, string>;
  herkunft: { feld: string; wert: string; quelle: string; begruendung: string }[];
  befunde: Befund[];
  zulaessig: boolean;
  status: Konfliktstatus;
  beschreibung: string;
}

export interface Massenvorschau {
  betroffen: { id: string; datensatz: string; zulaessig: boolean; werte: Record<string, string>; grund?: string }[];
  moeglich: number;
}

export interface Massenergebnis {
  vorgang: string;
  betroffen: number;
  uebernommen: string[];
  abgelehnt: { id: string; grund: string }[];
}

/* ---------- Ergebnis und Freigabe (Etappe 7, SPEC-08) ---------- */

export type Verarbeitungsstatus =
  | 'COMPLETED'
  | 'COMPLETED_WITH_WARNINGS'
  | 'COMPLETED_WITH_CONFLICTS'
  | 'WAITING_FOR_RELEASE'
  | 'FAILED';

export type Pruefart =
  | 'VOLLSTAENDIGKEIT'
  | 'ANZAHL'
  | 'DUPLIKATE'
  | 'PFLICHTWERTE'
  | 'DATENTYPEN'
  | 'ZIELSTRUKTUR'
  | 'REFERENZEN'
  | 'ABHAENGIGKEITEN'
  | 'ABWEICHUNG';

export interface Pruefbefund {
  art: Pruefart;
  schwere: Schwere;
  feld?: string;
  ursache: string;
  auswirkung: string;
  zahlen?: Record<string, number>;
  beispiele?: string[];
}

export interface Ergebnispruefung {
  befunde: Pruefbefund[];
  zahlen: { eingang: number; ergebnis: number; felder: number; zurueckgestellt: number; nichtVerarbeitet: number };
  zusammenfassung: Record<Schwere, number>;
  blockiert: boolean;
  sauber: boolean;
}

export interface Bedingungsstand {
  name: string;
  erfuellt: boolean;
  aussage: string;
}

export interface Freigabevermerk {
  zeitpunkt: string;
  art: 'AUTOMATISCH' | 'MANUELL';
  benutzer?: string;
  benutzerName?: string;
  bedingungen: Bedingungsstand[];
  pruefstand: Record<string, number>;
  begruendung?: string;
}

export interface Ergebnisstand {
  id: string;
  tenantId: string;
  laufId: string;
  ausLauf?: string;
  wiederhergestelltAus?: string;
  felder: string[];
  zeilen?: string[][];
  /** Nur in der Liste — dort fehlen die Zeilen. */
  datensaetze?: number;
  pruefung: Ergebnispruefung;
  status: Verarbeitungsstatus;
  freigabe?: Freigabevermerk;
  entstanden: string;
}

export interface Abschluss {
  stand: Ergebnisstand;
  urteil: {
    frei: boolean;
    status: Verarbeitungsstatus;
    bedingungen: Bedingungsstand[];
    hindernisse: string[];
    erklaerung: string;
  };
}

/* ---------- Hintergrundbetrieb (Etappe 8, SPEC-01 §15 und §19 bis §22) ---------- */

export type Meldestufe = 'INFORMATION' | 'AKTION_ERFORDERLICH' | 'KRITISCH';

export type Meldeanlass =
  | 'LAUF_ERFOLGREICH'
  | 'LAUF_FEHLER'
  | 'LAUF_ABGEBROCHEN'
  | 'KONFLIKTE_ENTSTANDEN'
  | 'FREIGABE_ERFORDERLICH';

export interface Benachrichtigung {
  id: string;
  tenantId: string;
  anlass: Meldeanlass;
  stufe: Meldestufe;
  titel: string;
  text: string;
  ziel?: { art: 'LAUF' | 'KONFLIKTE' | 'ERGEBNIS'; id: string };
  entstanden: string;
  gesehen?: string;
  bestaetigt?: string;
  bestaetigtVon?: string;
}

/** Die beiden Zahlen an der Glocke: was offen ist und was davon nicht warten kann. */
export interface Meldestand {
  offen: number;
  draengend: number;
}

export interface Kanaele {
  center: boolean;
  windows: boolean;
  popup: boolean;
  email: boolean;
  nachVorn: boolean;
}

export interface Meldungsantwort {
  meldungen: Benachrichtigung[];
  stand: Meldestand;
  /** Die verbindliche Zuordnung aus SPEC-01 §21 — sie kommt vom Server. */
  kanaele: Record<Meldestufe, Kanaele>;
}

export interface Prozessanzeige {
  schlag: { prozess: string; zuletzt: string; laufId?: string; host?: string; pid?: number; gestartet: string };
  lebt: boolean;
  seit: string;
}
