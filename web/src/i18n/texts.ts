import type { Language } from '../settings/preferences.js';

/**
 * Der Wortbestand der Oberfläche.
 *
 * Ein Eintrag je Text, drei Sprachen nebeneinander. Nebeneinander und nicht in
 * drei Dateien: So sieht man beim Ändern sofort, welche Übersetzung noch fehlt,
 * statt es erst zu merken, wenn jemand die Anwendung auf Spanisch öffnet.
 *
 * Der Schlüssel beschreibt den Ort, nicht den Inhalt (`nav.jobs`, nicht
 * `jobs`). Ein Schlüssel, der den deutschen Text wiederholt, wird falsch, sobald
 * der deutsche Text sich ändert.
 *
 * Deutsch ist die Ausgangssprache: Fehlt eine Übersetzung, erscheint der
 * deutsche Text. Lieber ein deutsches Wort in einer spanischen Oberfläche als
 * ein Schlüssel oder eine leere Stelle.
 */
export type Texts = Record<Language, string>;

/**
 * Die Sprachkennung, mit der Datum, Uhrzeit und Zahlen formatiert werden.
 *
 * Sie steht hier als Modulwert und nicht in einem Haken: Formatiert wird auch
 * aus gewöhnlichen Funktionen heraus, die keine Haken benutzen dürfen. Der
 * `LanguageProvider` hält den Wert nach — eine Stelle, die schreibt, viele, die
 * lesen.
 */
const LOCALES: Record<Language, string> = { de: 'de-DE', en: 'en-GB', es: 'es-ES' };

let activeLocale = LOCALES.de;

export function setActiveLanguage(language: Language): void {
  activeLocale = LOCALES[language];
}

export function locale(): string {
  return activeLocale;
}

