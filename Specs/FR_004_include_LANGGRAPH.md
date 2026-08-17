# UniCom – Modulare LangGraph Architektur Spec

> **Status: verworfen am 2026-08-15. Nicht umsetzen.**
>
> Dieses Dokument bleibt als Ideensammlung erhalten, ist aber **kein Auftrag**.
> Verworfen wurden vor allem zwei Festlegungen:
>
> - **§41 „Module besitzen eigene Jobs".** Getrennte Jobtypen plus Pipelines
>   hätten das gerade gebaute Modell ersetzt, in dem ein Workflow aus zu- und
>   abschaltbaren Gliedern besteht. Was §1 fordert — jedes Modul autonom nutzbar
>   und einzeln verkäuflich — leistet das bestehende Modell bereits: siehe
>   „Die Kette, ihre Namen und ihre Nummern" im README.
> - **§15–21 KI-Schicht.** Schemata, Feldnamen und Beispielwerte an einen
>   KI-Anbieter zu schicken, widerspricht der Zusage der Anwendung, dass die
>   Installation lokal läuft und nichts meldet. Feldnamen sind regelmäßig
>   personenbezogen.
>
> Übernommen wurde eine einzige Festlegung, und die steht heute im Code:
> **alle vier Module werden einzeln lizenziert, das Übertragen eingeschlossen**
> (§55). Alles übrige — Plattformschicht, Artifacts, Modulregistry, LangGraph —
> wurde wieder entfernt.

---

## 1. Ziel

UniCom besteht aus vier vollständig eigenständigen Modulen.

Jedes Modul:

* kann separat installiert bzw. freigeschaltet werden
* kann separat verkauft werden
* besitzt eigene Jobs
* besitzt eigene Konfigurationen
* besitzt eigene Ein- und Ausgaben
* kann unabhängig von anderen UniCom-Modulen betrieben werden
* erzeugt ein eigenständig nutzbares Ergebnis
* kann optional mit anderen Modulen zu einer Verarbeitungskette verbunden werden

Die vier Module sind:

```text
1. Daten holen
2. Daten verarbeiten
3. Daten importieren
4. Daten ausliefern / konvertieren
```

---

# 2. Gesamtarchitektur

```text
                    UniCom

┌──────────────────────────────────────────────┐
│               Gemeinsame Plattform          │
│                                              │
│ Jobs                                         │
│ Scheduler                                    │
│ Benutzer                                     │
│ Berechtigungen                               │
│ Logging                                      │
│ Audit                                        │
│ Monitoring                                   │
│ AI / LangGraph                               │
└───────────────────────┬──────────────────────┘
                        │

       ┌────────────────┼─────────────────┐
       │                │                 │
       ▼                ▼                 ▼

┌─────────────┐  ┌─────────────┐  ┌──────────────┐
│ Modul 1     │  │ Modul 2     │  │ Modul 3      │
│             │  │             │  │              │
│ Daten holen │  │ Daten       │  │ Daten        │
│             │  │ verarbeiten │  │ importieren  │
└─────────────┘  └─────────────┘  └──────────────┘

                          ┌─────────────────────┐
                          │ Modul 4             │
                          │                     │
                          │ Daten ausliefern /  │
                          │ konvertieren        │
                          └─────────────────────┘
```

Es gibt keinen technischen Zwang, mehrere Module gemeinsam zu verwenden.

---

# 3. Grundprinzip der Module

Jedes Modul arbeitet nach demselben Grundmodell:

```text
INPUT
  ↓
MODUL
  ↓
RESULT
```

Beispiele:

### Modul 1

```text
SFTP Server
↓
Daten holen
↓
lokale Datei
```

### Modul 2

```text
CSV / Excel / DB-Daten
↓
Daten verarbeiten
↓
konsolidierte Daten
```

### Modul 3

```text
aufbereitete Daten
↓
Daten importieren
↓
SQL-Datenbank
```

### Modul 4

```text
aufbereitete Daten
↓
Daten ausliefern
↓
CSV / Excel / JSON / XML / SFTP / Verzeichnis
```

