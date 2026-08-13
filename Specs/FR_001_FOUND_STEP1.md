# SPEC – Automatisierte Dateiübernahme und sichere Ablage

## Step 1 von 3

## 1. Ziel

Entwicklung von **Step 1 einer dreistufigen automatisierten Datenverarbeitungs-Anwendung**.

Step 1 übernimmt Dateien automatisch aus unterschiedlichen Quellen, prüft sie anhand konfigurierbarer Regeln, lädt beziehungsweise kopiert sie, prüft ihre Vollständigkeit, verschlüsselt sie optional und legt sie in einem definierten lokalen Zielverzeichnis ab.

Der Prozess muss vollständig automatisiert und ohne Benutzerinteraktion laufen können.

Der Benutzer konfiguriert einmalig einen **Transfer-Job**.

Danach übernimmt das System selbstständig:

```text
Quelle überwachen
        ↓
passende Dateien erkennen
        ↓
prüfen, ob Datei vollständig/stabil ist
        ↓
Datei übernehmen
        ↓
Integrität prüfen
        ↓
optional verschlüsseln
        ↓
lokal ablegen
        ↓
Transfer registrieren
        ↓
Quelldatei optional archivieren/löschen
        ↓
STEP_1_COMPLETED
```

Step 2 und Step 3 werden später entwickelt und sind ausdrücklich **nicht Bestandteil dieses Specs**.

Die Architektur muss jedoch bereits darauf vorbereitet sein.

---

# 2. Kernprinzip: Transfer-Job

Die zentrale Einheit der Anwendung ist ein:

```text
Transfer Job
```

Ein Transfer-Job definiert vollständig:

* von welcher Quelle Dateien kommen,
* wie auf die Quelle zugegriffen wird,
* in welchem Quellverzeichnis gesucht wird,
* wann gesucht wird,
* wie häufig gesucht wird,
* welche Dateinamen berücksichtigt werden,
* welche Dateiformate berücksichtigt werden,
* wann eine Datei als vollständig gilt,
* in welches Zielverzeichnis sie übernommen wird,
* ob die Datei verschlüsselt wird,
* wie Namenskonflikte behandelt werden,
* was anschließend mit der Quelldatei geschieht.

Ein gespeicherter und aktivierter Transfer-Job läuft danach automatisch.

---

# 3. Beispiel eines vollständigen Jobs

```text
Name:
Kunde A – Bestellungen

Status:
Aktiv

Quelle:
SFTP

Server:
sftp.customer-a.de

Port:
22

Anmeldung:
Credential "Customer A Production"

Quellverzeichnis:
/exports/orders

Dateiname beginnt mit:
ORDER_

Dateiformat:
CSV

Unterverzeichnisse:
Nein

Mindestalter:
60 Sekunden

Stabilitätsprüfung:
Aktiv

Ausführung:
Automatisch

Suchintervall:
Alle 15 Minuten

Lokales Ziel:
D:\Data\Incoming\CustomerA

Verschlüsselung:
AES-256-GCM

Bei bereits vorhandener Datei:
Überspringen

Nach erfolgreicher Übernahme:
Quelldatei verschieben

Archivverzeichnis:
/exports/archive
```

Danach arbeitet dieser Job beispielsweise automatisch:

```text
06:00 → Quelle prüfen
06:15 → Quelle prüfen
06:30 → Quelle prüfen
06:45 → Quelle prüfen
07:00 → Quelle prüfen
...
```

---

# 4. Unterstützte Quellen

Step 1 muss mindestens folgende Quellen unterstützen:

```text
LOCAL
SFTP
FTPS
```

Normales unverschlüsseltes FTP gehört nicht zum MVP.

---

# 5. Lokale Quelle

Eine lokale Quelle kann sein:

```text
C:\Import
```

```text
D:\Data\Incoming
```

oder ein erreichbares Netzwerkverzeichnis:

```text
\\SERVER01\Export\Orders
```

Konfiguration:

```text
Quellverzeichnis
Dateifilter
Unterverzeichnisse Ja/Nein
```

---

# 6. SFTP

Konfigurierbar:

```text
Host
Port
Benutzername
Authentifizierung
Remote-Verzeichnis
Timeout
Retry
```

Authentifizierung über:

```text
Benutzername + Passwort
```

oder:

```text
SSH Private Key
```

SSH Host Key Verification muss unterstützt werden.

Host-Key-Prüfung darf nicht ohne deutliche Konfiguration deaktiviert werden.

---

# 7. FTPS

Unterstützt werden:

```text
Explicit FTPS
```

und, sofern die verwendete Library dies sauber unterstützt:

```text
Implicit FTPS
```

Konfiguration:

```text
Host
Port
Benutzername
Passwort
Remote-Verzeichnis
TLS
Zertifikatsprüfung
Timeout
Retry
```

TLS-Zertifikate werden standardmäßig geprüft.

---

# 8. Source-Adapter Architektur

Die Transferlogik darf nicht direkt von einem bestimmten Protokoll abhängen.

Gemeinsames Interface:

```typescript
interface SourceAdapter {
  testConnection(): Promise<ConnectionTestResult>;

  listFiles(
    directory: string,
    recursive: boolean
  ): Promise<SourceFile[]>;

  downloadFile(
    sourceFile: SourceFile,
    targetPath: string
  ): Promise<DownloadResult>;

  moveFile?(
    sourceFile: SourceFile,
    targetDirectory: string
  ): Promise<void>;

  deleteFile?(
    sourceFile: SourceFile
  ): Promise<void>;
}
```

Implementierungen:

```text
LocalSourceAdapter
SftpSourceAdapter
FtpsSourceAdapter
```

---

# 9. Zukünftige Quellen

Architektur so erstellen, dass später problemlos ergänzt werden können:

```text
HTTP/HTTPS
WebDAV
Amazon S3
Azure Blob Storage
Google Drive
OneDrive
E-Mail-Anhänge
API
```

Diese Quellen jetzt NICHT implementieren.

---

# 10. SourceFile

Ein gefundener Quelldatei-Eintrag besitzt mindestens:

```typescript
interface SourceFile {
  name: string;

  fullPath: string;

  size?: number;

  lastModified?: Date;

  isDirectory: boolean;

  metadata?: Record<string, unknown>;
}
```

---

# 11. Konfigurierbares Quellverzeichnis

Jeder Job besitzt genau definierte Quellpfade.

Beispiele:

```text
/export/orders
```

```text
/customer/invoices
```

```text
D:\Export\Orders
```

Der Benutzer muss das Verzeichnis ändern können, ohne dafür Code zu verändern.

---

# 12. Unterverzeichnisse

Konfiguration:

```text
Unterverzeichnisse berücksichtigen:

Ja / Nein
```

Standard:

```text
Nein
```

Bei `Ja` werden Dateien rekursiv gesucht.

---

# 13. Konfigurierbares Zielverzeichnis

Das lokale Zielverzeichnis ist pro Job einstellbar.

Beispiele:

```text
D:\Processing\CustomerA
```

```text
C:\UniCom\Incoming\Orders
```

```text
E:\Interfaces\CustomerB\Inbound
```

Vor einem Transfer prüfen:

```text
Existiert Verzeichnis?
Ist Verzeichnis erreichbar?
Bestehen Schreibrechte?
```

Optional:

```text
Zielverzeichnis automatisch anlegen
```

---

# 14. Dateiformat

Der Benutzer legt fest, welche Dateitypen verarbeitet werden.

Mindestens UI-Auswahl für:

```text
CSV
TXT
XML
JSON
XLS
XLSX
PDF
```

Zusätzlich müssen freie Dateiendungen möglich sein:

```text
.dat
.edi
.asc
.log
.custom
```

Die Implementierung darf technisch nicht auf eine hart codierte Liste beschränkt sein.

---

# 15. Mehrere Dateiformate

Pro Job dürfen mehrere Formate erlaubt sein.

Beispiel:

```text
.csv
.xlsx
.xml
```

Dateien anderer Formate werden ignoriert.

---

# 16. Dateiname beginnt mit

Der Benutzer kann optional einen Anfang des Dateinamens definieren.

UI-Bezeichnung:

```text
Dateiname beginnt mit
```

Beispiel:

```text
ORDER_
```

Erlaubt:

```text
ORDER_001.csv
ORDER_20260813.csv
ORDER_CUSTOMER_A.csv
```

Nicht erlaubt:

```text
INVOICE_ORDER_001.csv
TEST_ORDER_001.csv
MYORDER_001.csv
```

Der Text muss am **Anfang des Dateinamens** stehen.

---

# 17. Präfixvergleich

Logisch:

```typescript
filename.startsWith(filenamePrefix)
```

Standardmäßig soll der Vergleich:

```text
nicht zwischen Groß-/Kleinschreibung unterscheiden
```

Beispiel:

```text
Prefix:
ORDER_
```

akzeptiert:

```text
ORDER_001.csv
Order_001.csv
order_001.csv
```

Optional:

```text
Groß-/Kleinschreibung beachten
```

---

# 18. Kombination der Filter

Alle aktiven Filter werden mit `AND` kombiniert.

Beispiel:

```text
Quellverzeichnis:
/orders

Dateiname beginnt mit:
ORDER_

Dateiformat:
.csv
```

Verzeichnis:

```text
ORDER_001.csv
ORDER_002.csv
ORDER_003.xlsx
INVOICE_001.csv
TEST_ORDER_004.csv
```

Verarbeitet:

```text
ORDER_001.csv
ORDER_002.csv
```

---

# 19. FileSelectionCriteria

Filterlogik zentral kapseln.

```typescript
interface FileSelectionCriteria {
  filenamePrefix?: string;

  allowedExtensions: string[];

  caseSensitivePrefix: boolean;

  includeSubdirectories: boolean;

  minimumFileAgeSeconds: number;

  requireStableFile: boolean;
}
```

---

# 20. FileSelectionService

Eigener Service:

```text
FileSelectionService
```

Aufgaben:

```text
Präfix prüfen
Dateiendung prüfen
Dateialter prüfen
Dateistabilität prüfen
```

Beispielsweise:

```typescript
matchesFilename()

matchesExtension()

isOldEnough()

isStable()

matches()
```

Wichtig:

Die Filterlogik gehört NICHT in:

```text
SftpSourceAdapter
FtpsSourceAdapter
LocalSourceAdapter
```

Dadurch gelten dieselben Regeln unabhängig von der Quelle.

---

# 21. Scheduler

Automatische Verarbeitung ist eine **Kernfunktion des Systems**.

Jeder Transfer-Job besitzt einen eigenen Schedule.

Der Benutzer muss einstellen können:

```text
Nur manuell

Alle X Minuten

Stündlich

Täglich

Bestimmte Wochentage

Bestimmte Uhrzeit

Benutzerdefinierter Cron-Ausdruck
```

---

# 22. Typische Intervalle

UI-Schnellauswahl:

```text
Alle 5 Minuten
Alle 10 Minuten
Alle 15 Minuten
Alle 30 Minuten
Stündlich
Täglich
Wöchentlich
Benutzerdefiniert
```

Zusätzlich soll bei `INTERVAL` eine freie Anzahl Minuten konfigurierbar sein.

---

# 23. Tägliche Ausführung

Beispiel:

```text
Täglich

06:30 Uhr
```

---

# 24. Wöchentliche Ausführung

Beispiel:

```text
Montag
Dienstag
Mittwoch
Donnerstag
Freitag

06:00 Uhr
```

---

# 25. Zeitzone

Jeder Schedule benötigt eine explizite Zeitzone.

Standardmäßig kann die Systemzeitzone vorgeschlagen werden.

Beispiel:

```text
Europe/Berlin
```

Schedule-Berechnungen dürfen nicht implizit von UTC oder der Server-Zeitzone ausgehen.

---

# 26. ExecutionMode

```typescript
enum ExecutionMode {
  MANUAL,
  AUTOMATIC,
  MANUAL_AND_AUTOMATIC
}
```

Standard:

```text
MANUAL_AND_AUTOMATIC
```

Automatische Jobs können dadurch bei Bedarf zusätzlich manuell gestartet werden.

---

