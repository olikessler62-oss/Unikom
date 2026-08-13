# Unikom

Technische Umsetzung von Step 1 der in [Specs/FR_001_FOUND_STEP1.md](Specs/FR_001_FOUND_STEP1.md)
beschriebenen Anwendung: automatisierte Dateiübernahme aus lokalen, SFTP- und
FTPS-Quellen mit überprüfbaren Filtern, Stabilitätsprüfung, Integritätsnachweis,
optionaler Verschlüsselung und sicherer lokaler Ablage.

Eine Datei gilt erst dann als übernommen, wenn sie den Auswahlregeln entspricht,
alt genug und stabil ist, vollständig übertragen, geprüft, optional verschlüsselt,
endgültig gespeichert und persistent registriert wurde. Erst dann entsteht
`STEP_1_COMPLETED` — der spätere Übergabepunkt an Step 2.

## Voraussetzungen

- **Node.js 22 oder neuer.** Die Persistenz nutzt das eingebaute Modul `node:sqlite`,
  das Node beim Start als experimentell meldet.

## Einrichtung

```bash
npm install
npm test          # 248 Tests, inklusive echter SFTP- und FTPS-Protokolltests
npm run dev       # Beispiellauf mit lokaler Quelle
npm run build     # Produktivbuild nach dist/ (ohne Tests)
```

## Hauptschlüssel

Zugangsdaten werden verschlüsselt gespeichert. Der dafür nötige Schlüssel wird
aus der Umgebungsvariablen `UNIKOM_MASTER_KEY` gelesen und liegt damit bewusst
außerhalb der Datenbank, die er schützt.

Einen neuen Schlüssel erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Der Wert muss base64-kodierte 32 Byte sein. Ohne ihn lassen sich keine
Zugangsdaten lesen oder anlegen; Jobs mit rein lokalen Quellen und ohne
Verschlüsselung laufen auch ohne.

Geht der Schlüssel verloren, sind alle gespeicherten Zugangsdaten unbrauchbar
und müssen neu hinterlegt werden. Die bereits übertragenen Dateien sind davon
nicht betroffen — außer sie wurden verschlüsselt abgelegt.

## Logging und Historie

Jeder Transfer wird protokolliert — in die Datenbank und optional auf die
Konsole. Die Level sind `DEBUG`, `INFO`, `WARNING` und `ERROR`; im Betrieb gilt
standardmäßig `INFO`.

```bash
UNIKOM_LOG_LEVEL=DEBUG npm run dev
```

`DEBUG` erklärt zusätzlich für jede gefundene Datei, warum sie ausgewählt oder
verworfen wurde — das ist der schnellste Weg, einen Filter zu prüfen, der nicht
wie erwartet greift. Ein Wiederholungsversuch nach einem temporären Fehler
erscheint als `WARNING`, nicht als `ERROR`: Der Lauf ist zu diesem Zeitpunkt
noch in Ordnung.

Über den `TransferHistoryService` sind Laufübersicht, Laufdetail mit Dateien und
Protokoll, fehlgeschlagene Dateien sowie die Kennzahlen des Dashboards
abrufbar.

## Dubletten: zwei verschiedene Dinge

Im Code stecken zwei Mechanismen, die leicht verwechselt werden:

**Wiederholungsschutz** — dieselbe Quelldatei nach Pfad, Name, Größe und
Änderungszeit wurde schon übernommen, also nicht erneut holen. Das ist keine
fachliche Dublettenprüfung, sondern die Wiederholbarkeit des Laufs, und deshalb
**nicht abschaltbar**. Ohne sie holt der Scheduler alle 15 Minuten das gesamte
Quellverzeichnis erneut.

**Inhaltsgleichheit** — zwei *verschiedene* Dateien mit identischem Inhalt. Das
ist ein Job-Schalter, `detectContentDuplicates`, und er ist **voreingestellt
aus**:

```typescript
detectContentDuplicates: true
```

Welche Dateien ein Quellsystem bereitstellt, ist dessen Entscheidung. Ob
derselbe Inhalt unter zwei Namen ein Versehen ist oder Absicht, lässt sich von
hier aus nicht beurteilen — und eine Datei stillschweigend zu unterschlagen, die
der Kunde geschickt hat, ist die riskantere Annahme.

