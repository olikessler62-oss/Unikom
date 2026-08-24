# UniCom – Spezifikation für den zentral verwalteten, automatisch aktualisierbaren Local Connector

## 1. Ziel

UniCom soll als zentrale Webanwendung auf einem UniCom-Server betrieben werden können, während Dateien und gegebenenfalls die gesamte Datenverarbeitung auf dem Rechner bzw. im Netzwerk des Kunden verbleiben.

Dafür wird ein **UniCom Local Connector** eingeführt.

Der Connector läuft beim Kunden als Windows Service und stellt die sichere Verbindung zwischen der zentralen UniCom-Anwendung und der lokalen Infrastruktur des Kunden her.

Der Kunde soll den Connector **nicht manuell pflegen müssen**.

Insbesondere müssen:

* neue Versionen automatisch erkannt werden
* Bugfixes automatisch verteilt werden können
* laufende Jobs niemals durch ein Update unterbrochen werden
* fehlerhafte Updates automatisch erkannt werden
* ein automatischer Rollback auf die vorherige funktionierende Version möglich sein
* der Administrator zentral erkennen können, welche Connector-Version bei welchem Mandanten installiert ist

---

## 2. Grundarchitektur

```text
                         UNICom Server
                  ┌────────────────────────┐
                  │                        │
                  │ Web Application        │
                  │ REST API               │
                  │ Job Management         │
                  │ Tenant Management      │
                  │ Connector Management   │
                  │ Version Management     │
                  │ Update Repository      │
                  │                        │
                  └───────────┬────────────┘
                              │
                       HTTPS / Secure
                              │
                              ▼
                  ┌────────────────────────┐
                  │   UniCom Local         │
                  │   Connector            │
                  │                        │
                  │ Windows Service         │
                  │ Update Manager          │
                  │ Job Executor            │
                  │ File Access             │
                  │ FTP/SFTP                │
                  │ Local Processing       │
                  │ Health Monitor          │
                  └───────────┬────────────┘
                              │
              ┌───────────────┼────────────────┐
              │               │                │
              ▼               ▼                ▼
        Lokale Ordner     Fileserver          NAS
        C:\...            \\SERVER\...        \\NAS\...
```

---

## 3. Grundprinzip

Der Local Connector wird **nicht als eigenständiges, dauerhaft manuell zu wartendes Produkt** betrachtet.

Er wird zentral durch UniCom verwaltet.

Der Connector meldet sich regelmäßig beim UniCom Server und übermittelt mindestens:

* Mandanten-ID
* Connector-ID
* aktuelle Version
* Betriebssystem
* Architektur
* Status
* letzter Kontakt
* laufende Jobs
* Update-Status
* Health-Status

Der UniCom Server kann dadurch jederzeit feststellen:

```text
Mandant A     Connector 1.4.3     AKTUELL
Mandant B     Connector 1.4.2     UPDATE VERFÜGBAR
Mandant C     Connector 1.3.8     VERALTET
```

---

## 4. Trennung von Bootstrapper und Runtime

Der Connector wird aus zwei logischen Komponenten aufgebaut.

### 4.1 Stable Bootstrapper / Service

Der Bootstrapper ist die möglichst stabile Komponente.

Aufgaben:

* Windows Service
* Starten der Runtime
* Kommunikation mit UniCom Server
* Update-Prüfung
* Download neuer Versionen
* Signaturprüfung
* Aktivierung neuer Versionen
* Health Check
* Rollback
* Überwachung der Runtime

Der Bootstrapper soll möglichst selten geändert werden.

### 4.2 UniCom Runtime

Die Runtime enthält die eigentliche Funktionalität:

* File Access
* FTP
* FTPS
* SFTP
* lokale Verarbeitung
* Consolidation
* Mapping
* Validation
* Export
* Job Execution

Die Runtime kann unabhängig vom Bootstrapper aktualisiert werden.

---

## 5. Installationsstruktur

Beispiel:

```text
C:\Program Files\UniCom\
│
├── Bootstrapper\
│   └── UniComConnectorService.exe
│
├── Runtime\
│   ├── 1.4.2\
│   ├── 1.4.3\
│   └── current
│
├── Update\
│
├── Logs\
│
└── Config\
```

`current` verweist auf die aktuell aktive Runtime.

Beispiel:

```text
current → Runtime\1.4.3
```

Die vorherige Version bleibt zunächst erhalten.

---

## 6. Update-Erkennung

Der Connector fragt regelmäßig beim Server nach einer neuen Version.

Beispiel:

```http
GET /api/connector/update
```

Antwort:

```json
{
  "currentVersion": "1.4.2",
  "availableVersion": "1.4.3",
  "updateRequired": true,
  "downloadUrl": "...",
  "sha256": "...",
  "signature": "...",
  "minimumBootstrapperVersion": "1.2.0"
}
```

Die genaue API-Struktur soll erst während der Implementierung festgelegt werden.

---

## 7. Update-Phasen

Ein Update durchläuft folgende Zustände:

```text
AVAILABLE
    ↓
DOWNLOADING
    ↓
DOWNLOADED
    ↓
VERIFYING
    ↓
VERIFIED
    ↓
WAITING_FOR_IDLE
    ↓
INSTALLING
    ↓
HEALTH_CHECK
    ↓
ACTIVE
```

Bei einem Fehler:

```text
ERROR
   ↓
ROLLBACK
   ↓
PREVIOUS_VERSION_ACTIVE
```

---

## 8. Signaturprüfung

Eine heruntergeladene Runtime darf niemals ungeprüft ausgeführt werden.

Vor der Aktivierung müssen mindestens geprüft werden:

1. Hash
2. digitale Signatur
3. erwartete Version
4. Paketstruktur
5. Kompatibilität mit dem vorhandenen Bootstrapper

Ein manipuliertes oder beschädigtes Paket wird verworfen.

Beispiel:

```text
Download
   ↓
SHA-256 prüfen
   ↓
Signatur prüfen
   ↓
Version prüfen
   ↓
OK → installieren
FEHLER → verwerfen
```

---

## 9. Update niemals während eines laufenden Jobs

Das ist eine harte Systemregel.

Wenn:

```text
Job Status = RUNNING
```

darf die Runtime nicht ersetzt werden.

Stattdessen:

```text
Neue Version verfügbar
        ↓
Job läuft
        ↓
Update wartet
        ↓
Job beendet
        ↓
Connector wird idle
        ↓
Update
```

Damit wird verhindert, dass ein Update einen Datenverarbeitungsvorgang unterbricht.

---

## 10. Update-Fenster

Optional soll der Mandant eine Update Policy erhalten.

Mögliche Einstellungen:

### Automatisch

```text
Update automatisch installieren,
sobald kein Job läuft.
```

### Automatisch innerhalb eines Zeitfensters

Beispiel:

```text
22:00 – 05:00 Uhr
```

### Nach Freigabe

Der Server meldet:

```text
Update 1.4.3 verfügbar
```

Der Kunde muss die Aktivierung freigeben.

### Manuell

Updates werden ausschließlich durch den Kundenadministrator aktiviert.

---

## 11. Rollback

Die vorherige funktionierende Version muss nach einem Update zunächst erhalten bleiben.

Beispiel:

```text
Runtime
├── 1.4.2
├── 1.4.3
└── current → 1.4.3
```

Nach Aktivierung von 1.4.3 wird ein Health Check durchgeführt.

Wenn der Health Check fehlschlägt:

```text
1.4.3
 ↓
Health Check FAILED
 ↓
current → 1.4.2
 ↓
Restart
```

Der Server erhält:

```json
{
  "status": "rollback",
  "failedVersion": "1.4.3",
  "activeVersion": "1.4.2"
}
```

---

## 12. Health Check

Nach jedem Update muss ein automatischer Health Check durchgeführt werden.

Mindestens:

* Prozess startet
* Runtime antwortet
* Kommunikation mit Server funktioniert
* Konfiguration kann gelesen werden
* notwendige lokale Ressourcen sind verfügbar
* grundlegende File-Operation kann geprüft werden
* Runtime-Version stimmt

Optional:

```text
Test Read
Test Write
Test Delete
Test Server Connection
Test FTP/SFTP Connection
```

Keine produktiven Kundendaten dürfen für einen Health Check verändert oder gelöscht werden.

---

## 13. Schutz vor Update-Schleifen

Der Connector darf nicht endlos versuchen, eine fehlerhafte Version zu installieren.

Beispiel:

```text
1.4.2 → 1.4.3
          ↓
       Fehler
          ↓
       Rollback
          ↓
1.4.2 bleibt aktiv
```

Der Server markiert 1.4.3 für diesen Connector als fehlgeschlagen.

Der Connector versucht nicht bei jedem Neustart erneut automatisch dieselbe Version zu installieren.

---

## 14. Zentrale Connector-Verwaltung

Im UniCom-Adminbereich soll ein Bereich:

**Administration → Connectoren**

implementiert werden.

Dort:

| Mandant | Connector | Version | Status      | Letzter Kontakt |
| ------- | --------- | ------- | ----------- | --------------- |
| Kunde A | PC-01     | 1.4.3   | 🟢 Online   | vor 2 Min.      |
| Kunde B | SERVER-01 | 1.4.2   | 🟠 Update   | vor 5 Min.      |
| Kunde C | SERVER-02 | 1.3.9   | 🔴 Veraltet | vor 2 Tagen     |