# 27. Scheduler-Service

Eigener:

```text
JobSchedulerService
```

Aufgaben:

```text
aktive Jobs laden

fällige Jobs bestimmen

NextExecution berechnen

Jobs starten

Doppelausführungen verhindern

Scheduler-Fehler protokollieren
```

Der Scheduler enthält **keine Dateiübertragungslogik**.

Er startet ausschließlich:

```typescript
transferExecutionService.execute(jobId);
```

---

# 28. Gleiche Pipeline für alle Aufrufe

Folgende Startmöglichkeiten müssen denselben Service benutzen:

```text
Scheduler ─────┐
               │
UI ────────────┤
               ↓
CLI ───→ TransferExecutionService
               ↑
API ───────────┘
```

Keine getrennte Transferlogik für manuelle und automatische Verarbeitung.

---

# 29. Gleichzeitige Ausführung desselben Jobs

Ein Job darf standardmäßig nicht mehrfach parallel laufen.

Beispiel:

```text
Job startet:
06:00

Job läuft noch:
06:15

Scheduler würde erneut starten:
06:15
```

Dann:

```text
kein zweiter Lauf
```

Standard:

```text
SKIP_IF_RUNNING
```

Log:

```text
Scheduled execution skipped because previous execution is still running.
```

---

# 30. Anwendung war nicht aktiv

Wenn die Anwendung zwischen zwei geplanten Läufen ausgeschaltet war, dürfen beim Neustart nicht automatisch alle verpassten Ausführungen nachgeholt werden.

Standard:

```text
MISSED_RUN_POLICY = SKIP
```

Nach Start wird der nächste reguläre Ausführungstermin berechnet.

Später kann optional ergänzt werden:

```text
RUN_ONCE_AFTER_STARTUP
```

---

# 31. Persistente Schedules

Schedules dürfen nicht ausschließlich im RAM existieren.

Persistent speichern:

```text
Schedule
LastExecution
NextExecution
Enabled
```

Nach Neustart:

```text
Anwendung startet
    ↓
aktive Transfer-Jobs laden
    ↓
Schedules rekonstruieren
    ↓
NextExecution berechnen
    ↓
Scheduler aktiv
```

---

# 32. Stabilitätsprüfung – zwingend

Das System darf eine Datei nicht übernehmen, solange ein anderes System sie noch schreibt oder hochlädt.

Beispiel:

```text
ORDER_001.csv
```

erste Prüfung:

```text
Size = 1.240.000 Bytes
```

nach fünf Sekunden:

```text
Size = 1.510.000 Bytes
```

Ergebnis:

```text
Datei ist NICHT stabil.
```

Keine Verarbeitung.

---

# 33. Stabilitätsprüfung über Dateigröße

Standardverfahren:

```text
Metadaten lesen

warten

Metadaten erneut lesen

Dateigröße vergleichen
```

Wenn:

```text
size1 == size2
```

und zusätzlich, sofern verfügbar:

```text
lastModified1 == lastModified2
```

kann die Datei als stabil betrachtet werden.

---

# 34. Konfigurierbarer Stability Check

Pro Job:

```text
Stabilitätsprüfung:
Aktiv / Inaktiv
```

Standard:

```text
Aktiv
```

Parameter:

```text
Prüfintervall:
z. B. 5 Sekunden

Anzahl stabiler Prüfungen:
z. B. 2
```

Empfohlener Standard:

```text
2 identische Prüfungen
mit 5 Sekunden Abstand
```

---

# 35. Mindestalter einer Datei

Zusätzlich muss ein Mindestalter konfigurierbar sein.

Beispiel:

```text
Datei muss mindestens:
60 Sekunden alt sein
```

Eine Datei:

```text
erstellt/geändert vor 12 Sekunden
```

wird noch nicht verarbeitet.

Standard:

```text
30 Sekunden
```

Der nächste Scheduler-Lauf kann sie erneut prüfen.

---

# 36. Warum Mindestalter UND Stabilitätsprüfung

Beides erfüllt unterschiedliche Aufgaben.

### Mindestalter

verhindert, dass ganz frisch erschienene Dateien sofort übernommen werden.

### Stabilitätsprüfung

prüft tatsächlich, ob sich Größe beziehungsweise Änderungszeit noch verändert.

Deshalb können beide Regeln gleichzeitig aktiv sein.

---

# 37. Erkennung temporärer Upload-Dateien

Häufig verwendete temporäre Dateiendungen sollen optional ignoriert werden.

Beispiele:

```text
.part
.tmp
.temp
.crdownload
.filepart
```

Diese Liste muss konfigurierbar beziehungsweise erweiterbar sein.

Diese Dateien niemals übernehmen, solange sie eine bekannte temporäre Endung besitzen.

---

# 38. Atomarer Upload auf Quellseite

Wenn ein Fremdsystem eine Datei zunächst unter:

```text
ORDER_001.csv.tmp
```

hochlädt und danach umbenennt zu:

```text
ORDER_001.csv
```

wird ausschließlich die fertige:

```text
ORDER_001.csv
```

berücksichtigt.

---

# 39. Bereits verarbeitete Dateien

Das System muss verhindern, dass dieselbe Datei bei jedem Scheduler-Lauf erneut verarbeitet wird.

Dafür Transfer-Historie beziehungsweise File Registry verwenden.

Speichern:

```text
Source
Source Path
Filename
Size
LastModified
SHA-256
Transfer Timestamp
Status
```

---

# 40. Duplikaterkennung

Vor Verarbeitung prüfen:

```text
Wurde diese Datei bereits erfolgreich übernommen?
```

Dabei nicht ausschließlich den Dateinamen verwenden.

Berücksichtigen:

```text
Source
Path
Filename
Size
LastModified
Hash
```

---

# 41. SHA-256

Für erfolgreich heruntergeladene Dateien muss ein SHA-256 Hash erzeugt werden können.

Beispiel:

```text
Filename:
ORDER_001.csv

Size:
183441

SHA256:
72f8...
```

SHA-256 dient unter anderem:

```text
Integritätsnachweis
Duplikaterkennung
Audit
```

---

# 42. Dateiübernahme