Einschalten lohnt für ein bestimmtes Muster: Quellsysteme, die ihre Dateien
nächtlich neu schreiben, ohne etwas zu ändern. Gleicher Name, neue
Änderungszeit — der Wiederholungsschutz greift dann nicht, die Inhaltsprüfung
schon.

## Aufbewahrung

Protokoll und Übernahme-Historie enthalten Dateinamen, und ein Dateiname ist
regelmäßig ein Personenbezug — `Rechnung_Mueller_2026.pdf` nennt einen
Menschen. Eine unbefristete Speicherung ist damit begründungsbedürftig
(Art. 5 Abs. 1 lit. e DSGVO). Jeder Job kann deshalb festlegen, wie lange
aufbewahrt wird:

```typescript
retention: { logDays: 90, historyDays: 365 }
```

Der `RetentionService` löscht Abgelaufenes; der Scheduler ruft ihn höchstens
einmal pro Kalendertag auf. Schlägt das fehl, wird es gemeldet, aber der
Betrieb läuft weiter — Aufräumen ist kein Grund, Übertragungen einzustellen.

Die beiden Fristen sind bewusst getrennt, weil sie unterschiedlich folgenreich
sind:

| | Voreinstellung | Folge der Löschung |
| --- | --- | --- |
| `logDays` | 90 Tage | Nur die Spur wird kürzer. Keine Auswirkung auf Übertragungen. |
| `historyDays` | unbegrenzt | **Verändert das Verhalten.** |

Die Übernahme-Historie *ist* die Dublettenerkennung. Wird sie gelöscht, ist eine
Datei, die noch in der Quelle liegt, wieder unbekannt und wird erneut geholt.
Was dann passiert, hängt an der Konfliktstrategie: `SKIP` erkennt die Datei am
Zielverzeichnis, es bleibt bei vergeblicher Übertragung. `RENAME` legt sie ein
zweites Mal ab — dann steht derselbe Inhalt doppelt im Ziel.

Betroffen ist nur `sourceSuccessAction: 'KEEP'`. Wer Quelldateien verschiebt
oder löscht, hat nichts, was ein zweites Mal aufgesammelt werden könnte. Weil es
hier keine unbedenkliche Voreinstellung gibt, bleibt `historyDays` leer, bis
jemand sie bewusst setzt.

## Module

Unikom ist ein Produkt mit einzeln zuschaltbaren Modulen. Das Grundprodukt ist
Step 1 mit lokalen Quellen, Zeitplanung, Historie und Job-Verwaltung; es ist
immer enthalten.

| Modul | Inhalt |
| ----- | ------ |
| `REMOTE_SOURCES` | Entfernte Quellen: SFTP und FTPS |
| `ENCRYPTION` | Verschlüsselte Ablage, Entschlüsselung in der Kette, erneute Verschlüsselung vor der Auslieferung (AES-256-GCM) |
| `STEP_2_CONSOLIDATION` | Konsolidierung, Korrektur, Anreicherung, Datensatz-Dubletten |
| `STEP_3_FILE_EXPORT` | Export in Dateiformate |
| `STEP_3_DATABASE_MIGRATION` | Migration in Datenbanktabellen |

SFTP und FTPS bilden ein Modul: beides ist entfernter Dateizugriff über einen
verschlüsselten Kanal, mit gemeinsamer Zugangsdaten- und Host-Prüfung. Step 3
sind dagegen zwei Module, weil ein Dateiexport und eine Migration in
Datenbanktabellen im Aufwand weit auseinanderliegen.

Die Prüfung sitzt an zwei Stellen, nicht in der Oberfläche:

1. **Beim Speichern eines Jobs** über den `TransferJobService`. Der Fehler nennt
   das fehlende Modul, und zwar während der Bearbeitung statt nachts um drei.
2. **Beim Erzeugen der Fähigkeit** — im `SourceAdapterProvider`, vor der
   Verschlüsselung und bei der Registrierung einer Verarbeitungsstufe. Diese
   Prüfung ist die tragende: ein Job, der bei gültiger Lizenz angelegt oder
   direkt in die Datenbank geschrieben wurde, kommt hier unverändert an.

