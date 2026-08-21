SPEC-01 — UniCom Gesamtarchitektur & Verarbeitungsplattform

Status: FINAL
Version: 1.4
Gültigkeit: UniCom V1
Betriebsmodell V1: On-Premise
Cloud: Architektonisch berücksichtigen, aber nicht Bestandteil der V1-Implementierung

1. Zweck

UniCom ist eine lokal beim Kunden betriebene, modulare Datenintegrations- und Datenverarbeitungsplattform.

Die drei Kernmodule sind:

Daten übertragen
Daten konsolidieren
Daten exportieren / importieren

Die Module müssen unabhängig voneinander, in Kombination oder als vollständiger Workflow betrieben werden können.

Mögliche Kombinationen:

Modul 1
Daten übertragen
      ↓
Modul 2
Daten konsolidieren
      ↓
Modul 3
Daten exportieren / importieren

aber auch:

Modul 1 → Modul 3

oder:

Modul 2 → Modul 3

oder einzelne Module vollständig unabhängig.

2. Grundprinzip der Architektur

UniCom V1 wird als lokale Webanwendung mit lokaler Verarbeitungsengine realisiert.

Der Browser dient ausschließlich als Benutzeroberfläche.

Die eigentliche Verarbeitung erfolgt außerhalb des Browsers.

┌─────────────────────────────┐
│         Browser / UI        │
│                             │
│ React / TypeScript          │
└─────────────┬───────────────┘
              │
         HTTP API
              │
              ▼
┌─────────────────────────────┐
│     UniCom Application      │
│                             │
│ Workflow / Job Management   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│     UniCom Processing       │
│          Worker             │
│                             │
│ Daten übertragen            │
│ Daten konsolidieren         │
│ Daten exportieren/importieren│
└─────────────┬───────────────┘
              │
       ┌──────┴───────┐
       ▼              ▼
    SQLite           JSON

Die fachlichen Verarbeitungskomponenten müssen UI-unabhängig arbeiten.

3. Betriebsmodell V1 — On-Premise

UniCom V1 wird vollständig beim Kunden betrieben.

Alle für die Verarbeitung erforderlichen Komponenten befinden sich in der lokalen Umgebung des Kunden.

Dazu gehören insbesondere:

UniCom Application
Processing Worker
Notification Agent
SQLite-Datenbank
JSON-Konfigurationen
Logs
Verarbeitungsinformationen
temporäre Dateien
interne Archive

Die Kundendaten verlassen die lokale Umgebung nicht, sofern der Kunde selbst eine externe Datenquelle oder ein externes Datenziel konfiguriert.

Cloud

Eine spätere Cloud-Betriebsvariante wird architektonisch berücksichtigt, ist jedoch nicht Bestandteil von UniCom V1.

Die fachliche Verarbeitung soll so gekapselt sein, dass eine spätere Cloud-Variante grundsätzlich möglich ist, ohne die fachliche Engine neu entwickeln zu müssen.

Cloud-spezifische Funktionen, Infrastruktur und Datenschutzanforderungen sind nicht Bestandteil dieser V1-Spec.

4. Module
4.1 Daten übertragen

Dient der Beschaffung bzw. Bereitstellung von Dateien.

Mögliche Quellen und Ziele können insbesondere sein:

lokales Verzeichnis
Netzwerkfreigabe
FTP
FTPS
SFTP

Die genaue Funktionalität wird in der jeweiligen Modul-Spec definiert.

4.2 Daten konsolidieren

Dient der:

Erkennung von Dateistrukturen
Erkennung von Feldern
Erkennung von Datentypen
Normalisierung
Korrektur
Ergänzung
Zuordnung
Mapping
Duplikaterkennung
Zusammenführung
Konfliktbehandlung
Erstellung eines konsolidierten Datenbestands

Die detaillierte fachliche Definition erfolgt in SPEC-02 ff.

4.3 Daten exportieren / importieren

Dient der Ausgabe bzw. Übernahme der konsolidierten Daten.

Mögliche Formate und Ziele werden in der entsprechenden Modul-Spec definiert.

Die endgültige Zieldatenstruktur gehört zum Modul Daten exportieren/importieren und nicht zur Eingangsstruktur des Konsolidierungsmoduls.