---

# 4. Modul 1 – Daten holen

## 4.1 Zweck

Das Modul „Daten holen“ ist ein eigenständiges Datentransfer-Modul.

Es besitzt keine fachliche Datenverarbeitung.

Seine Aufgabe ist ausschließlich:

> Daten oder Dateien sicher und automatisiert von einer Quelle zu einem definierten Ziel zu übertragen.

---

# 5. Unterstützte Quellen

Das Modul soll unter anderem unterstützen:

```text
lokales Verzeichnis

Netzwerkfreigabe

SFTP

FTPS

FTP optional

HTTP / HTTPS optional

Cloud Storage später
```

---

# 6. Auswahl der Dateien

Konfigurierbar:

```text
Dateiname

Dateiprefix

Dateiendung

Wildcard

Regex optional

Alter der Datei

Änderungsdatum

Mindestgröße

Maximalgröße
```

Beispiel:

```text
CUSTOMER_*.csv
```

oder:

```text
Prefix:
INVOICE_
```

---

# 7. Scheduler

Das Modul kann automatisch suchen:

```text
alle X Minuten

stündlich

täglich

bestimmte Uhrzeit

bestimmte Wochentage

manuell
```

---

# 8. Verschlüsselung Modul 1

Beim Holen kann optional:

```text
PGP entschlüsselt

AES entschlüsselt

ZIP entpackt

Datei anschließend lokal verschlüsselt
```

werden.

Wichtig:

Die Verschlüsselungsfunktion gehört hier zum sicheren Datentransfer und nicht zur fachlichen Datenverarbeitung.

---

# 9. Ergebnis Modul 1

Ergebnis ist immer ein definiertes technisches Datenobjekt.

Beispielsweise:

```text
C:\UniCom\Inbound\customer_20260815.csv
```

oder:

```text
\\server\incoming\customer.xlsx
```

Das Modul endet danach erfolgreich.

Es ist keine weitere UniCom-Komponente notwendig.

---

# 10. Modul 1 Workflow

```text
START
  ↓
Job laden
  ↓
Quelle prüfen
  ↓
Dateien suchen
  ↓
Dateien gefunden?
  ├── NEIN → END
  ↓
Datei übertragen
  ↓
optional entschlüsseln
  ↓
Hash prüfen
  ↓
Zieldatei speichern
  ↓
Transfer protokollieren
  ↓
COMPLETED
```

---

# 11. Modul 2 – Daten verarbeiten

## 11.1 Zweck

Das Modul „Daten verarbeiten“ ist die eigentliche Datenaufbereitungs- und Konsolidierungsengine.

Es hat keine Verpflichtung, Daten selbst abzuholen oder anschließend zu exportieren.

Input können beispielsweise sein:

```text
lokale Dateien

Netzwerkdateien

bereits bereitgestellte Dateien

Datenbankabfragen

Outputs anderer Systeme

Output von Modul 1
```

---

# 12. Aufgaben Modul 2

Das Modul kann:

```text
Daten analysieren

Daten bereinigen

Datentypen erkennen

Daten korrigieren

Daten ergänzen

Daten filtern

Daten transformieren

Spalten umbenennen

Spalten aufteilen

Spalten zusammenführen

Lookups durchführen

Werte ersetzen

Daten normalisieren

mehrere Quellen zusammenführen

Daten konsolidieren

Dubletten erkennen

Dubletten behandeln

fachliche Regeln anwenden

Datensätze validieren
```

---

# 13. Ergebnis Modul 2

Das Ergebnis des Moduls ist ein neues Datenobjekt.

Beispielsweise:

```text
konsolidierte Tabelle

temporäre UniCom-Dataset-Datei

CSV

Parquet

interner Dataset-Snapshot

strukturierter JSON-Datensatz
```

Das Ergebnis muss vollständig unabhängig von Modul 3 oder 4 nutzbar sein.

---

# 14. Modul 2 Workflow