Ein nicht lizenziertes Modul wird nicht ausgeblendet, es existiert zur Laufzeit
nicht. Eine verlangte, aber nicht lizenzierte Verschlüsselung lässt den Transfer
scheitern, statt die Datei im Klartext abzulegen.

Voreingestellt sind alle Module aktiv, damit Entwicklung, Tests und Demo keine
Lizenzübung sind. Ein Auslieferungsbuild übergibt stattdessen die tatsächliche
Zusammenstellung über `ApplicationOptions.features`.

## Übergabe an Step 2 und 3

Sobald eine Datei `STEP_1_COMPLETED` erreicht hat, entsteht der
`FileProcessingContext` aus §75 — der Übergabevertrag. Jede weitere Stufe nimmt
ihn entgegen, verändert ihn und gibt ihn weiter:

```typescript
interface ProcessingStage {
  readonly name: string;
  readonly requiredFeature: Feature;
  process(context: FileProcessingContext): Promise<FileProcessingContext>;
}
```

Weil Ein- und Ausgabe dieselbe Form haben, sind die Stufen frei kombinierbar:
Ein Export läuft ebenso auf dem Ergebnis von Step 1 wie auf dem einer
Konsolidierung. Die Kette ist die Reihenfolge der Registrierung, nichts im Code
setzt eine bestimmte Abfolge voraus (§76).

Zwei Punkte, die dabei zählen:

- `sha256` ist die Prüfsumme des **Inhalts** vor einer Verschlüsselung — der
  Wert, mit dem die Dublettenerkennung arbeitet. Bei `encrypted: true` ist es
  bewusst nicht die Prüfsumme der Bytes unter `currentFilePath`.
- Eine Stufe, die die Datei neu schreibt, muss die neue Prüfsumme mitliefern.
  Andernfalls bricht die Registry ab, statt eine Integrität weiterzureichen, die
  niemand geprüft hat.

Scheitert eine Stufe, bleibt Step 1 gültig: die Datei ist gespeichert und
registriert, die Quelldatei bereits archiviert oder gelöscht. Der Fehler wird
als `PROCESSING_STAGE_FAILED` gemeldet und protokolliert, der Transfer aber
nicht rückwirkend für fehlgeschlagen erklärt.

### Verschlüsselung in der Kette

Eine verschlüsselt abgelegte Datei kann keine Stufe direkt lesen. Dafür gibt es
zwei Stufen, beide im Modul `ENCRYPTION` — wer das Schloss kauft, bekommt auch
den Schlüssel:

| Stufe | Aufgabe |
| ----- | ------- |
| `DecryptForProcessingStage` | Entschlüsselt für die folgenden Stufen. Als erste registrieren. |
| `EncryptResultStage` | Verschlüsselt das Ergebnis vor der Auslieferung. Als letzte registrieren. |

Der Klartext entsteht **ausschließlich im Staging-Verzeichnis**, das am Ende
jedes Laufs gelöscht wird. Die verschlüsselte Datei im Zielverzeichnis bleibt
unangetastet — die Zusage aus §45, dass im Ziel kein Klartext liegt, gilt
weiter, auch während Step 2 auf dem Inhalt arbeitet.

`EncryptResultStage` bekommt **einen eigenen Schlüssel je Ziel**, nicht den des
Quell-Jobs. Eine Datei, die an einen Empfänger geht, muss von diesem lesbar
sein; mit unserem Schlüssel wäre sie es nicht.

Beim Entschlüsseln wird geprüft, ob der Inhalt der Prüfsumme entspricht, die
Step 1 vor dem Verschlüsseln festgehalten hat. Ein falscher Schlüssel oder eine
veränderte Datei fällt damit auf, bevor eine Folgestufe darauf aufsetzt — und
hinterlässt keinen halb geschriebenen Klartext.

## Datenablage

Alles Dauerhafte liegt unter `application-data/`:

| Inhalt | Ablage |
| ------ | ------ |
| Jobs, Läufe, Zugangsdaten, Datei-Historie, Protokoll | `unikom.db` (SQLite) |
| Arbeitsverzeichnis während eines Laufs | `staging/<run-id>/` |