5. Entkopplung der Module

Kein Modul darf zwingend von einem anderen Modul abhängig sein.

Ein Modul darf jedoch das Ergebnis eines anderen Moduls als Eingabe verwenden.

Beispiel:

Daten übertragen
       │
       ▼
Zielverzeichnis
       │
       ▼
Daten konsolidieren
       │
       ▼
Ergebnis
       │
       ▼
Daten exportieren

Die Herkunft einer Datei darf dabei für das nachfolgende Modul keine zwingende Voraussetzung sein.

Das Konsolidierungsmodul arbeitet mit einer definierten Datenquelle, unabhängig davon, ob diese Datei durch Modul 1 bereitgestellt oder anderweitig in das Eingangsverzeichnis gelangt ist.

6. Datenquellen und Datenziele

UniCom abstrahiert Datenquellen und Datenziele.

Eine Datenquelle kann beispielsweise sein:

lokales Verzeichnis
Netzwerkfreigabe
SFTP
FTPS
FTP
manuell ausgewählte Datei

Die konkrete Unterstützung wird durch die jeweiligen Module definiert.

Bei On-Premise-Betrieb kann UniCom auf lokale Dateien und Verzeichnisse zugreifen, sofern die erforderlichen Berechtigungen vorhanden sind.

7. Originaldateien

Originaldateien sind grundsätzlich unveränderbar.

Eine Originaldatei darf durch die Konsolidierung niemals überschrieben oder verändert werden.

Der Verarbeitungsprozess arbeitet stattdessen mit einem separaten Arbeitsbestand.

Grundprinzip:

Original
   │
   ├── bleibt unverändert
   │
   ▼
Arbeitsbestand
   │
   ├── erfolgreiche Datensätze
   │
   └── Konfliktdatensätze
8. Verarbeitungslauf und Verarbeitungs-ID

Jede Verarbeitung erhält eine eindeutige Verarbeitungs-ID.

Format:

RUN-JJJJ-MM-TT-NNNNNN

Beispiel:

RUN-2026-08-19-000471

Das Datum im Namen macht ein Protokoll auch dann lesbar, wenn die Datenbank gerade nicht zur Hand ist.

Die Verarbeitungs-ID identifiziert einen vollständigen Verarbeitungslauf.

Sie wird für:

Status
Logging
Fehler
Warnungen
Konflikte
Benutzerentscheidungen
Benachrichtigungen
Ergebnisse
Historie

verwendet.

9. Folge- und Konfliktverarbeitungen

Eine nachträgliche Verarbeitung bearbeiteter Konfliktdatensätze ist kein Bestandteil des ursprünglichen Verarbeitungslaufs.

Sie erzeugt einen neuen Verarbeitungslauf mit eigener Verarbeitungs-ID.

Zusätzlich wird die ursprüngliche Verarbeitungs-ID referenziert.

Beispiel:

Verarbeitung 001
       │
       └── Konflikte
              │
              ▼
       Benutzerbearbeitung
              │
              ▼
Verarbeitung 002
Vorgänger = 001

Dadurch bleibt jeder Verarbeitungslauf vollständig nachvollziehbar.

Mehrere Folgegenerationen sind grundsätzlich möglich:

001
 ↓
002
 ↓
003
10. Konfigurations-Snapshot

Zu Beginn eines Verarbeitungslaufs wird die zu diesem Zeitpunkt gültige Konfiguration als Snapshot übernommen.

Der Verarbeitungslauf arbeitet ausschließlich mit diesem Snapshot.

Änderungen an Einstellungen während einer laufenden Verarbeitung dürfen den laufenden Verarbeitungslauf nicht beeinflussen.

Damit gilt:

Konfiguration Version 1
          │
          ▼
Verarbeitung 001

Wird später die Konfiguration geändert:

Konfiguration Version 2
          │
          ▼
Verarbeitung 002
11. Speicherung — SQLite führt, JSON leitet aus

UniCom verwendet für V1 SQLite als führenden Speicher. JSON ist das Format der
Ausleitung und des Imports, nicht der Haltung.