Eine Datei darf niemals direkt unter dem endgültigen Zielnamen heruntergeladen werden.

Nicht:

```text
orders.csv
```

während des Downloads.

Sondern beispielsweise:

```text
orders.csv.part
```

oder:

```text
.work\4F172.tmp
```

Erst nach erfolgreicher Verarbeitung wird sie atomar in den endgültigen Namen umbenannt beziehungsweise verschoben.

---

# 43. Staging-Verzeichnis

Empfohlen wird ein internes temporäres Arbeitsverzeichnis.

Beispiel:

```text
application-data/
    staging/
        <run-id>/
```

Dort können Dateien:

```text
heruntergeladen
geprüft
verschlüsselt
```

werden.

Erst danach kommen sie ins endgültige Zielverzeichnis.

---

# 44. Integritätsprüfung

Nach Download mindestens prüfen:

```text
Download erfolgreich abgeschlossen?
Datei vorhanden?
Dateigröße plausibel?
Quelldateigröße = Zieldateigröße?
```

Soweit die Quelle eine zuverlässige Quelldateigröße liefert.

Danach:

```text
SHA-256 berechnen
```

---

# 45. Optional verschlüsseln

Die Datei kann vor ihrer endgültigen Ablage verschlüsselt werden.

Pipeline:

```text
DOWNLOAD
    ↓
INTEGRITY CHECK
    ↓
OPTIONAL ENCRYPTION
    ↓
FINAL STORAGE
```

Die Verschlüsselung darf nicht Bestandteil eines SourceAdapters sein.

---

# 46. Verschlüsselungsmethode

Step 1 mindestens:

```text
NONE
AES-256-GCM
```

AES-256-GCM ist dem einfachen AES-CBC vorzuziehen, da neben Vertraulichkeit auch Authentizität beziehungsweise Manipulationserkennung unterstützt wird.

---

# 47. Erweiterbare Encryption-Architektur

Interface:

```typescript
interface EncryptionProvider {
  encrypt(
    inputPath: string,
    outputPath: string,
    config: EncryptionConfig
  ): Promise<EncryptionResult>;
}
```

Erste Implementierung:

```text
Aes256GcmEncryptionProvider
```

Später erweiterbar:

```text
PGP
ZIP-AES
Custom Provider
```

Jetzt nicht implementieren.

---

# 48. Wichtige Unterscheidung: Quelle bereits verschlüsselt

Die Konfiguration muss langfristig zwischen zwei Dingen unterscheiden können:

```text
Quelldatei ist bereits verschlüsselt
```

und:

```text
System soll die abgeholte Datei verschlüsseln
```

Step 1 implementiert zunächst die zweite Variante.

Die Architektur darf diese beiden Sachverhalte jedoch nicht miteinander vermischen.

---

# 49. Credential Management

Zugangsdaten getrennt von Transfer-Jobs verwalten.

Beispiele:

```text
Customer A Production SFTP
Customer B FTPS
Internal Network
```

Credential-Typen:

```text
USERNAME_PASSWORD
SSH_PRIVATE_KEY
ENCRYPTION_KEY
```

---

# 50. Credential

Mindestens:

```typescript
interface Credential {
  id: string;

  name: string;

  type: CredentialType;

  username?: string;

  encryptedSecret: string;

  createdAt: Date;

  updatedAt: Date;
}
```

Ein TransferJob speichert nur:

```text
credentialId
```

---

# 51. Keine Secrets im Klartext

Niemals speichern oder loggen:

```text
Passwörter
Private Keys
AES Keys
Tokens
```

im Klartext.

Secrets dürfen insbesondere nicht vorkommen in:

```text
Logs
JSON-Exporten
Exceptions
API Responses
Browser Console
```

---

# 52. Verbindung testen

Im Job-Editor:

```text
Verbindung testen
```

Bei Erfolg:

```text
✓ Verbindung erfolgreich

Quellverzeichnis erreichbar

47 Dateien gefunden
```

Bei Fehler:

```text
✕ Verbindung fehlgeschlagen

Authentication failed
```

Keine Secrets ausgeben.

---

# 53. Passende Dateien anzeigen

Zusätzliche Funktion:

```text
Dateiauswahl testen
```

oder:

```text
Passende Dateien anzeigen
```

Beispiel:

```text
Dateien im Verzeichnis:
47

Dateiname/Format passend:
7

Zu jung:
2

Noch nicht stabil:
1

Bereits verarbeitet:
2

Aktuell übernehmbar:
2
```

Darunter beispielsweise:

```text
ORDER_20260813_001.csv
ORDER_20260813_002.csv
```

Das erleichtert die Einrichtung erheblich.

---

# 54. Konflikte im Zielverzeichnis

Wenn eine Zieldatei bereits existiert:

```text
SKIP
OVERWRITE
RENAME
```

Standard:

```text
SKIP
```

---

# 55. Rename

Beispiel:

```text
ORDER_001.csv
```

existiert bereits.

Neue Datei:

```text
ORDER_001_001.csv
```

oder alternativ konfigurierbar:

```text
ORDER_001_20260813_064510.csv
```

---

# 56. Verhalten der Quelldatei nach Erfolg

Konfigurierbar:

```text
KEEP
MOVE
DELETE
```

Standard:

```text
KEEP
```

---

# 57. KEEP

Originaldatei bleibt in der Quelle.

---

# 58. MOVE

Nach vollständigem Erfolg wird die Originaldatei in ein Archivverzeichnis verschoben.

Beispiel:

```text
/export/orders/ORDER_001.csv
```

nach:

```text
/export/archive/ORDER_001.csv
```

---

# 59. DELETE

Quelldatei wird entfernt.

DELETE darf nur erfolgen, wenn Step 1 vollständig erfolgreich abgeschlossen wurde.

---

# 60. Source Action erst ganz am Ende

Eine Quelldatei darf ausschließlich MOVE oder DELETE erhalten, wenn:

```text
Download erfolgreich
AND
Integritätsprüfung erfolgreich
AND
optionale Verschlüsselung erfolgreich
AND
finale lokale Speicherung erfolgreich
AND
Transferdaten persistent gespeichert
```