```text
START
  ↓
Input laden
  ↓
Dateiformat erkennen
  ↓
Struktur analysieren
  ↓
Schema bekannt?
  │
  ├── JA
  │
  └── NEIN
       ↓
       AI Schema Analyzer
  ↓
Mapping laden / erzeugen
  ↓
Transformationen
  ↓
Merge / Konsolidierung
  ↓
Validierung
  ↓
Result Dataset erzeugen
  ↓
Result speichern
  ↓
COMPLETED
```

---

# 15. Modul 2 und KI

Hier liegt der wichtigste Einsatzbereich von LangGraph und AI.

AI kann unter anderem helfen bei:

```text
Schema-Erkennung

semantischer Feldanalyse

Mapping-Erkennung

Transformationsvorschlägen

Fehleranalyse

Regelerzeugung

Strukturänderungen

Formatinterpretation
```

---

# 16. AI Schema Analyzer

Beispiel:

```text
KDNr
NAME
STR
PLZ
ORT
```

AI erkennt:

```text
KDNr → customer_number
NAME → company_name
STR  → street
PLZ  → postal_code
ORT  → city
```

---

# 17. AI Mapping Agent

Source:

```text
Customer No.
Company
Postal
```

Target:

```text
CUSTOMER_ID
COMPANY_NAME
POSTAL_CODE
```

AI schlägt vor:

```text
Customer No. → CUSTOMER_ID
Company      → COMPANY_NAME
Postal       → POSTAL_CODE
```

---

# 18. Confidence

Jede KI-Zuordnung besitzt einen Confidence-Wert.

Standard:

```text
>= 98 %
automatisch verwenden

90–97 %
verwenden und markieren

70–89 %
User-Freigabe

< 70 %
keine automatische Zuordnung
```

Konfigurierbar.

---

# 19. Human-in-the-loop

Beispiel:

```text
KST

Vorschlag:

COST_CENTER 82 %
```

UI:

```text
KST zuordnen zu:

○ COST_CENTER
○ CUSTOMER_ID
○ anderes Feld
○ ignorieren

[Bestätigen]
```

Danach wird die Entscheidung gespeichert.

---

# 20. Mapping Memory

Bestätigte Entscheidungen werden wiederverwendet.

Priorität:

```text
1. exaktes gespeichertes Mapping
2. vorhandene Regel
3. bekanntes Schema
4. AI
5. User
```

---

# 21. Rule Engine

AI darf keine beliebige Logik direkt ausführen.

Sie darf lediglich Regeln erzeugen.

Beispiel:

```json
{
  "type": "currency_conversion",
  "sourceLocale": "de-DE",
  "targetType": "decimal"
}
```

Diese Regel wird anschließend von der deterministischen UniCom Engine ausgeführt.

---

# 22. Modul 3 – Daten importieren

## 22.1 Zweck

Das Modul „Daten importieren“ übernimmt strukturierte Daten und schreibt sie in Zielsysteme.

Der Schwerpunkt liegt auf:

> strukturiertem Import in Datenbanken oder andere persistente Zielsysteme.

---

# 23. Unterstützte Ziele Modul 3

Initial:

```text
PostgreSQL

Microsoft SQL Server

MySQL / MariaDB

Oracle

weitere SQL-Datenbanken über Adapter
```

Später optional:

```text
REST API

ERP-System

CRM-System

Data Warehouse

Cloud Database
```

---

# 24. Input Modul 3

Input kann sein:

```text
CSV

Excel

JSON

XML

UniCom Dataset

interner Output von Modul 2

externe vorbereitete Datei
```

Modul 3 darf ausdrücklich auch ohne Modul 1 und Modul 2 eingesetzt werden.

---

# 25. Aufgaben Modul 3

```text
Zielverbindung prüfen

Zieltabelle bestimmen

Schema vergleichen

Mapping laden

Datentypen validieren

Insert

Update

Upsert

Delete optional

Batch Import

Transaktionen

Rollback

Constraint-Prüfung

Fehlerprotokoll
```

---

# 26. Import-Modi

Konfigurierbar:

```text
INSERT only

UPDATE only

UPSERT

REPLACE

TRUNCATE + INSERT

Synchronisation
```

---

# 27. Modul 3 Workflow

```text
START
  ↓
Input laden
  ↓
Zielverbindung prüfen
  ↓
Zielschema laden
  ↓
Mapping prüfen
  ↓
Daten validieren
  ↓
Import vorbereiten
  ↓
Transaktion starten
  ↓
Import durchführen
  ↓
Ergebnis prüfen
  ↓
Commit
  ↓
Import Report erzeugen
  ↓
COMPLETED
```

Fehler:

```text
Import Error
↓
Rollback
↓
Error Report
```

---

# 28. Ergebnis Modul 3

Ergebnis ist nicht zwingend eine Datei.

Das Ergebnis kann sein:

```text
25.430 Datensätze importiert

17 aktualisiert

3 abgewiesen

0 technische Fehler
```

Dazu wird ein Import-Report erzeugt.

---

# 29. Modul 3 und AI

AI ist hier nur unterstützend.

Mögliche Funktionen:

```text
Zielschema verstehen

Mapping vorschlagen

Datentypkonflikte erklären

Importfehler analysieren

mögliche Regeln vorschlagen
```

Der eigentliche Datenbankimport bleibt vollständig deterministisch.

---

# 30. Modul 4 – Daten ausliefern / konvertieren

## 30.1 Zweck

Dieses Modul erzeugt aus vorhandenen Daten ein gewünschtes Ausgabeformat und liefert das Ergebnis optional an ein Ziel aus.

Das Modul dient insbesondere:

```text
Dateikonvertierung

Datenexport

Formatumwandlung

Dateierzeugung

Datenbereitstellung

Dateiübertragung
```

---

# 31. Unterstützte Input-Formate

Beispielsweise:

```text
CSV

Excel

JSON

XML

UniCom Dataset

Datenbankabfrage

Output Modul 2
```

---

# 32. Unterstützte Ausgabeformate

Initial:

```text
CSV

Excel XLSX

JSON

XML

TXT
```

Später:

```text
Parquet

PDF Reports

EDI

kundenspezifische Formate
```

---

# 33. Formatkonvertierung

Beispiele:

```text
Excel → CSV

CSV → JSON

JSON → XML

Datenbank → Excel

UniCom Dataset → CSV
```

---

# 34. Dateioptionen

Konfigurierbar:

```text
Delimiter

Encoding

Header

Quote Character

Decimal Separator

Date Format

Sheet Name

Dateiname

Dateiprefix

Timestamp im Dateinamen

Komprimierung
```

---

# 35. Auslieferung

Nach Erzeugung kann die Datei optional bereitgestellt werden über:

```text
lokales Verzeichnis

Netzwerkfreigabe

SFTP

FTPS

Download-Verzeichnis
```

---

# 36. Modul 4 Workflow

```text
START
  ↓
Input laden
  ↓
Zielformat laden
  ↓
Formatierungsregeln laden
  ↓
Output erzeugen
  ↓
Output validieren
  ↓
optional verschlüsseln
  ↓
optional komprimieren
  ↓
Zieldatei speichern
  ↓
optional übertragen
  ↓
Export Report
  ↓
COMPLETED
```

---

# 37. Ergebnis Modul 4

Beispiele:

```text
customers.csv

invoice_export.xlsx

orders.json
```

oder:

```text
Datei erfolgreich auf SFTP bereitgestellt.
```

Das Modul besitzt damit ein eigenständiges Endergebnis.

---

# 38. Module miteinander verbinden

Obwohl alle Module autonom sind, können sie miteinander verbunden werden.

Beispiel:

```text
Modul 1
Daten holen

↓ Ergebnis

Modul 2
Daten verarbeiten

↓ Ergebnis

Modul 3
Daten importieren
```

oder:

```text
Modul 1
Daten holen

↓

Modul 2
Daten konsolidieren

↓

Modul 4
Excel erzeugen

↓

SFTP-Auslieferung
```