**Entschieden am 19.08.2026** (FR_006 Bauplan, Abschnitt 2). Der Grund ist die
Sicherung: `VACUUM INTO` erfasst die Datenbank vollständig, Dateien daneben
nicht. Zwei Speicherorte hätten zwei Sicherungswege bedeutet — und einer davon
wäre irgendwann nicht mitgelaufen, ohne dass es jemandem aufgefallen wäre. Es
ist zugleich die Regel, die im Haus schon gilt: Workflows, Mandanten, Zugänge
und der Konfliktbestand liegen ebenso.

Was Abschnitt 11.1 aufzählt, bleibt damit vollständig gültig — es steht nur in
SQLite statt in Dateien, und es ist als JSON ausleitbar und importierbar
(SPEC-05 §11).

11.1 Definitionen

Als Dokument in SQLite gehalten, als JSON aus- und einleitbar.

Dazu gehören insbesondere:

globale Einstellungen
Mandanteneinstellungen
Konsolidierungseinstellungen
Eingangsstrukturen
Felddefinitionen
Dateiformatdefinitionen
Mapping-Definitionen
Zuordnungsregeln
Dateinamensregeln
Wildcard-Regeln
sonstige fachliche Konfigurationen
11.2 SQLite

SQLite enthält die tatsächlichen Betriebs- und Verarbeitungsinformationen.

Dazu gehören insbesondere:

Verarbeitungs-ID
Vorgänger-Verarbeitungs-ID
Workflow-/Jobinformationen
Status
Startzeit
Endzeit
Fortschritt
Datensatzstatistiken
Konflikte
Benutzerentscheidungen
Fehler
Warnungen
Benachrichtigungen
Heartbeats
Verarbeitungshistorie
Verarbeitungsevents

Grundregel:

JSON beschreibt, wie UniCom arbeiten soll. SQLite beschreibt, was tatsächlich passiert ist.

12. Verzeichnisstruktur

UniCom trennt Programmdateien von internen Daten.

Das Datenverzeichnis ist einstellbar (UNIKOM_DATA_DIRECTORY). Voreingestellt ist der auf dem jeweiligen System übliche Ort:

Windows     %ProgramData%\UniCom
Linux       /var/lib/unikom
macOS       ~/Library/Application Support/UniCom

In der Entwicklung liegt es als application-data neben dem Programm.

Ein fester Pfad wäre selbst eine Plattformabhängigkeit; die fachliche Verarbeitung kennt nur „das Datenverzeichnis".

Aufbau:

<Datenverzeichnis>\
│
├── unikom.db                  die Datenbank
├── unikom.db-wal              Write-ahead-Log
├── unikom.db-shm              gemeinsamer Speicher der Zugänge
│
├── hauptschluessel.*          der verwahrte Hauptschlüssel
│
├── config\
│   ├── global\
│   └── tenants\
│
├── staging\                   Arbeitsbestände laufender Übertragungen
│
├── processing\
│   └── <Verarbeitungs-ID>\
│
├── logs\
│
├── archive\
│
├── conflicts\                 ausgeleitete Konfliktdateien
│
├── temp\
│
└── backups\

Die Verzeichnisse entstehen, sobald das Modul sie zum ersten Mal braucht. Der Benutzer legt nichts von Hand an.

Die eigentlichen Kundendateien liegen außerhalb dieses Bereichs, in den vom Kunden definierten Quell- und Zielverzeichnissen.

12.1 Das Datenverzeichnis muss auf einer lokalen Platte liegen

Weder eine Netzwerkfreigabe (\\Server\Freigabe) noch ein verbundenes Netzlaufwerk ist zulässig.

SQLite verlässt sich beim gleichzeitigen Zugriff auf Dateisperren. Über SMB und NFS sind die unzuverlässig: Zwei Beteiligte können gleichzeitig glauben, die Sperre zu halten. Das geht lange gut und beschädigt die Datenbank dann auf einmal — bemerkt wird es erst viel später, wenn niemand mehr weiß, wann es passiert ist.

UniCom prüft das beim Start und verweigert den Dienst, bevor es irgendetwas anlegt.

Das betrifft ausschließlich das Datenverzeichnis. Quellen, Ziele und Archivverzeichnisse der Übertragung dürfen weiterhin auf Freigaben liegen; dafür ist UniCom da.

