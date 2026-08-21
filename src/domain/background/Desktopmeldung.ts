import { KANAELE, type Benachrichtigung } from './Benachrichtigung.js';

/**
 * Die Windows-Blase (SPEC-01, Abschnitt 19 und 20).
 *
 * ```text
 * Worker (Dienst, Sitzung 0)   darf nicht auf den Bildschirm
 *        │
 *        ▼  schreibt in die Datenbank
 * Agent (Benutzersitzung)      zeigt die Blase
 * ```
 *
 * ## Warum es diesen Prozess überhaupt gibt
 *
 * Ein Windows-Dienst läuft in Sitzung 0, und Sitzung 0 hat keinen Bildschirm —
 * seit Windows Vista ist das so, und es ist keine Einstellung, sondern eine
 * Trennung. Ein Dienst kann also gar keine Desktop-Benachrichtigung zeigen. Das
 * ist der ganze Grund für einen eigenen Prozess in der Sitzung des Benutzers,
 * und deshalb steht in SPEC-01: „Dieser läuft in der Benutzer-Session."
 *
 * ## Der Text geht nicht über die Befehlszeile
 *
 * In einem Meldungstitel steht der Name eines Workflows, und den hat ein
 * Mensch getippt. Ihn in eine PowerShell-Zeile zu setzen hieße, jedem, der
 * einen Workflow anlegen darf, die Ausführung beliebiger Befehle zu erlauben —
 * ein Anführungszeichen genügt. Der Text geht deshalb als Base64 durch eine
 * **Umgebungsvariable**, und das Skript ist eine Konstante ohne eine einzige
 * eingesetzte Stelle.
 */
export const TOAST_UMGEBUNGSVARIABLE = 'UNIKOM_TOAST';

/**
 * Unter welcher Kennung die Blase erscheint.
 *
 * Windows verlangt eine registrierte Anwendungskennung; eine erfundene zeigt
 * gar nichts an. Bis Unikom eine eigene mitbringt, wird die von PowerShell
 * benutzt — sie ist auf jedem Windows vorhanden.
 */
export const ANWENDUNGSKENNUNG =
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' + String.fromCharCode(92) + 'WindowsPowerShell' +
  String.fromCharCode(92) + 'v1.0' + String.fromCharCode(92) + 'powershell.exe';

/**
 * Ob diese Meldung überhaupt auf den Bildschirm gehört.
 *
 * Dieselbe Tabelle wie überall: Eine erfolgreiche Verarbeitung meldet sich im
 * Center und sonst nirgends.
 */
export function gehoertAufDenBildschirm(meldung: Pick<Benachrichtigung, 'stufe'>): boolean {
  return KANAELE[meldung.stufe].windows;
}

/**
 * Der Inhalt der Blase.
 *
 * Ein Klick führt zur Stelle, an der sich etwas erledigen lässt — sonst wäre
 * die Blase eine Mitteilung, nach der man selbst suchen muss.
 */
export function toastXml(
  meldung: Pick<Benachrichtigung, 'titel' | 'text' | 'stufe' | 'ziel'>,
  oberflaeche?: string
): string {
  const ziel = oberflaeche ? zielAdresse(oberflaeche, meldung.ziel) : undefined;
  const kopf = ziel
    ? `<toast activationType="protocol" launch="${maskiere(ziel)}">`
    : '<toast>';

  return (
    kopf +
    '<visual><binding template="ToastGeneric">' +
    `<text>${maskiere(meldung.titel)}</text>` +
    `<text>${maskiere(meldung.text)}</text>` +
    '</binding></visual>' +
    '</toast>'
  );
}

/**
 * Wohin ein Klick führt.
 *
 * Ohne Ziel auf die Startseite: Eine Blase, die nirgendwohin führt, ist immer
 * noch besser als eine, die auf eine Seite führt, die es nicht gibt.
 */
export function zielAdresse(oberflaeche: string, ziel: Benachrichtigung['ziel']): string {
  const wurzel = oberflaeche.replace(/\/+$/, '');

  if (!ziel) {
    return wurzel;
  }

  const wege: Record<NonNullable<Benachrichtigung['ziel']>['art'], string> = {
    LAUF: 'verlauf',
    KONFLIKTE: 'konflikte',
    ERGEBNIS: 'ergebnis',
  };

  return `${wurzel}/#/${wege[ziel.art]}/${encodeURIComponent(ziel.id)}`;
}

