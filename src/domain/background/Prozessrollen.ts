/**
 * Wer in Unikoms eigene Datenbank schreiben darf (Vorbedingung zu Etappe 8).
 *
 * Mit dem Worker greifen zwei Prozesse auf dieselbe SQLite-Datei zu. Die Frage
 * war offen; hier steht die Antwort und der Grund.
 *
 * ## Beide schreiben
 *
 * ```text
 * [Server]  Oberfläche, Einstellungen, Entscheidungen  ──┐
 *                                                        ├──> unikom.db
 * [Worker]  Läufe, Protokoll, Status, Meldungen       ──┘
 * ```
 *
 * SQLite lässt im WAL-Modus **einen** Schreiber gleichzeitig zu; Leser stören
 * dabei nicht. Beide Prozesse schreiben also, und die Datenbank reiht ein. Was
 * dabei schiefgehen kann, ist `SQLITE_BUSY` — und dagegen steht `busy_timeout`.
 *
 * ## Warum nicht „nur der Server schreibt"
 *
 * Das wäre die aufgeräumtere Zeichnung und die schlechtere Lösung. Der Worker
 * schreibt am laufenden Band: jede Protokollzeile, jeder Fortschritt, jeder
 * Statuswechsel. Ginge das alles über den Server, hinge die Verarbeitung an
 * dessen Verfügbarkeit — und SPEC-01, Abschnitt 13, verlangt einen Worker, der
 * **vollständig unabhängig** arbeitet. Ein Nachtlauf, der abbricht, weil jemand
 * die Oberfläche neu gestartet hat, wäre genau das Gegenteil.
 *
 * ## Die eine Regel, die dafür gelten muss
 *
 * **Keine Transaktion über eine Wartezeit hinweg.** Wer eine Transaktion offen
 * hält, während er auf einen SFTP-Server, eine Datei oder einen Benutzer
 * wartet, sperrt den anderen Prozess für die ganze Dauer aus — bei einem
 * Zeitüberlauf sind das dreißig Sekunden, in denen die Oberfläche nichts
 * speichern kann.
 *
 * Schreiben heißt deshalb: sammeln, dann in einem kurzen Zug schreiben. Diese
 * Datei benennt die Regel; ein Test hält sie fest.
 */

/** Die beiden Prozesse, die es gibt. */
export type Prozessrolle = 'SERVER' | 'WORKER';

/**
 * Was welcher Prozess führt.
 *
 * Keine Sperre, sondern eine Aufteilung der Zuständigkeit: Beide **dürfen**
 * technisch überall schreiben — die Regel sagt, wer es **tut**. Wo beide
 * dieselbe Zeile anfassen könnten, entscheidet die Fassung am Datensatz, nicht
 * die Rolle (siehe `Sperre` in der Konfliktbearbeitung).
 */
export const FUEHRT: Record<Prozessrolle, readonly string[]> = {
  SERVER: ['Einstellungen', 'Mandanten', 'Benutzer', 'Profile', 'Zuordnungen', 'Konfliktentscheidungen', 'Freigaben'],
  WORKER: ['Läufe', 'Dateien', 'Protokoll', 'Herzschlag', 'Benachrichtigungen', 'Ergebnisstände'],
};

/**
 * Wie lange eine Schreibtransaktion höchstens dauern darf.
 *
 * Kein technisches Limit — SQLite kennt keines —, sondern die Grenze, ab der
 * eine Transaktion verdächtig ist: Länger dauert nur, wer wartet, und wer
 * wartet, hält den anderen Prozess auf.
 */
export const TRANSAKTION_HOECHSTENS_MS = 250;