Unter Linux und macOS lässt sich ein eingehängtes Netzdateisystem am Pfad nicht erkennen. Dort gilt die Regel trotzdem und liegt in der Verantwortung dessen, der das Datenverzeichnis einstellt.

12.2 Sicherung

Die Datenbank besteht aus drei Dateien, und der jüngste Stand steht meist im Write-ahead-Log und nicht in der .db. Wer nur die .db kopiert, sichert den älteren Teil und merkt es erst, wenn er die Sicherung braucht.

Gesichert wird deshalb über VACUUM INTO. Das schreibt im laufenden Betrieb einen in sich stimmigen Stand in eine einzige Datei, ohne die Verarbeitung anzuhalten.

Ziel ist backups\ im Datenverzeichnis, sofern nichts anderes angegeben ist.

13. Background Worker

Der Background Worker ist ein eigenständiger TypeScript-/Node.js-Prozess.

Er ist vollständig unabhängig vom geöffneten Browser.

Er übernimmt unter anderem:

geplante Verarbeitung
Workflow-Ausführung
Datenverarbeitung
Statusaktualisierung
Logging
Fehler-/Konfliktbehandlung
Benachrichtigungsereignisse

Die fachliche Engine darf nicht von der Benutzeroberfläche abhängig sein.

14. Jobstatus

Jeder Verarbeitungslauf besitzt einen persistenten Status.

Mindestens vorgesehen:

QUEUED
RUNNING
WAITING_FOR_USER
WAITING_FOR_RELEASE
COMPLETED
COMPLETED_WITH_WARNINGS
COMPLETED_WITH_CONFLICTS
FAILED
INTERRUPTED
CANCELLED

WAITING_FOR_RELEASE bedeutet: die Verarbeitung ist durchgelaufen, das Ergebnis ist aber noch nicht freigegeben (SPEC-08, Abschnitt 13).

Ein solcher Lauf gilt nicht als abgeschlossen. Sein Ergebnis darf von Modul 3 nicht übernommen werden.

Die genaue Verwendung einzelner Status kann in den Modul-Specs erweitert bzw. konkretisiert werden.

15. Heartbeat und Prozessüberwachung

Der Worker aktualisiert regelmäßig einen Heartbeat.

Dadurch kann UniCom erkennen, wenn ein laufender Prozess unerwartet beendet wurde.

Beispielsweise:

RUNNING
   │
   ├── Heartbeat vorhanden → läuft
   │
   └── Heartbeat fehlt → möglicherweise unterbrochen

Ein unerwartet beendeter Verarbeitungslauf wird als:

INTERRUPTED

erkannt.

Ein Neustart des Rechners darf nicht dazu führen, dass eine Verarbeitung fälschlicherweise als erfolgreich abgeschlossen betrachtet wird.

16. HTTP API

Die Kommunikation zwischen Benutzeroberfläche und UniCom Application erfolgt über eine HTTP API.

Sie wird unter anderem verwendet für:

Starten von Verarbeitungen
Abfragen von Verarbeitungsstatus
Abbrechen von Verarbeitungen
Abrufen von Ergebnissen
Abrufen von Konflikten
Bearbeiten von Benutzerentscheidungen
Abrufen von Benachrichtigungen

Die genaue API-Spezifikation ist Bestandteil der technischen Implementierungsspezifikation.

17. Server-Sent Events (SSE)

Für Live-Informationen aus laufenden Verarbeitungen wird SSE (Server-Sent Events) verwendet.

Der Server kann damit Ereignisse aktiv an die geöffnete Weboberfläche senden.

Beispiele:

PROCESSING_STARTED
STEP_STARTED
PROGRESS_CHANGED
CONFLICT_FOUND
WARNING
ERROR
STEP_COMPLETED
PROCESSING_COMPLETED

SSE dient ausschließlich der Live-Kommunikation mit der Oberfläche.

Der persistente Status wird unabhängig davon in SQLite gespeichert.

Wenn der Browser geschlossen wird, läuft die Verarbeitung weiter.

18. Verhalten bei geschlossenem Browser

Das Schließen des Browsers darf eine laufende Verarbeitung nicht beenden.