Erst dann:

```text
MOVE / DELETE
```

---

# 61. Keine Datei gefunden

Wenn bei einem Scheduler-Lauf keine passende Datei gefunden wird, ist dies kein Fehler.

Status beispielsweise:

```text
SUCCESS_NO_FILES
```

Log:

```text
06:00 Job gestartet
06:00 Verbindung erfolgreich
06:00 0 passende Dateien gefunden
06:00 Job beendet
06:00 nächster Lauf 06:15
```

---

# 62. Mehrere Dateien

Alle passenden Dateien eines Scheduler-Laufs sollen verarbeitet werden.

Beispiel:

```text
12 passende Dateien
```

Ergebnis:

```text
10 SUCCESS
1 FAILED
1 SKIPPED
```

Run:

```text
COMPLETED_WITH_ERRORS
```

Die erfolgreiche Verarbeitung anderer Dateien darf durch eine einzelne fehlerhafte Datei nicht verhindert werden.

---

# 63. Status eines Runs

```typescript
enum TransferRunStatus {
  PENDING,
  RUNNING,
  SUCCESS,
  SUCCESS_NO_FILES,
  COMPLETED_WITH_ERRORS,
  FAILED,
  CANCELLED
}
```

---

# 64. Status einer Datei

```typescript
enum FileTransferStatus {
  DISCOVERED,
  FILTERED_OUT,
  WAITING_FOR_STABILITY,
  SKIPPED,
  DOWNLOADING,
  DOWNLOADED,
  VALIDATING,
  ENCRYPTING,
  STORING,
  SUCCESS,
  FAILED
}
```

---

# 65. Retry

Temporäre Fehler automatisch erneut versuchen.

Standard:

```text
3 Versuche
```

Beispielsweise:

```text
Versuch 1
sofort

Versuch 2
nach 5 Sekunden

Versuch 3
nach 15 Sekunden
```

---

# 66. Retry nur bei sinnvollen Fehlern

Retry beispielsweise bei:

```text
Timeout
Connection Reset
Temporary Network Failure
Remote Server Temporarily Unavailable
```

Kein automatisches Retry beispielsweise bei:

```text
falsches Passwort
ungültige Konfiguration
fehlende Berechtigung
ungültiges Zertifikat
```

---

# 67. Logging

Jeder Transfer muss nachvollziehbar protokolliert werden.

Beispiel:

```text
2026-08-13 06:45:00
Scheduled job started

Job:
Customer A Orders

2026-08-13 06:45:01
Connected to SFTP source

2026-08-13 06:45:02
47 files scanned

2026-08-13 06:45:02
3 files matched filename and extension

2026-08-13 06:45:07
ORDER_001.csv stability check passed

2026-08-13 06:45:08
Downloading ORDER_001.csv

2026-08-13 06:45:10
Download completed

2026-08-13 06:45:10
Integrity check passed

2026-08-13 06:45:10
SHA-256 calculated

2026-08-13 06:45:11
AES-256-GCM encryption completed

2026-08-13 06:45:11
File stored successfully

2026-08-13 06:45:12
Source file moved to archive

2026-08-13 06:45:12
STEP_1_COMPLETED

2026-08-13 06:45:12
Next execution: 07:00
```

---

# 68. Logging-Level

Mindestens:

```text
DEBUG
INFO
WARNING
ERROR
```

Produktionsmodus standardmäßig:

```text
INFO
```

---

# 69. Transfer-Historie

Für jeden Job:

```text
Datum
Start
Ende
Dauer
Ausführungsart
Dateien gefunden
Dateien übernommen
Dateien übersprungen
Dateien fehlgeschlagen
Status
```

---

# 70. Run Detail

Benutzer kann einen Lauf öffnen.

Beispiel:

```text
Run:
TR-20260813-064500

Job:
Customer A Orders

Start:
06:45:00

End:
06:45:12

Gefunden:
5

Verarbeitet:
3

Erfolgreich:
3

Übersprungen:
2

Fehler:
0
```

Darunter einzelne Dateien.

---

# 71. TransferFile

Persistentes Modell mindestens:

```text
id

transferRunId

jobId

sourcePath

sourceFilename

sourceSize

sourceLastModified

destinationPath

destinationFilename

destinationSize

sha256

status

errorCode

errorMessage

startedAt

completedAt
```

---

# 72. TransferJob – vollständiges Kernmodell

```typescript
interface TransferJob {
  id: string;

  name: string;

  description?: string;

  enabled: boolean;

  sourceType: SourceType;

  sourceConfig: SourceConfig;

  credentialId?: string;

  sourceDirectory: string;

  includeSubdirectories: boolean;

  filenamePrefix?: string;

  caseSensitivePrefix: boolean;

  allowedExtensions: string[];

  ignoredTemporaryExtensions: string[];

  minimumFileAgeSeconds: number;

  stabilityCheck: StabilityCheckConfig;

  destinationDirectory: string;

  createDestinationDirectory: boolean;

  conflictStrategy: ConflictStrategy;

  encryptionConfig: EncryptionConfig;

  sourceSuccessAction: SourceSuccessAction;

  sourceArchiveDirectory?: string;

  executionMode: ExecutionMode;

  schedule?: JobSchedule;

  lastExecutionAt?: Date;

  nextExecutionAt?: Date;

  createdAt: Date;

  updatedAt: Date;
}
```

---

# 73. StabilityCheckConfig

```typescript
interface StabilityCheckConfig {
  enabled: boolean;

  intervalSeconds: number;

  requiredStableChecks: number;

  compareSize: boolean;

  compareLastModified: boolean;
}
```

Defaults:

```text
enabled = true

intervalSeconds = 5

requiredStableChecks = 2

compareSize = true

compareLastModified = true
```

---

# 74. JobSchedule

```typescript
interface JobSchedule {
  type:
    | "INTERVAL"
    | "HOURLY"
    | "DAILY"
    | "WEEKLY"
    | "CRON";

  intervalMinutes?: number;

  executionTime?: string;

  weekdays?: number[];

  cronExpression?: string;

  timezone: string;

  missedRunPolicy: "SKIP";
}
```

---