export const TEXTS = {
  // ---- Hauptmenü ----
  'nav.dashboard': { de: 'Dashboard', en: 'Dashboard', es: 'Panel' },
  'nav.jobs': { de: 'Jobs', en: 'Jobs', es: 'Trabajos' },
  'nav.history': { de: 'Historie', en: 'History', es: 'Historial' },
  'nav.workflows': { de: 'Workflows', en: 'Workflows', es: 'Flujos' },
  'nav.consolidation': { de: 'Daten konsolidieren', en: 'Consolidate data', es: 'Consolidar datos' },
  'nav.schemata': { de: 'Schemata', en: 'Schemas', es: 'Esquemas' },
  'nav.archive': { de: 'Archiv', en: 'Archive', es: 'Archivo' },
  'nav.tenants': { de: 'Mandanten', en: 'Clients', es: 'Clientes' },
  'nav.users': { de: 'Benutzer', en: 'Users', es: 'Usuarios' },
  'nav.settings': { de: 'Einstellungen', en: 'Settings', es: 'Ajustes' },
  'nav.enquiry': { de: 'Datenauskunft', en: 'Data enquiry', es: 'Consulta de datos' },
  'nav.signOut': { de: 'Abmelden', en: 'Sign out', es: 'Cerrar sesión' },
  'nav.privacy': { de: 'Datenschutz', en: 'Privacy', es: 'Privacidad' },
  'nav.imprint': { de: 'Impressum', en: 'Legal notice', es: 'Aviso legal' },
  'nav.build': { de: 'Stand', en: 'Build', es: 'Versión' },

  // ---- Allgemeines ----
  'common.save': { de: 'Speichern', en: 'Save', es: 'Guardar' },
  'common.cancel': { de: 'Abbrechen', en: 'Cancel', es: 'Cancelar' },
  'common.saving': { de: 'Wird gespeichert …', en: 'Saving …', es: 'Guardando …' },
  'common.loading': { de: 'Wird geladen …', en: 'Loading …', es: 'Cargando …' },

  // ---- Einstellungen ----
  'settings.title': { de: 'Einstellungen', en: 'Settings', es: 'Ajustes' },
  'settings.appearance': { de: 'Erscheinungsbild', en: 'Appearance', es: 'Apariencia' },
  // Die Namen bleiben in jeder Sprache gleich: Sie sind Namen, keine Wörter.
  'settings.theme.autumn': { de: 'Autumn', en: 'Autumn', es: 'Autumn' },
  'settings.theme.spring': { de: 'Spring', en: 'Spring', es: 'Spring' },
  'settings.language': { de: 'Sprache', en: 'Language', es: 'Idioma' },
  'settings.language.de': { de: 'Deutsch', en: 'German', es: 'Alemán' },
  'settings.language.en': { de: 'Englisch', en: 'English', es: 'Inglés' },
  'settings.language.es': { de: 'Spanisch', en: 'Spanish', es: 'Español' },

  // ---- Gemeinsame Bausteine ----
  'piece.loading': { de: 'Wird geladen …', en: 'Loading …', es: 'Cargando …' },
  'piece.close': { de: 'Schließen', en: 'Close', es: 'Cerrar' },
  'piece.tone.info': { de: 'Hinweis', en: 'Note', es: 'Aviso' },
  'piece.tone.warn': { de: 'Warnung', en: 'Warning', es: 'Advertencia' },
  'piece.tone.error': { de: 'Fehler', en: 'Error', es: 'Error' },
  'run.PENDING': { de: 'Wartet', en: 'Waiting', es: 'En espera' },
  'run.RUNNING': { de: 'Läuft', en: 'Running', es: 'En curso' },
  // Kurz gehalten: Das Abzeichen steht in einer Tabellenzeile neben Zahlen und
  // bestimmt sonst die Breite seiner Spalte. „Erfolg" sagt dasselbe.
  'run.SUCCESS': { de: 'Erfolg', en: 'Success', es: 'Correcto' },
  'run.PARTIAL_SUCCESS': { de: 'Teilweise', en: 'Partial', es: 'Parcial' },
  'run.FAILED': { de: 'Fehlgeschlagen', en: 'Failed', es: 'Fallido' },
  'run.CANCELLED': { de: 'Abgebrochen', en: 'Cancelled', es: 'Cancelado' },

  // ---- Dashboard ----
  'dash.activeJobs': { de: 'Aktive Jobs', en: 'Active jobs', es: 'Trabajos activos' },
  'dash.runsToday': { de: 'Läufe heute', en: 'Runs today', es: 'Ejecuciones hoy' },
  'dash.filesTaken': { de: 'Dateien übernommen', en: 'Files taken over', es: 'Archivos recibidos' },
  'dash.filesFailed': { de: 'Dateien fehlgeschlagen', en: 'Files failed', es: 'Archivos fallidos' },
  'dash.loadFailed': {
    de: 'Die Kennzahlen konnten nicht geladen werden',
    en: 'The figures could not be loaded',
    es: 'No se pudieron cargar los indicadores',
  },
  'dash.running.one': { de: 'Gerade in Arbeit: 1 Lauf', en: 'In progress: 1 run', es: 'En curso: 1 ejecución' },
  'dash.running.many': { de: 'Gerade in Arbeit: {n} Läufe', en: 'In progress: {n} runs', es: 'En curso: {n} ejecuciones' },
  'dash.next': { de: 'Nächste Ausführungen', en: 'Next runs', es: 'Próximas ejecuciones' },
  'dash.none': {
    de: 'Kein Job ist zur Ausführung eingeplant.',
    en: 'No job is scheduled to run.',
    es: 'No hay ningún trabajo programado.',
  },
  'dash.job': { de: 'Job', en: 'Job', es: 'Trabajo' },
  'dash.nextRun': { de: 'Nächste Ausführung', en: 'Next run', es: 'Próxima ejecución' },

  // ---- Anmeldung ----
  'login.please': { de: 'Bitte anmelden', en: 'Please sign in', es: 'Inicie sesión' },
  'login.username': { de: 'Benutzer', en: 'User', es: 'Usuario' },
  'login.password': { de: 'Passwort', en: 'Password', es: 'Contraseña' },
  'login.submit': { de: 'Anmelden', en: 'Sign in', es: 'Entrar' },
  'login.working': { de: 'Anmelden …', en: 'Signing in …', es: 'Entrando …' },
  'login.failed': { de: 'Anmeldung fehlgeschlagen', en: 'Sign-in failed', es: 'Error al iniciar sesión' },
  'login.changePassword': { de: 'Passwort ändern', en: 'Change password', es: 'Cambiar contraseña' },
  'login.changed': {
    de: 'Das Passwort wurde geändert. Bitte melden Sie sich mit dem neuen Passwort an.',
    en: 'The password was changed. Please sign in with the new one.',
    es: 'La contraseña se ha cambiado. Inicie sesión con la nueva.',
  },

  // ---- Historie ----
  'history.noJobs': {
    de: 'Es ist noch kein Job angelegt, also gibt es auch keine Historie.',
    en: 'No job exists yet, so there is no history either.',
    es: 'Todavía no hay ningún trabajo, así que tampoco hay historial.',
  },
  'history.tenant': { de: 'Mandant', en: 'Client', es: 'Cliente' },
  'history.allTenants': { de: 'Alle Mandanten', en: 'All clients', es: 'Todos los clientes' },
  'history.subject': { de: 'Gegenstand', en: 'Subject', es: 'Asunto' },
  'history.allSubjects': { de: 'Alle Gegenstände', en: 'All subjects', es: 'Todos los asuntos' },
  'history.noSubject': {
    de: 'Für diesen Mandanten gibt es keinen Job.',
    en: 'There is no job for this client.',
    es: 'No hay ningún trabajo para este cliente.',
  },
  'history.needsSubject': {
    de: 'Fehlgeschlagene Dateien lassen sich nur für einen einzelnen Gegenstand auflisten.',
    en: 'Failed files can only be listed for a single subject.',
    es: 'Los archivos fallidos solo se pueden listar para un asunto concreto.',
  },
  'history.onlyFailures': {
    de: 'Nur fehlgeschlagene Dateien',
    en: 'Failed files only',
    es: 'Solo archivos fallidos',
  },
  'history.neverRan': {
    de: 'Dieser Job ist noch nie gelaufen.',
    en: 'This job has never run.',
    es: 'Este trabajo nunca se ha ejecutado.',
  },
  // Eine Spalte, zwei Angaben: der Zeitpunkt oben, die Dauer darunter.
  // Zwei Spalten mit Namen darin kosteten zweimal Innenabstand und teilten den
  // Platz. Untereinander in einer Zelle lesen sie sich als eine Angabe — der
  // Gegenstand gehört dem Mandanten, so wie die Dauer zum Beginn gehört.
  'history.who': { de: 'Mandant und Gegenstand', en: 'Client and subject', es: 'Cliente y asunto' },
  'history.began': { de: 'Beginn und Dauer', en: 'Start and duration', es: 'Inicio y duración' },
  'history.status': { de: 'Status', en: 'Status', es: 'Estado' },
  'history.found': { de: 'Gefunden', en: 'Found', es: 'Hallados' },
  'history.taken': { de: 'Übernommen', en: 'Taken', es: 'Recibidos' },
  'history.skipped': { de: 'Übersprungen', en: 'Skipped', es: 'Omitidos' },
  'history.failed': { de: 'Fehler', en: 'Failed', es: 'Fallidos' },

  /*
   * Die Zahl beim Überfahren im Klartext. Die Überschrift steht über der Spalte,
   * aber wer mit dem Blick in der Zeile ist, liest sie nicht noch einmal mit.
   */
  'history.found.each': { de: '{n}× gefunden', en: '{n}× found', es: '{n}× hallados' },
  'history.taken.each': { de: '{n}× übernommen', en: '{n}× taken', es: '{n}× recibidos' },
  'history.skipped.each': { de: '{n}× übersprungen', en: '{n}× skipped', es: '{n}× omitidos' },
  'history.failed.each': { de: '{n}× fehlgeschlagen', en: '{n}× failed', es: '{n}× fallidos' },
  'history.open': { de: 'Lauf öffnen', en: 'Open run', es: 'Abrir ejecución' },
  'history.noFailures': {
    de: 'Keine Datei dieses Jobs ist bisher fehlgeschlagen.',
    en: 'No file of this job has failed so far.',
    es: 'Ningún archivo de este trabajo ha fallado hasta ahora.',
  },
  'history.file': { de: 'Datei', en: 'File', es: 'Archivo' },
  'history.moment': { de: 'Zeitpunkt', en: 'Time', es: 'Momento' },
  'history.reason': { de: 'Grund', en: 'Reason', es: 'Motivo' },

  // ---- Ein einzelner Lauf ----
  'detail.back': { de: 'Zurück zur Historie', en: 'Back to history', es: 'Volver al historial' },
  'detail.duration': { de: 'Dauer', en: 'Duration', es: 'Duración' },
  'detail.found': { de: 'Gefunden', en: 'Found', es: 'Hallados' },
  'detail.taken': { de: 'Übernommen', en: 'Taken', es: 'Recibidos' },
  'detail.skipped': { de: 'Übersprungen', en: 'Skipped', es: 'Omitidos' },
  'detail.failed': { de: 'Fehlgeschlagen', en: 'Failed', es: 'Fallidos' },
  'detail.files': { de: 'Dateien', en: 'Files', es: 'Archivos' },
  'detail.noFiles': {
    de: 'Dieser Lauf hat keine Datei angefasst.',
    en: 'This run touched no file.',
    es: 'Esta ejecución no tocó ningún archivo.',
  },
  'detail.col.file': { de: 'Datei', en: 'File', es: 'Archivo' },
  'detail.col.status': { de: 'Status', en: 'Status', es: 'Estado' },
  'detail.col.size': { de: 'Größe', en: 'Size', es: 'Tamaño' },
  'detail.col.target': { de: 'Im Ziel als', en: 'At target as', es: 'En destino como' },
  'detail.col.note': { de: 'Hinweis', en: 'Note', es: 'Aviso' },
  'detail.duplicate': { de: 'Dublette', en: 'Duplicate', es: 'Duplicado' },
  'detail.log': { de: 'Protokoll', en: 'Log', es: 'Registro' },
  'detail.log.DEBUG': {
    de: 'Alles, auch verworfene Dateien',
    en: 'Everything, including discarded files',
    es: 'Todo, incluidos los archivos descartados',
  },
  'detail.log.INFO': { de: 'Normal', en: 'Normal', es: 'Normal' },
  'detail.log.WARNING': {
    de: 'Nur Warnungen und Konflikte',
    en: 'Warnings and conflicts only',
    es: 'Solo advertencias y conflictos',
  },
  'detail.log.ERROR': { de: 'Nur Konflikte', en: 'Conflicts only', es: 'Solo conflictos' },
  'detail.log.empty': {
    de: 'Auf dieser Stufe gibt es keine Einträge.',
    en: 'There are no entries at this level.',
    es: 'No hay entradas en este nivel.',
  },
  'detail.col.time': { de: 'Zeit', en: 'Time', es: 'Hora' },
  'detail.col.level': { de: 'Stufe', en: 'Level', es: 'Nivel' },
  'detail.col.message': { de: 'Meldung', en: 'Message', es: 'Mensaje' },

  // ---- Zustand einer einzelnen Datei ----
  'file.PENDING': { de: 'Wartet', en: 'Waiting', es: 'En espera' },
  'file.IN_PROGRESS': { de: 'Läuft', en: 'Running', es: 'En curso' },
  'file.SUCCESS': { de: 'Übernommen', en: 'Taken', es: 'Recibido' },
  'file.SKIPPED': { de: 'Übersprungen', en: 'Skipped', es: 'Omitido' },
  'file.FAILED': { de: 'Fehlgeschlagen', en: 'Failed', es: 'Fallido' },

  // ---- Passwort ändern ----
  'pw.title': { de: 'Passwort ändern', en: 'Change password', es: 'Cambiar contraseña' },
  'pw.user': { de: 'Benutzer', en: 'User', es: 'Usuario' },
  'pw.current': { de: 'Aktuelles Passwort', en: 'Current password', es: 'Contraseña actual' },
  'pw.new': { de: 'Neues Passwort', en: 'New password', es: 'Contraseña nueva' },
  'pw.repeat': { de: 'Wiederholen', en: 'Repeat', es: 'Repetir' },
  'pw.mismatch': {
    de: 'Die beiden Eingaben stimmen nicht überein.',
    en: 'The two entries do not match.',
    es: 'Las dos entradas no coinciden.',
  },
  'pw.tooShort': {
    de: 'Das neue Passwort ist zu kurz.',
    en: 'The new password is too short.',
    es: 'La contraseña nueva es demasiado corta.',
  },
  'pw.failed': {
    de: 'Das Passwort konnte nicht geändert werden',
    en: 'The password could not be changed',
    es: 'No se pudo cambiar la contraseña',
  },
} as const satisfies Record<string, Texts>;

export type TextKey = keyof typeof TEXTS;

export function textOf(key: TextKey, language: Language): string {
  const entry = TEXTS[key] as Texts;

  return entry[language] || entry.de;
}

/**
 * Setzt Werte in einen Text ein: `{n}` wird zu der Zahl, die gemeint ist.
 *
 * Der Platzhalter steht im Text und nicht davor oder dahinter, weil die Stelle
 * je Sprache eine andere ist — „4× gefunden", aber „4× hallados". Wer den Satz
 * aus zwei Stücken zusammensetzt, hat die Reihenfolge des Deutschen festgeschrieben.
 */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