---

# 39. Nicht alle Module sind notwendig

Beispiel A:

Kunde benötigt nur automatischen Download:

```text
Modul 1
```

Beispiel B:

Kunde bekommt CSV bereits lokal und möchte sie konsolidieren:

```text
Modul 2
```

Beispiel C:

Kunde besitzt bereits fertige Dateien und möchte sie regelmäßig in SQL importieren:

```text
Modul 3
```

Beispiel D:

Kunde möchte Datenbankdaten regelmäßig als Excel ausgeben:

```text
Modul 4
```

---

# 40. Modul-Pipelines

Mehrere Module können als Pipeline verbunden werden.

Beispiel:

```text
Pipeline:
Kundenimport

Step 1
Module: FETCH

Step 2
Module: PROCESS

Step 3
Module: IMPORT
```

Zweite Pipeline:

```text
Pipeline:
Monatlicher Kundenexport

Step 1
Module: PROCESS

Step 2
Module: DELIVER
```

---

# 41. Module besitzen eigene Jobs

Nicht:

```text
ein globaler UniCom Job
```

sondern:

```text
FetchJob

ProcessJob

ImportJob

DeliveryJob
```

---

# 42. Gemeinsames Job Interface

Alle Jobs implementieren:

```ts
interface UniComJob {
  id: string;
  moduleType: ModuleType;
  name: string;

  enabled: boolean;

  schedule?: ScheduleConfig;

  input: JobInput;

  output: JobOutput;

  execute(): Promise<JobResult>;
}
```

ModuleType:

```ts
type ModuleType =
  | "fetch"
  | "process"
  | "import"
  | "deliver";
```

---

# 43. Einheitliches Ergebnisobjekt

Jedes Modul erzeugt ein JobResult.

```ts
interface JobResult {
  jobId: string;
  runId: string;

  moduleType: ModuleType;

  status:
    | "completed"
    | "completed_with_warnings"
    | "failed";

  startedAt: Date;
  finishedAt: Date;

  artifacts: Artifact[];

  metrics: Record<string, number>;

  warnings: JobWarning[];
  errors: JobError[];
}
```

---

# 44. Artifacts

Module kommunizieren optional über Artifacts.

Beispiel Modul 1:

```text
ArtifactType:
FILE
```

Modul 2:

```text
ArtifactType:
DATASET
```

Modul 3:

```text
ArtifactType:
IMPORT_RESULT
```

Modul 4:

```text
ArtifactType:
FILE
```

---

# 45. Artifact-Modell

```ts
interface Artifact {
  id: string;

  type:
    | "file"
    | "dataset"
    | "import_result"
    | "report";

  location?: string;

  format?: string;

  schemaId?: string;

  createdByJob: string;

  checksum?: string;

  metadata: Record<string, unknown>;
}
```

Dadurch können Module lose gekoppelt bleiben.

---

# 46. LangGraph Architektur

LangGraph darf nicht einen einzigen großen Graph für alle vier Module erzwingen.

Stattdessen:

```text
UniCom Workflow Layer
│
├── FetchGraph
│
├── ProcessGraph
│
├── ImportGraph
│
└── DeliveryGraph
```

Optional zusätzlich:

```text
PipelineGraph
```

Dieser verbindet mehrere autonome Modul-Graphs.

---

# 47. FetchGraph

```text
START
↓
loadJob
↓
searchSource
↓
transfer
↓
decrypt
↓
verify
↓
storeResult
↓
END
```

Fast vollständig deterministisch.

---

# 48. ProcessGraph

```text
START
↓
loadInput
↓
detectFormat
↓
analyzeSchema
↓
known?
├─ YES
│
└─ NO → AI Schema Analyzer
↓
mapping
↓
transform
↓
merge
↓
validate
↓
storeDataset
↓
END
```

Hier liegt der größte AI-Anteil.

---

# 49. ImportGraph

```text
START
↓
loadInput
↓
connectDatabase
↓
loadTargetSchema
↓
mapping
↓
validate
↓
import
↓
verify
↓
commit
↓
createReport
↓
END
```