Beispiel:

Browser geschlossen
        │
        X
        │
        ▼
Worker läuft weiter
        │
        ▼
Verarbeitung wird abgeschlossen

Beim erneuten Öffnen kann der aktuelle bzw. letzte Status aus SQLite geladen werden.

19. Benutzerbenachrichtigung

Benachrichtigungen dürfen nicht davon abhängig sein, dass der UniCom-Browser geöffnet ist.

Dafür besitzt UniCom einen lokalen Notification Agent.

Dieser läuft in der Benutzer-Session und übernimmt die aktive Desktop-Benachrichtigung.

20. Benachrichtigungskanäle

V1 unterstützt konzeptionell:

UniCom-Benachrichtigungscenter
Windows-Desktopbenachrichtigung
automatisch angezeigtes UniCom-Popup
E-Mail
21. Benachrichtigungsstufen

Es gelten drei Stufen. Die folgende Zuordnung ist verbindlich; SPEC-02 und SPEC-03 verweisen darauf und wiederholen sie nicht.

Stufe                 Center   Windows   Popup   E-Mail     Fenster nach vorn
Information           ja       nein      nein    optional   nein
Aktion erforderlich   ja       ja        ja      ja         ja
Kritisches Ereignis   ja       ja        ja      ja         ja

Information

Beispiel:

Verarbeitung erfolgreich abgeschlossen.

Eine erfolgreiche Verarbeitung meldet sich im Benachrichtigungscenter und sonst nirgends. Kein Popup, kein Fenster, das sich in den Vordergrund schiebt.

Wer jeden Erfolg als Popup bekommt, klickt auch das Konfliktfenster weg, ohne es gelesen zu haben.

Eine E-Mail über den Erfolg kann eingeschaltet werden, etwa für einen Lauf, den niemand beobachtet.

Aktion erforderlich

Beispiel:

17 Konfliktdatensätze müssen bearbeitet werden.

Kritisches Ereignis

Beispiel:

Verarbeitung wurde abgebrochen.

Zuordnung der Ereignisse

Abschluss eines Laufs ohne Befund              Information
Abschluss mit Warnungen                        Information
neu entstandener Konfliktbestand               Aktion erforderlich
Benutzerentscheidung erforderlich              Aktion erforderlich
Ergebnis wartet auf Freigabe                   Aktion erforderlich
unerwarteter Abbruch                           Kritisches Ereignis
technischer Fehler                             Kritisches Ereignis
erwartete Verarbeitung nicht erfolgt           Kritisches Ereignis

22. Persistente Benachrichtigungen

Offene, noch nicht bearbeitete bzw. bestätigte Benachrichtigungen werden persistent gespeichert.

Sie dürfen nicht verloren gehen, nur weil:

der Benutzer das Popup schließt
der Browser geschlossen wird
der Rechner neu gestartet wird

Beim nächsten Start des Notification Agents können offene kritische Meldungen erneut angezeigt werden.

23. Konfliktdateien

Entstehen während einer Konsolidierung Konfliktdatensätze, werden diese aus dem Arbeitsbestand entfernt und in einem separaten Konfliktbestand gespeichert.

Der Konfliktbestand liegt in SQLite (Abschnitt 11.2). Konfliktdateien sind Ausleitungen daraus und führen den Bestand nicht; das Dateimodell beschreibt SPEC-07.

Die Originaldatei bleibt unverändert.

Beispiel:

Original
   │
   ▼
Arbeitsbestand
   │
   ├── eindeutige Datensätze ──► Ergebnis
   │
   └── Konflikte ──────────────► Konfliktbestand

Die Konfliktdatei enthält zusätzlich Informationen über das jeweilige Problem.

Der Benutzer kann einen Konfliktdatensatz:

korrigieren
bestätigen
ignorieren
löschen
archivieren

Die bearbeiteten Datensätze werden anschließend über einen neuen Verarbeitungslauf verarbeitet.

24. Geplante Verarbeitungen

UniCom kann Verarbeitungsläufe zeitgesteuert ausführen.

Bei einem geplanten Workflow muss UniCom erkennen können, wenn eine erwartete Verarbeitung nicht stattgefunden hat.