/**
 * Die fünf Zeichen, die in XML etwas bedeuten.
 *
 * Ein Workflow namens „Müller & Söhne" ergäbe ohne diese Zeile ein XML, das
 * Windows nicht liest — und dann erscheint keine Blase, ausgerechnet bei dem
 * Kunden, dessen Name ein Kaufmanns-Und enthält.
 */
export function maskiere(text: string): string {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;')
    .split("'")
    .join('&apos;');
}

/**
 * Das Skript, das die Blase zeigt — eine Konstante.
 *
 * Keine eingesetzte Stelle, kein zusammengebauter Befehl. Was sich je Meldung
 * unterscheidet, steht in der Umgebungsvariablen.
 */
export function toastBefehl(): { datei: string; argumente: string[] } {
  const skript = [
    '$ErrorActionPreference = "Stop"',
    '[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]',
    '[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]',
    `$roh = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${TOAST_UMGEBUNGSVARIABLE}))`,
    '$dok = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$dok.LoadXml($roh)',
    '$blase = [Windows.UI.Notifications.ToastNotification]::new($dok)',
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:UNIKOM_TOAST_APPID).Show($blase)`,
  ].join('; ');

  return {
    datei: 'powershell.exe',
    argumente: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', skript],
  };
}

/**
 * Unter welchem Namen das Unikom-Fenster gesucht wird.
 *
 * Der Titel eines Browserfensters trägt den Titel der Seite. Gesucht wird
 * deshalb nach einem Teilstück, nicht nach dem ganzen Namen — und über eine
 * Umgebungsvariable, damit ein Betrieb, der die Oberfläche anders betitelt,
 * nicht am Skript herumbauen muss.
 */
export const FENSTER_UMGEBUNGSVARIABLE = 'UNIKOM_FENSTER';

export const FENSTERTITEL = 'Unikom';

/**
 * Ob das Fenster sich in den Vordergrund schieben soll (SPEC-01, Abschnitt 21).
 *
 * Nur bei den beiden dringenden Stufen — und das ist die einzige Schranke, die
 * es hier gibt und braucht. Ein Fenster, das sich vordrängt, während jemand
 * tippt, ist eine Zumutung; genau deshalb steht in der Tabelle bei
 * „Information" ein Nein.
 */
export function holtFensterNachVorn(meldung: Pick<Benachrichtigung, 'stufe'>): boolean {
  return KANAELE[meldung.stufe].nachVorn;
}

/**
 * Das Fenster nach vorn holen — auch das eine Konstante.
 *
 * ```text
 * Blase      Windows zeigt sie, sie verschwindet von selbst
 * Vordergrund  das Fenster, an dem gearbeitet wird, wechselt
 * ```
 *
 * Eine Webseite kann sich nicht selbst nach vorn holen; kein Browser erlaubt
 * das, und aus gutem Grund. Es geht nur von außen, aus einem Prozess in
 * derselben Sitzung — dem Agenten.
 *
 * **Findet sich kein Fenster, geschieht nichts.** Ausdrücklich kein Öffnen
 * eines neuen: Der Agent liefe sonst nachts um drei auf einem Rechner, an dem
 * niemand sitzt, und öffnete alle zwei Stunden einen Browser. Wer nicht
 * hinsieht, wird über die Blase und die E-Mail erreicht.
 */
export function vordergrundBefehl(): { datei: string; argumente: string[] } {
  const skript = [
    '$ErrorActionPreference = "Stop"',
    `$titel = $env:${FENSTER_UMGEBUNGSVARIABLE}`,
    /*
     * `Contains` und nicht `-like`: Ein Titel mit einem Sternchen darin wäre
     * sonst ein Suchmuster statt eines Textes, und dann holte der Agent
     * irgendein Fenster nach vorn.
     */
    '$treffer = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Contains($titel) } |' +
      ' Select-Object -First 1',
    'if (-not $treffer) { exit 2 }',
    '$null = (New-Object -ComObject WScript.Shell).AppActivate($treffer.Id)',
  ].join('; ');

  return {
    datei: 'powershell.exe',
    argumente: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', skript],
  };
}

/** Der Rückgabewert, mit dem das Skript sagt: Es war kein Fenster offen. */
export const KEIN_FENSTER = 2;