---

## 15. Connector Status

Folgende Status sollen unterstützt werden:

```text
ONLINE
OFFLINE
UPDATE_AVAILABLE
UPDATING
UPDATE_FAILED
ROLLBACK
OUTDATED
ERROR
DISABLED
```

---

## 16. Versionsregeln

Der UniCom Server definiert die aktuell freigegebene Version.

Beispiel:

```text
Current Stable:
1.4.3
```

Optional können mehrere Release Channels existieren:

```text
STABLE
BETA
DEVELOPMENT
```

Standardmäßig verwendet jeder Kunde:

```text
STABLE
```

---

## 17. Kritische Updates

Der Server kann ein Update als kritisch markieren.

Beispiel:

```json
{
  "version": "1.4.4",
  "severity": "CRITICAL",
  "mandatory": true
}
```

Bei einem kritischen Security-Fix kann der Server verlangen:

```text
Update erforderlich
```

Normale Bugfixes bleiben optional bzw. folgen der Update Policy des Mandanten.

---

## 18. Offline-Kunden

Der Connector muss auch mit längeren Offline-Zeiten umgehen können.

Beispiel:

```text
Kunde ist 14 Tage offline
        ↓
Connector läuft weiter
        ↓
Kunde geht online
        ↓
Connector meldet sich
        ↓
Version prüfen
        ↓
Update installieren
```

Der Server darf nicht davon ausgehen, dass ein Connector permanent online ist.

---

## 19. Netzwerkverbindung

Der Connector soll grundsätzlich eine **ausgehende Verbindung** zum UniCom Server verwenden.

Es soll möglichst keine eingehende Firewall-Freigabe beim Kunden erforderlich sein.

Bevorzugt:

```text
Kunde → HTTPS → UniCom Server
```

Nicht:

```text
UniCom Server → Kunde
```

Dadurch wird die Installation in Kundennetzwerken wesentlich einfacher.

---

## 20. Sicherheit

Der Connector muss eindeutig einem Mandanten zugeordnet sein.

Bei der Registrierung wird ein eindeutiger Connector Identity Key erzeugt.

Beispiel:

```text
Tenant ID
Connector ID
Credential
```

Die Kommunikation erfolgt ausschließlich verschlüsselt.

Der Connector darf nur auf Ressourcen zugreifen, die der Kunde bei der Installation bzw. Konfiguration ausdrücklich freigegeben hat.

---

## 21. Lokale Dateiberechtigungen

Der Windows Service darf nicht automatisch Vollzugriff auf den gesamten Rechner erhalten.

Stattdessen sollen die benötigten Ordner explizit konfiguriert werden.

Beispiel:

```text
Erlaubte Pfade:

C:\UniCom\Data
C:\UniCom\Export
\\SERVER01\Import
```

Nicht:

```text
C:\
```

---

## 22. Audit Logging

Alle relevanten Update-Vorgänge müssen protokolliert werden.

Beispiel:

```text
2026-08-24 02:14
Update available: 1.4.3

2026-08-24 02:15
Download started

2026-08-24 02:15
Signature verified

2026-08-24 02:16
Waiting for active jobs

2026-08-24 02:48
No active jobs

2026-08-24 02:49
Runtime 1.4.3 activated

2026-08-24 02:49
Health check successful
```

---

## 23. Fehlerfall

Beispiel:

```text
1.4.2 aktiv
     ↓
1.4.3 verfügbar
     ↓
Download
     ↓
Installation
     ↓
Health Check
     ↓
FEHLER
     ↓
Rollback
     ↓
1.4.2 aktiv
     ↓
Server erhält Fehlerbericht
```

Der Administrator sieht:

```text
Kunde B

Aktive Version: 1.4.2
Update: 1.4.3 fehlgeschlagen
Rollback: erfolgreich
Status: UPDATE_FAILED
```

---

## 24. Kein Zwang zur permanenten Datenübertragung

Der Connector soll grundsätzlich auch Jobs ausführen können, bei denen die eigentlichen Dateien vollständig lokal bleiben.

Beispiel:

```text
FTP
 ↓
lokale Datei
 ↓
Consolidation
 ↓
lokale Datei
```

Der UniCom Server erhält lediglich Metadaten:

```text
Job-ID
Status
Start
Ende
Dateianzahl
Datensatzanzahl
Fehler
```

Ob und welche Nutzdaten an den Server übertragen werden, muss pro Mandant konfigurierbar sein.

---

## 25. Architekturprinzip

Die zentrale UniCom-Anwendung soll für den Kunden möglichst vollständig webbasiert sein.