Beispiel:

Workflow: Kundenimport
Intervall: täglich
Erwarteter Start: 02:00

Wenn die Verarbeitung innerhalb der konfigurierten Toleranz nicht erfolgt, kann ein entsprechendes Ereignis erzeugt werden.

Beispielsweise:

EXPECTED_EXECUTION_MISSED

Der Benutzer kann darüber aktiv benachrichtigt werden.

25. Verarbeitungsmonitor

Bei interaktivem Betrieb soll der Benutzer laufende Verarbeitungen beobachten können.

Die Ansicht kann beispielsweise anzeigen:

Konsolidierung
────────────────────────────────


████████████████░░░░  78 %


97.820 / 125.480 Datensätze


Eindeutig:          97.210
Automatisch geändert: 518
Konflikte:             92
Fehler:                  0


Aktueller Schritt:
Prüfung Feld „Ort“

Diese Anzeige wird über HTTP API und SSE mit aktuellen Informationen versorgt.

Bei reinem Hintergrundbetrieb ist keine geöffnete Weboberfläche erforderlich.

26. Einstellungen

Die Einstellungen werden nicht vollständig in der normalen Benutzeroberfläche verteilt.

Für die Konsolidierung wird ein eigener Bereich bzw. ein eigenes Modal „Konsolidierungseinstellungen“ vorgesehen.

Dadurch bleibt die Hauptoberfläche übersichtlich.

27. Einstellungshierarchie

Einstellungen können global, je Profil und mandantenspezifisch definiert werden.

Grundregel:

Mandant
   ↓
Profil
   ↓
Allgemein

Mandantenspezifische Einstellungen haben Vorrang. Existiert für einen Mandanten keine spezifische Einstellung, gilt die des Profils, sonst die globale.

Ein Profil ist eine Sammlung von Einstellungen für eine konkrete Eingangsquelle und keine übergeordnete Ebene.

Die vollständige Regel samt der Abgrenzung zwischen Einstellung und Feststellung steht in SPEC-02, Abschnitt 40.

28. Preflight Check

Vor jedem Verarbeitungslauf ist ein Preflight Check durchzuführen.

Der Preflight prüft grundsätzlich, ob die Voraussetzungen für die jeweilige Verarbeitung gegeben sind.

Dazu gehören beispielsweise:

Quelle erreichbar
Ziel erreichbar
erforderliche Berechtigungen vorhanden
Konfiguration vorhanden
erforderliche Verzeichnisse vorhanden
erforderliche Dateien vorhanden
notwendige Strukturen vorhanden
keine offensichtlichen technischen Voraussetzungen verletzt

Die genaue Definition von Prüfungen, Warnungen und zwingenden Abbruchbedingungen erfolgt in den jeweiligen Modul-Specs.

29. Logging

UniCom verfügt über eine zentrale Protokollierung.

Es werden nicht zwangsläufig alle erfolgreich verarbeiteten Datensätze einzeln protokolliert.

Protokolliert werden insbesondere:

Verarbeitungsläufe
Fehler
Warnungen
Konflikte
automatische Entscheidungen
Benutzerentscheidungen
relevante Änderungen
Abbrüche
Statusänderungen
Benachrichtigungen
technische Ereignisse

Die vollständige fachliche Definition erfolgt in den jeweiligen Modul-Specs.

30. Datenschutz und Datenhaltung

UniCom V1 ist grundsätzlich für den lokalen Betrieb beim Kunden ausgelegt.

Die Architektur setzt nicht voraus, dass Kundendaten in einer externen Cloud-Datenbank gespeichert werden.

Die interne Datenhaltung erfolgt lokal über:

SQLite
JSON
lokales Dateisystem

Externe Datenquellen oder Ziele können durch den Kunden ausdrücklich konfiguriert werden.

31. Architekturprinzip für zukünftige Erweiterungen

Die fachliche Verarbeitung muss von folgenden Dingen entkoppelt bleiben:

Benutzeroberfläche
Browser
Speichertechnologie
konkreter Dateispeicher
Betriebsart

Dadurch soll später beispielsweise eine Cloud-Betriebsvariante möglich sein, ohne die eigentliche Konsolidierungsengine grundlegend neu zu entwickeln.