---

# 50. DeliveryGraph

```text
START
↓
loadInput
↓
loadOutputConfiguration
↓
convert
↓
validate
↓
encrypt optional
↓
compress optional
↓
store
↓
transfer optional
↓
createReport
↓
END
```

---

# 51. PipelineGraph

Der PipelineGraph orchestriert optional mehrere Module.

Beispiel:

```text
FetchGraph
↓
Artifact
↓
ProcessGraph
↓
Artifact
↓
ImportGraph
```

Der PipelineGraph besitzt selbst keine fachliche Datenverarbeitung.

Er koordiniert ausschließlich Module.

---

# 52. Fehlerverhalten in Pipelines

Jeder Schritt besitzt:

```text
onSuccess

onWarning

onFailure
```

Beispiel:

```text
Fetch erfolgreich
↓
Process starten
```

oder:

```text
Process fehlgeschlagen
↓
Import NICHT starten
```

Konfigurierbar:

```text
stop

continue

retry

manual review
```

---

# 53. Keine harte Abhängigkeit

Ein Modul darf nie voraussetzen:

```text
"Input muss aus einem anderen UniCom-Modul stammen."
```

Jeder Input muss auch extern bereitgestellt werden können.

---

# 54. Gemeinsame Plattformdienste

Folgende Dienste dürfen gemeinsam genutzt werden:

```text
Authentication

Authorization

Licensing

Scheduler

Secrets

Credentials

Logging

Audit

Notifications

AI Provider

LangGraph Persistence

Artifact Registry

Schema Registry

Mapping Registry

Rule Registry
```

---

# 55. Lizenzmodell

Module müssen unabhängig lizenzierbar sein.

Beispiel:

```text
UniCom Transfer
Modul 1

UniCom Process
Modul 2

UniCom Import
Modul 3

UniCom Delivery
Modul 4
```

Optional Bundles:

```text
Transfer + Process

Process + Import

Process + Delivery

Complete Suite
```

Die technische Architektur darf keine Complete-Suite-Lizenz voraussetzen.

---

# 56. UI Hauptnavigation

Empfohlene Hauptstruktur:

```text
Dashboard

Daten holen

Daten verarbeiten

Daten importieren

Daten ausliefern

Pipelines

Läufe

Fehler

Einstellungen
```

Nicht lizenzierte Module können:

```text
ausgeblendet
```

oder:

```text
mit Hinweis auf Erweiterung angezeigt
```

werden.

---

# 57. Modul Dashboard

Jedes Modul besitzt eine eigene Übersicht.

Beispiel Modul 1:

```text
Daten holen

Jobs
letzte Transfers
übertragene Dateien
Fehler
nächste Läufe
```

Modul 2:

```text
Daten verarbeiten

Verarbeitungsjobs
Datasets
Regeln
Mappings
Validierungsfehler
```

Modul 3:

```text
Daten importieren

Importjobs
Datenbanken
importierte Datensätze
Fehler
Rollback
```

Modul 4:

```text
Daten ausliefern

Exportjobs
erzeugte Dateien
Zielformate
Auslieferungen
```

---

# 58. AI Einsatz pro Modul

## Modul 1

AI möglichst nicht notwendig.

Optional:

```text
Fehlererklärung

Dateierkennung
```

## Modul 2

AI zentral.

```text
Schema

Mapping

Transformation

Fehleranalyse

Regelgenerierung
```

## Modul 3

AI unterstützend.

```text
Mapping

Schemaunterschiede

Importfehler
```

## Modul 4

AI optional.

```text
Formatmapping

Strukturinterpretation

Fehleranalyse
```

---

# 59. Wichtigste AI-Regel

Die AI darf keine Modulgrenzen verwischen.

Beispiel:

Wenn Modul 2 läuft, darf es nicht eigenständig entscheiden:

```text
"Ich importiere diese Daten jetzt in SQL."
```

Das wäre Aufgabe von Modul 3.

Ebenso darf Modul 1 Daten nicht fachlich verändern.