# 75. Transfer Context

Für die spätere Weitergabe an Step 2 wird ein zentraler Context verwendet.

```typescript
interface FileProcessingContext {
  runId: string;

  jobId: string;

  sourceFile: SourceFile;

  originalFilename: string;

  currentFilename: string;

  temporaryPath: string;

  currentFilePath: string;

  finalDestinationPath?: string;

  fileSize?: number;

  sha256?: string;

  encrypted: boolean;

  metadata: Record<string, unknown>;
}
```

---

# 76. Processing Pipeline

Pipeline nicht hart codieren.

Konzeptionell:

```text
DISCOVERY
     ↓
FILTER
     ↓
MINIMUM AGE CHECK
     ↓
STABILITY CHECK
     ↓
DUPLICATE CHECK
     ↓
DOWNLOAD / COPY
     ↓
INTEGRITY CHECK
     ↓
HASH
     ↓
OPTIONAL ENCRYPTION
     ↓
FINAL STORAGE
     ↓
PERSIST RESULT
     ↓
SOURCE SUCCESS ACTION
     ↓
STEP_1_COMPLETED
```

---

# 77. Events / Pipeline Hooks

Mindestens logisch vorbereiten:

```text
TRANSFER_RUN_STARTED

FILE_DISCOVERED

FILE_SELECTED

FILE_STABLE

FILE_DOWNLOADED

FILE_VALIDATED

FILE_ENCRYPTED

FILE_STORED

FILE_COMPLETED

FILE_FAILED

STEP_1_COMPLETED

TRANSFER_RUN_COMPLETED
```

Noch kein komplexes Event-Bus-System implementieren, wenn es dafür keinen technischen Grund gibt.

Saubere Hooks beziehungsweise Domain Events reichen.

---

# 78. Bedeutung von STEP_1_COMPLETED

`STEP_1_COMPLETED` darf ausschließlich entstehen, wenn eine konkrete Datei:

```text
vollständig übernommen
+
validiert
+
optional verschlüsselt
+
final gespeichert
+
persistent registriert
```

wurde.

`STEP_1_COMPLETED` ist zukünftig der Übergabepunkt zu Step 2.

---

# 79. Parallelisierung

Mehrere Dateien eines Jobs dürfen begrenzt parallel verarbeitet werden.

Konfiguration beziehungsweise Systemstandard:

```text
maxConcurrentFiles = 3
```

Keine unbegrenzte Parallelität.

---

# 80. Verschiedene Jobs dürfen parallel laufen

Unterschiedliche Jobs dürfen grundsätzlich gleichzeitig ausgeführt werden.

Beispiel:

```text
Customer A Orders

Customer B Invoices

Internal Exports
```

können parallel laufen.

Nur derselbe Job soll standardmäßig keinen parallelen Doppel-Run haben.

---

# 81. kontrollierter Abbruch

Ein laufender Run sollte abgebrochen werden können.

Bei Abbruch:

```text
keine neuen Dateien beginnen

laufende Operation soweit möglich sauber beenden/abbrechen

temporäre Dateien beseitigen

bereits erfolgreiche Dateien behalten

Status = CANCELLED
```

---

# 82. Fehler bei Anwendungsausfall

Temporäre `.part`- oder Staging-Dateien können nach einem Absturz übrig bleiben.

Beim Start der Anwendung müssen verwaiste temporäre Dateien erkannt werden.

Nicht automatisch als erfolgreich behandeln.

Optional:

```text
Staging Cleanup
```

nach einem konfigurierbaren Alter.

---

# 83. UI – Hauptnavigation

Für Step 1 mindestens:

```text
Dashboard

Transfer-Jobs

Zugangsdaten

Transfer-Historie

Einstellungen
```

---

# 84. Transfer-Job Übersicht

Tabelle:

| Name | Quelle | Filter | Zeitplan | Nächster Lauf | Letzter Lauf | Status | Aktiv |
| ---- | ------ | ------ | -------- | ------------- | ------------ | ------ | ----- |

Aktionen:

```text
Bearbeiten

Jetzt ausführen

Historie

Duplizieren

Aktivieren/Deaktivieren

Löschen
```

---

# 85. Job-Editor – Bereich Allgemein

```text
Name

Beschreibung

Aktiv
```

---

# 86. Job-Editor – Quelle

```text
Quelltyp

Lokales Verzeichnis
SFTP
FTPS
```

Danach dynamisch die notwendigen Verbindungsinformationen.

---

# 87. Job-Editor – Dateiauswahl

```text
Quellverzeichnis

Dateiname beginnt mit

Dateiformat(e)

Unterverzeichnisse berücksichtigen

Mindestalter

Stabilitätsprüfung
```

---

# 88. Job-Editor – Stabilitätsprüfung

Darstellung zunächst einfach:

```text
Datei erst übernehmen, wenn sie vollständig geschrieben wurde

[✓]
```

Erweiterte Einstellungen optional aufklappbar:

```text
Prüfabstand:
5 Sekunden

Benötigte unveränderte Prüfungen:
2
```

Der Benutzer muss nicht mit technischen Details überfordert werden.

---

# 89. Job-Editor – Ziel

```text
Lokales Zielverzeichnis

Verzeichnis automatisch anlegen

Wenn Datei bereits vorhanden:
Überspringen
Überschreiben
Umbenennen
```

---

# 90. Job-Editor – Sicherheit

```text
Datei nach Übernahme verschlüsseln

Keine Verschlüsselung

AES-256-GCM
```

Bei AES:

```text
Verschlüsselungsschlüssel auswählen
```

über Credential Reference.

---

# 91. Job-Editor – Nach erfolgreicher Verarbeitung

```text
Quelldatei:

Behalten

In Archiv verschieben

Löschen
```

Bei Archiv:

```text
Archivverzeichnis
```

---

# 92. Job-Editor – Automatisierung

```text
Ausführung:

Nur manuell

Automatisch

Manuell + automatisch
```

Bei Automatik:

```text
Nach Dateien suchen:

Alle 5 Minuten
Alle 10 Minuten
Alle 15 Minuten
Alle 30 Minuten
Stündlich
Täglich
Wöchentlich
Benutzerdefiniert
```