32. Abgrenzung zu den Modulspezifikationen

SPEC-01 definiert die übergeordnete Architektur und die verbindlichen gemeinsamen Regeln.

Folgende Details werden in den jeweiligen Modulspezifikationen festgelegt:

Daten übertragen
unterstützte Quellen und Ziele
Verschlüsselung/Entschlüsselung
Dateiübertragung
Dateinamensregeln
konkrete Preflight-Prüfungen
Fehler-/Abbruchverhalten
Daten konsolidieren
unterstützte Dateiformate
Eingangsstrukturen
Feld- und Datentyperkennung
Datum/Zeit/Timestamp
Zahlenformate
Mapping
Konfidenz
Normalisierung
Konfliktbehandlung
Zusammenführung
Duplikaterkennung
Benutzerkorrektur
konkrete Preflight-Prüfungen
Daten exportieren/importieren
Zielstrukturen
Zielformate
Datenbankimport
Exportformate
konkrete Preflight-Prüfungen
Fehler-/Abbruchverhalten
33. Verbindliche Architekturgrundsätze

Für UniCom V1 gelten damit folgende übergeordnete Regeln:

On-Premise ist das verbindliche Betriebsmodell der V1.
Cloud wird lediglich architektonisch vorbereitet.
Die Browseroberfläche ist nicht die eigentliche Verarbeitungseinheit.
Verarbeitung erfolgt durch eine UI-unabhängige Processing Engine.
Background-Verarbeitung funktioniert ohne geöffneten Browser.
Jeder Verarbeitungslauf besitzt eine eindeutige Verarbeitungs-ID.
Folgeverarbeitungen erhalten eine neue Verarbeitungs-ID.
Originaldateien bleiben unverändert.
JSON enthält Definitionen und Konfigurationen.
SQLite enthält Betriebs- und Verarbeitungsinformationen.
Jeder Verarbeitungslauf verwendet einen unveränderlichen Konfigurations-Snapshot.
HTTP API ist die verbindliche Schnittstelle zur Anwendung.
SSE wird für Live-Status und Verarbeitungsevents verwendet.
Kritische Ereignisse dürfen nicht vom Öffnen der Weboberfläche abhängig sein.
Der Notification Agent übernimmt aktive Windows-Benachrichtigungen.
Konflikte erzeugen einen separaten Konfliktbestand.
Bearbeitete Konflikte werden über einen neuen Verarbeitungslauf verarbeitet.
Vor jedem Lauf erfolgt ein Preflight Check.
Mandanteneinstellungen haben Vorrang vor Profil- und allgemeinen Einstellungen.
Die drei Module können einzeln oder kombiniert eingesetzt werden.
Die fachliche Engine bleibt von UI, Speicher und Betriebsart entkoppelt.
V1 enthält keine KI-gestützte Verarbeitung; die Ausbaustufe beschreibt SPEC-11.

34. Begriffe

Verbindliche Wörter. Sie gelten für alle Specs; abweichende Bezeichnungen werden nicht mehr verwendet.

Verarbeitungs-ID
Kennung eines Verarbeitungslaufs. Nicht: Processing-ID, Job-ID, Lauf-Nummer.

Vorgänger-Verarbeitungs-ID
Verweis auf den Lauf, aus dem dieser hervorgegangen ist.

Workflow-ID
Klammer über mehrere Läufe einer Kette (Modul 1 → 2 → 3).

Arbeitsbestand
Der Stand, auf dem verarbeitet wird. Seine Ausleitung heißt Arbeitsdatei.

Konfliktbestand
Die Konflikte eines Laufs in der Datenbank. Seine Ausleitung heißt Konfliktdatei.

Ergebnisbestand
Das Ergebnis eines Laufs. Seine Ausleitung heißt Zieldatei.

Profil
Sammlung von Einstellungen für eine konkrete Eingangsquelle. Keine Ebene über dem Mandanten.

Prüffall
Ein Fall, der einem Menschen vorgelegt wird. Der Konflikt ist die Unterart, bei der zwei Angaben einander widersprechen.

Wertmapping
Zuordnung eines vorkommenden Wertes zu seinem fachlichen Wert.