---

# 60. Klare Verantwortlichkeiten

```text
MODUL 1

Transportiert Daten.
```

```text
MODUL 2

Versteht, verändert und konsolidiert Daten.
```

```text
MODUL 3

Schreibt Daten in Zielsysteme.
```

```text
MODUL 4

Erzeugt und liefert Daten in gewünschten Ausgabeformaten.
```

Diese Trennung muss im Code konsequent erhalten bleiben.

---

# 61. Verbotene Modulabhängigkeiten

Nicht erlaubt:

```text
ProcessService importiert FetchService

ImportService setzt ProcessService voraus

DeliveryService ruft ImportService auf
```

Stattdessen erfolgt Kommunikation über:

```text
Artifact

JobInput

JobResult

Pipeline Orchestrator
```

---

# 62. Empfohlene Ordnerstruktur

```text
src/

  platform/
    auth/
    licensing/
    scheduler/
    audit/
    logging/
    artifacts/
    schemas/
    mappings/
    rules/
    ai/
    workflow/

  modules/

    fetch/
      domain/
      connectors/
      jobs/
      workflow/
      api/

    process/
      domain/
      parsers/
      transformation/
      validation/
      consolidation/
      ai/
      jobs/
      workflow/
      api/

    import/
      domain/
      database/
      adapters/
      jobs/
      workflow/
      api/

    delivery/
      domain/
      converters/
      destinations/
      jobs/
      workflow/
      api/

  pipelines/
    domain/
    workflow/
    execution/

  ui/
```

---

# 63. Separate Modul-APIs

Beispielsweise:

```text
/api/fetch/jobs

/api/process/jobs

/api/import/jobs

/api/delivery/jobs

/api/pipelines
```

Auch API-seitig bleiben die Module getrennt.

---

# 64. Definition of Done – modulare Architektur

Die modulare Architektur gilt als umgesetzt, wenn:

* jedes der vier Module unabhängig startbar ist
* jedes Modul eigene Jobs besitzt
* jedes Modul einen eigenständigen Input akzeptiert
* jedes Modul ein eigenständiges Ergebnis erzeugt
* kein Modul ein anderes Modul technisch voraussetzt
* Module über Artifacts verbunden werden können
* Pipelines mehrere Module optional verbinden können
* jedes Modul separat lizenzierbar ist
* die UI Module separat darstellen kann
* LangGraph pro Modul eigene Workflows besitzt
* AI nur innerhalb der fachlichen Zuständigkeit eines Moduls arbeitet
* Modul 2 der primäre Intelligence Layer für Datenanalyse und Konsolidierung bleibt
* Modul 3 Daten ausschließlich in Zielsysteme importiert
* Modul 4 Dateien bzw. Datenformate erzeugt und ausliefert
* Modul 1 ausschließlich für Datentransfer verantwortlich bleibt

---

# 65. Zentrale Architekturregel

Bei allen zukünftigen Erweiterungen gilt:

> **Jedes UniCom-Modul muss allein einen geschäftlichen Nutzen liefern können.**

Die Module dürfen zusammenarbeiten, aber niemals voneinander abhängig werden.

Zusätzlich gilt:

> **Module erledigen Fachaufgaben.
> Artifacts verbinden Module.
> Pipelines orchestrieren Module.
> LangGraph orchestriert Workflows innerhalb der Module.
> AI unterstützt Entscheidungen.
> Die UniCom Engine führt deterministisch aus.**

---

# 66. Kurzbeschreibung der vier Produkte

## UniCom Transfer

> Automatisiertes und sicheres Abholen und Übertragen von Dateien und Daten.

---

## UniCom Process

> Daten analysieren, bereinigen, transformieren, zusammenführen und konsolidieren.

---

## UniCom Import

> Strukturierte Daten sicher und automatisiert in Datenbanken und Zielsysteme übernehmen.

---

## UniCom Delivery

> Daten in gewünschte Formate konvertieren, Dateien erzeugen und automatisiert bereitstellen oder ausliefern.