---

# 93. Job-Editor – Zusammenfassung

Vor Speicherung eine verständliche Zusammenfassung anzeigen.

Beispiel:

```text
Dieser Job prüft alle 15 Minuten den SFTP-Ordner

/export/orders

und übernimmt alle CSV-Dateien, deren Name mit

ORDER_

beginnt.

Dateien werden erst übernommen, wenn sie mindestens
60 Sekunden alt und vollständig geschrieben sind.

Sie werden anschließend verschlüsselt und unter

D:\Data\Incoming\CustomerA

gespeichert.

Nach erfolgreicher Verarbeitung wird die Quelldatei
nach /export/archive verschoben.
```

Diese Zusammenfassung ist für den Benutzer sehr hilfreich.

---

# 94. Dashboard

Anzeige mindestens:

```text
Aktive Jobs

Heute ausgeführte Jobs

Heute übernommene Dateien

Fehlgeschlagene Dateien

Aktuell laufende Jobs

Nächste geplante Ausführungen
```

---

# 95. Sicherheit

Zwingend:

```text
keine Secrets in Logs

keine Secrets im Klartext in Datenbank

keine Secrets in URLs

keine Secrets in Frontend State persistieren

Path Traversal verhindern

Dateinamen validieren

Remote-Dateinamen nicht ungeprüft zu lokalen Pfaden machen

TLS-Zertifikate validieren

SSH Host Keys prüfen

keine Shell Commands aus Benutzereingaben zusammensetzen
```

---

# 96. Path Traversal

Eine Remote-Datei wie:

```text
../../Windows/System32/example
```

darf niemals außerhalb des vorgesehenen Staging- oder Zielverzeichnisses gespeichert werden.

Lokale Zieldateinamen müssen normalisiert und validiert werden.

---

# 97. Architektur

Empfohlene fachliche Struktur:

```text
src/

  domain/
    transfer/
    source/
    scheduling/
    credentials/
    encryption/
    files/

  application/
    transfer/
    scheduling/

  infrastructure/
    sources/
      local/
      sftp/
      ftps/

    persistence/
    encryption/
    filesystem/
    scheduling/

  api/

  ui/
```

An vorhandene Projektstruktur anpassen, falls bereits ein Repository existiert.

---

# 98. Services

Mindestens logisch trennen:

```text
TransferJobService

TransferExecutionService

JobSchedulerService

SourceAdapterFactory

FileSelectionService

FileStabilityService

DuplicateDetectionService

FileIntegrityService

EncryptionService

CredentialService

TransferHistoryService

StagingService
```

Keine God-Class.

---

# 99. Wichtige Architekturregel

NICHT:

```typescript
if (sourceType === "sftp") {
   // komplette Verarbeitung
}

if (sourceType === "ftps") {
   // komplette Verarbeitung
}

if (sourceType === "local") {
   // komplette Verarbeitung
}
```

über die Anwendung verteilt.

Protokollspezifisches Verhalten gehört ausschließlich in den jeweiligen Source Adapter.

---

# 100. Datenmodell

Mindestens:

```text
TransferJob

TransferSchedule

Credential

TransferRun

TransferFile

TransferLog
```

Optional separate:

```text
ProcessedFileRegistry
```

falls die TransferFile-Tabelle für schnelle Duplikatsprüfung nicht geeignet ist.

---

# 101. Datenbank-Indizes

Für spätere größere Datenmengen sinnvolle Indizes vorsehen für:

```text
TransferJob.enabled

TransferJob.nextExecutionAt

TransferRun.jobId

TransferRun.startedAt

TransferFile.jobId

TransferFile.sha256

TransferFile.sourcePath

TransferFile.status
```

---

# 102. Tests – Scheduler

Mindestens testen:

```text
fälliger Job wird gestartet

nicht fälliger Job wird nicht gestartet

deaktivierter Job wird nicht gestartet

laufender Job wird nicht doppelt gestartet

NextExecution wird korrekt berechnet

Zeitzone wird berücksichtigt

verpasste Runs werden nicht mehrfach nachgeholt
```

---

# 103. Tests – Dateifilter

Testen:

```text
richtiges Präfix

falsches Präfix

richtige Extension

falsche Extension

mehrere erlaubte Extensions

Case-insensitive Präfix

Case-sensitive Präfix

Unterverzeichnisse
```

---

# 104. Tests – Stabilität

Testen:

```text
Dateigröße unverändert → stabil

Dateigröße verändert → nicht stabil

LastModified verändert → nicht stabil

Datei zu jung → nicht verarbeiten

temporäre Dateiendung → ignorieren

Datei wird bei späterem Scheduler-Lauf erneut geprüft
```

---

# 105. Tests – Transfer

Testen:

```text
lokale Datei kopieren

SFTP Download

FTPS Download

Download in Temp-Datei

Integritätsprüfung

Hash-Berechnung

finales atomisches Verschieben
```

---

# 106. Tests – Verschlüsselung

Testen:

```text
NONE

AES-256-GCM

verschlüsselte Ausgabe unterscheidet sich von Input

Entschlüsselung mit korrektem Key möglich

Manipulation wird erkannt

Fehler bei Encryption erzeugt kein STEP_1_COMPLETED
```

---

# 107. Tests – Source Success Action

```text
KEEP

MOVE

DELETE
```

Besonders testen:

```text
Download erfolgreich
aber Encryption schlägt fehl
→ Quelle NICHT löschen
```

und:

```text
Datei gespeichert
aber Persistierung schlägt fehl
→ Quelle NICHT löschen
```

---

# 108. Tests – Duplikate

Testen:

```text
identische Datei bereits erfolgreich verarbeitet

gleicher Dateiname, anderer Inhalt

anderer Dateiname, gleicher Hash

fehlgeschlagener früherer Transfer

erfolgreicher früherer Transfer
```

---

# 109. Tests – Sicherheit

Mindestens:

```text
Passwort erscheint nicht im Log

Encryption Key erscheint nicht im Log

Private Key erscheint nicht im Log

Path Traversal wird blockiert

ungültiger Dateiname wird blockiert
```

---