Feldmapping
Zuordnung einer Feldbezeichnung zu einem internen Feld.

Anreichern
Mehrdateien-Verarbeitung mit führender Quelle (Hauptdatei).

Sammeln
Mehrdateien-Verarbeitung ohne führende Quelle.

35. Änderungsverzeichnis
Version 1.4

Abschnitt 12: Das Datenverzeichnis ist einstellbar, mit dem auf dem jeweiligen
System üblichen Ort als Voreinstellung. Der Aufbau beschreibt, was tatsächlich
angelegt wird.

Bisher stand hier C:\ProgramData\UniCom\ mit database\unicom.db. Ein fester
Windows-Pfad in der Architektur-Spec ist selbst eine Plattformabhängigkeit, und
die Implementierung legte die Datenbank ohnehin unmittelbar ins Datenverzeichnis.

Abschnitt 12.1: Neu. Das Datenverzeichnis muss auf einer lokalen Platte liegen;
UniCom prüft das beim Start.

Abschnitt 12.2: Neu. Gesichert wird über VACUUM INTO, nicht durch Kopieren der
Datei.

Version 1.3

Abschnitt 8: Ein einheitliches Format für die Kennung eines Laufs —
RUN-JJJJ-MM-TT-NNNNNN. Bisher nannte diese Spec UC-2026-000123 und SPEC-03
RUN-2026-08-18-000471.

Abschnitt 8 bis 33: „Processing-ID" heißt durchgehend „Verarbeitungs-ID", wie in
SPEC-02 und SPEC-03.

Abschnitt 21: Die Benachrichtigungsstufen stehen als verbindliche Tabelle, dazu
die Zuordnung der Ereignisse.

Bisher war die E-Mail bei „Aktion erforderlich" optional, während SPEC-02
Abschnitt 51 sie für denselben Fall verlangte; und SPEC-03 Abschnitt 23 wollte
das Fenster auch beim bloßen Abschluss eines Laufs nach vorn holen, den diese
Spec ausdrücklich ohne Popup führte.

Abschnitt 34: Begriffstabelle ergänzt.

Version 1.2

Abschnitt 27: Die Einstellungshierarchie nennt jetzt drei Ebenen — Mandant vor
Profil vor Allgemein.

Bisher kannte diese Spec nur global und mandantenspezifisch, während SPEC-02
Abschnitt 40 eine dritte Ebene führte und SPEC-03 Abschnitt 21 wieder nur zwei.
Drei Specs nannten drei verschiedene Ketten.

Version 1.1

Abschnitt 14: Status WAITING_FOR_RELEASE ergänzt.

Ein Verarbeitungslauf, dessen Ergebnis noch nicht freigegeben ist, hatte im
bisherigen Statuskatalog keinen Namen. Ein geplanter Lauf um 02:00 Uhr (Abschnitt
24) hätte damit als COMPLETED gegolten und eine Freigabe behauptet, die niemand
erteilt hat.

Abschnitt 23: Klargestellt, dass der Konfliktbestand in SQLite liegt und
Konfliktdateien Ausleitungen daraus sind.

Konflikte standen bisher zugleich in Abschnitt 11.2 (SQLite) und in Abschnitt 12
und 23 (Dateien), ohne Angabe, welcher Bestand im Zweifel gilt. SPEC-07 verlangt
Suchen, Filtern, Sperren und einen Bearbeitungsstand über Neustarts hinweg — das
trägt nur die Datenbank.

Abschnitt 33: Grundsatz ergänzt, dass V1 keine KI-gestützte Verarbeitung enthält.

SPEC-08 und SPEC-09 stützten sich auf KI-gestützte Erkennung, die in dieser Spec
weder als Komponente vorkam noch mit der Zusage aus Abschnitt 3 und 30 vereinbar
gewesen wäre. Die Ausbaustufe steht jetzt in SPEC-11 und ändert diese Zusage
nicht ohne ausdrückliche Entscheidung.

Status
SPEC-01 — FINAL 🟢

Damit ist SPEC-01 abgeschlossen. Die noch offenen fachlichen Details sind bewusst in die jeweiligen Modul-Specs ausgelagert und blockieren SPEC-01 nicht.