Der Kunde benötigt lediglich:

```text
Browser
+
UniCom Local Connector
```

Dadurch entsteht:

```text
                 Browser
                    │
                    ▼
              UniCom Cloud
                    │
              Job / Command
                    │
                    ▼
             Local Connector
                    │
                    ▼
             Kundensysteme
```

---

## 26. Zukunftssicherheit

Der Connector soll von Anfang an so entwickelt werden, dass später weitere lokale Ressourcen eingebunden werden können:

```text
Local Files
Network Shares
FTP
FTPS
SFTP
SQL Server
Oracle
ODBC
REST APIs
ERP-Systeme
Scanner-Verzeichnisse
```

Die Connector-Architektur soll daher modular aufgebaut werden.

Beispiel:

```text
Connector
│
├── File Provider
├── Network Provider
├── FTP Provider
├── SFTP Provider
├── Database Provider
└── API Provider
```

---

## 27. MVP

Für die erste Version soll nur Folgendes implementiert werden:

### Server

* Connector Registry
* Connector Authentication
* Versionsverwaltung
* Update Repository
* Update Status
* Connector Dashboard

### Local Connector

* Windows Service
* sichere Verbindung zum Server
* Connector Registration
* Heartbeat
* Version Reporting
* Update Check
* Download
* Hash-Prüfung
* Signaturprüfung
* Installation
* Health Check
* Rollback
* Logging

### Lokale Ressourcen

* lokale Verzeichnisse
* UNC-Netzwerkpfade

FTP/SFTP und weitere Provider bleiben unabhängig vom Update-System erweiterbar.

---

## 28. Wichtigste technische Leitlinie

Der Connector darf niemals zu einem zweiten vollständigen UniCom-System werden.

Die Architektur soll stattdessen sein:

```text
UNICom Cloud
    =
Steuerung
Konfiguration
Mandanten
Jobs
Administration
Monitoring
```

und:

```text
UNICom Connector
    =
lokaler Zugriff
lokale Ausführung
lokale Daten
sichere Kommunikation
Updates
```

---

## 29. Zielzustand

Der Kunde installiert UniCom einmal.

Danach soll der normale Betrieb so aussehen:

```text
Installation
     ↓
Connector registrieren
     ↓
Ordner / Ressourcen freigeben
     ↓
UniCom konfigurieren
     ↓
Normalbetrieb
     ↓
UniCom veröffentlicht Bugfix
     ↓
Connector erkennt Update
     ↓
wartet auf Job-Ende
     ↓
Update
     ↓
Health Check
     ↓
neue Version aktiv
```

**Der Kunde muss bei einem normalen Bugfix nichts tun.**

Nur bei bewusst aktivierter manueller Update Policy oder bei einem Fehler soll die Kunden-IT eingreifen müssen.

---

## 30. Akzeptanzkriterien

Die Implementierung gilt als erfolgreich, wenn folgende Szenarien funktionieren:

* [ ] Kunde installiert Connector 1.0.0.
* [ ] Connector registriert sich automatisch am UniCom Server.
* [ ] Server erkennt Connector 1.0.0.
* [ ] Server stellt Version 1.0.1 bereit.
* [ ] Connector erkennt 1.0.1 automatisch.
* [ ] Connector lädt das Update herunter.
* [ ] Hash und Signatur werden geprüft.
* [ ] Laufende Jobs werden nicht unterbrochen.
* [ ] Update wird nach Job-Ende installiert.
* [ ] Health Check wird ausgeführt.
* [ ] Version 1.0.1 wird aktiviert.
* [ ] Version 1.0.0 bleibt als Rollback-Version erhalten.
* [ ] Ein absichtlich fehlerhaftes Update führt zu einem automatischen Rollback.
* [ ] Der Server erkennt den Rollback.
* [ ] Der Connector meldet seine aktive Version.
* [ ] Ein längerer Offline-Zeitraum führt nicht zu einem Fehlerzustand.
* [ ] Nach Wiederherstellung der Verbindung wird ein verfügbares Update erkannt.
* [ ] Der Kunde benötigt für einen normalen Bugfix keine manuelle Installation.
* [ ] Lokale Dateien können verarbeitet werden, ohne dass sie zwingend auf den UniCom Server übertragen werden.
* [ ] Der Connector benötigt keine eingehende Firewall-Freigabe.

---

## 31. Empfohlene Bezeichnung

Intern:

**UniCom Local Connector**

Produktseitig eventuell:

**UniCom Connect**

Das ist bewusst besser als „UniCom Client", weil der Connector nicht die eigentliche UniCom-Anwendung darstellt, sondern die **Brücke zwischen UniCom Cloud und der Infrastruktur des Kunden**.