# 110. Tests – Neustart

Test:

```text
automatischer Job gespeichert

Anwendung neu starten

Job erneut laden

Schedule rekonstruieren

Job läuft zum nächsten Zeitpunkt weiter
```

---

# 111. Abnahmekriterien

Step 1 ist erst fertig, wenn mindestens Folgendes funktioniert:

1. Transfer-Jobs können erstellt, geändert, aktiviert, deaktiviert und gelöscht werden.
2. Lokale Quellen werden unterstützt.
3. SFTP wird unterstützt.
4. FTPS wird unterstützt.
5. Zugangsdaten werden sicher verwaltet.
6. Verbindungen können getestet werden.
7. Quellverzeichnis ist frei konfigurierbar.
8. Zielverzeichnis ist frei konfigurierbar.
9. Dateiformate sind konfigurierbar.
10. Mehrere Dateiformate sind möglich.
11. Ein optionaler Dateinamensanfang kann definiert werden.
12. Nur Dateien mit passendem Anfang werden berücksichtigt.
13. Präfix und Dateiendung funktionieren gemeinsam.
14. Unterverzeichnisse sind optional.
15. Datei-Mindestalter wird berücksichtigt.
16. Dateistabilität wird geprüft.
17. Noch laufende Uploads werden nicht übernommen.
18. Temporäre Upload-Dateien werden ignoriert.
19. Ein Scheduler führt Jobs automatisch aus.
20. Intervalle in Minuten funktionieren.
21. tägliche Ausführungen funktionieren.
22. wöchentliche Ausführungen funktionieren.
23. Zeitzonen werden korrekt berücksichtigt.
24. automatische Jobs überleben einen Neustart.
25. derselbe Job läuft nicht unbeabsichtigt parallel.
26. keine gefundenen Dateien gelten nicht als Fehler.
27. Dateien werden zunächst temporär übernommen.
28. Integritätsprüfung wird durchgeführt.
29. SHA-256 wird erzeugt.
30. Duplikate werden erkannt.
31. AES-256-GCM ist optional möglich.
32. Dateien werden sicher im Ziel gespeichert.
33. Namenskonflikte werden behandelt.
34. Quelle kann nach Erfolg behalten, verschoben oder gelöscht werden.
35. MOVE/DELETE erfolgt niemals vor vollständigem Erfolg.
36. einzelne Datei-Fehler stoppen nicht zwingend den gesamten Run.
37. Retry für temporäre Fehler funktioniert.
38. Transfer-Historie ist vorhanden.
39. Logs enthalten keine Secrets.
40. `STEP_1_COMPLETED` wird nur für vollständig erfolgreich verarbeitete Dateien erzeugt.
41. Step 2 kann später an `STEP_1_COMPLETED` angeschlossen werden.

---

# 112. Nicht Bestandteil von Step 1

Ausdrücklich NICHT implementieren:

```text
Dateiinhalte analysieren

Spalten erkennen

Datentypen bestimmen

Encoding automatisch korrigieren

Daten bereinigen

Daten ergänzen

Daten transformieren

Dateien miteinander mergen

Tabellen mappen

Datenbanken analysieren

Daten in Ziel-Datenbanken importieren

CSV-/Excel-Ausgabedateien erzeugen

Step 2

Step 3
```

Diese Funktionen folgen separat.

---

# 113. Vorgehen für Claude Code

Claude Code soll NICHT sofort beginnen, wahllos Komponenten zu programmieren.

Zunächst:

1. Repository vollständig analysieren.
2. verwendeten Tech-Stack feststellen.
3. bestehende Architektur verstehen.
4. vorhandene Datenbank und Authentifizierung prüfen.
5. vorhandene Libraries prüfen.
6. einen konkreten Implementierungsplan für Step 1 erstellen.
7. notwendige Datenbankänderungen festlegen.

Danach schrittweise:

```text
Phase 1
Domain Models + Persistenz

Phase 2
Credential Management

Phase 3
Source Adapter Interface

Phase 4
Local Source Adapter

Phase 5
File Selection + Stability

Phase 6
Transfer Pipeline

Phase 7
SFTP Adapter

Phase 8
FTPS Adapter

Phase 9
Encryption

Phase 10
Scheduler

Phase 11
Logging + History

Phase 12
UI

Phase 13
Integration Tests

Phase 14
Security Tests
```

Nach jeder Phase bestehende und neue Tests ausführen.

---

# 114. Keine unnötigen Änderungen

Claude Code darf:

* keine bestehenden Komponenten ohne Grund austauschen,
* keine Framework-Migration durchführen,
* keine großflächigen Refactorings außerhalb des Scopes durchführen,
* keine Step-2- oder Step-3-Funktionalität vorwegnehmen.

Neue Libraries nur einsetzen, wenn sie fachlich notwendig sind.

---

# 115. Leitprinzip der Gesamtanwendung

Die langfristige Anwendung basiert auf:

```text
SOURCE
   ↓
ACQUIRE
   ↓
VALIDATE
   ↓
SECURE
   ↓
STAGE
   ↓
PROCESS
   ↓
TRANSFORM
   ↓
DESTINATION
```

Dieses Spec implementiert ausschließlich:

```text
SOURCE
   ↓
ACQUIRE
   ↓
VALIDATE
   ↓
SECURE
   ↓
STAGE
```

und endet mit:

```text
STEP_1_COMPLETED
```

---

# 116. Wichtigste fachliche Regel

Eine Datei gilt niemals allein deshalb als übernommen, weil sie im Quellverzeichnis gefunden wurde oder der Download beendet wurde.

Sie gilt erst als erfolgreich für Step 1, wenn:

```text
Datei entspricht den Auswahlregeln
        AND
Datei ist alt genug
        AND
Datei ist stabil
        AND
Datei wurde vollständig übernommen
        AND
Integritätsprüfung war erfolgreich
        AND
optionale Verschlüsselung war erfolgreich
        AND
Datei wurde endgültig gespeichert
        AND
Transfer wurde persistent registriert
```

Erst dann:

```text
STEP_1_COMPLETED
```

Diese Regel muss zentral umgesetzt und durch Tests abgesichert werden.