Das Staging-Verzeichnis wird nach jedem Lauf geleert. Dateien erreichen das
Zielverzeichnis ausschließlich als fertiges, atomar verschobenes Ergebnis.

## Architektur

```text
src/
  domain/          Modelle und Regeln (Transfer, Quelle, Zugangsdaten, Verschlüsselung,
                   Module, Übergabevertrag)
  application/     Pipeline, Scheduler, Laufzeit, Credential-Verwaltung, Lizenzprüfung,
                   Stufen-Registry
  infrastructure/  Quell-Adapter (Local/SFTP/FTPS), Persistenz, Krypto, Dateisystem
  testing/         Testhilfen inklusive echter SFTP- und FTPS-Server
```

Scheduler, UI, CLI und API laufen alle über denselben
`TransferExecutionService` — es gibt keine getrennte Transferlogik für manuelle
und automatische Läufe. Protokollspezifisches Verhalten steckt ausschließlich in
den jeweiligen Quell-Adaptern.

## Sicherheit

- SSH-Host-Keys werden geprüft. Ohne hinterlegten Fingerabdruck wird die
  Verbindung abgelehnt; das Abschalten erfordert die ausdrückliche Option
  `allowUnknownHostKey`.
- TLS-Zertifikate werden geprüft. Für private oder selbst signierte Zertifikate
  kann eines über `trustedCertificate` hinterlegt werden, statt die Prüfung
  ganz abzuschalten.
- Passwörter, private Schlüssel und Verschlüsselungsschlüssel erscheinen weder
  im Log noch in Exporten, Fehlermeldungen oder der Datenbank. Abgesichert durch
  [SecretsNeverLeak.test.ts](src/application/credentials/SecretsNeverLeak.test.ts).
- Entfernte Dateinamen können das Ziel- oder Staging-Verzeichnis nicht verlassen.

## Abweichungen von der Spec

Bewusste Entscheidungen gegen den Wortlaut der Spec. Sie stehen hier, damit sie
beim nächsten Abgleich nicht als Lücke erscheinen:

| Stelle | Abweichung | Grund |
| ------ | ---------- | ----- |
| §39–40, §108 | Die Erkennung inhaltsgleicher Dateien ist ein Job-Schalter, voreingestellt **aus** | Welche Dateien eine Quelle liefert, ist ihre Entscheidung. Der Wiederholungsschutz ist davon unberührt und bleibt fest. |
| §21 | Benutzerdefinierte Cron-Ausdrücke lösen einen klaren Fehler aus | Besser als still falsch zu rechnen |

## Stand

Umgesetzt sind die Phasen 1 bis 11 der Spec mit den oben genannten
Abweichungen. Damit ist auch Kriterium 41 erfüllt: Step 2 kann an
`STEP_1_COMPLETED` angeschlossen werden, und der Vertrag dafür existiert.

Offen ist die Oberfläche (§83–94). Für Step 2 und Step 3 stehen Vertrag,
Registry, Lizenzprüfung sowie Ver- und Entschlüsselung in der Kette bereit; die
fachlichen Stufen selbst sind noch nicht gebaut.

Geplant, aber noch nicht als Modul angelegt: ein entferntes **Ziel** für Step 3
(Upload nach SFTP/FTPS). Das ist eine andere Fähigkeit als `REMOTE_SOURCES`,
das ausschließlich eingehend arbeitet — Hochladen schreibt in ein fremdes
System, mit eigener Konfliktstrategie und eigener Fehlerbehandlung. Es wird
daher ein eigenes, getrennt lizenziertes Modul. Der Name steht erst im Code,
wenn die Fähigkeit existiert; jedes Modul in `FEATURES` wird auch tatsächlich
irgendwo geprüft.

Ebenfalls vorgesehen: Einstellungen später über Supabase. Weil die Persistenz
hinter Repository-Schnittstellen liegt, ist das eine weitere Implementierung
neben SQLite und kein Umbau.

Der Scheduler läuft, solange `startPolling()` aktiv ist; ein Dienst-Wrapper für
Windows oder systemd existiert noch nicht.
