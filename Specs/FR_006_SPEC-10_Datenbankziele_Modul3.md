SPEC-10 — Datenbankziele (Modul 3)

Status: FINAL für den übernommenen Teil; die Spec ist noch nicht vollständig
Modul: Daten exportieren / importieren
Version: 1.0
Abhängigkeit: SPEC-01 — Gemeinsame Verarbeitungs- und Systemgrundlagen

1. Zweck und Herkunft

SPEC-10 beschreibt das Schreiben von Daten in fremde Datenbanken.

Die Abschnitte 2 bis 4 standen bis Version 1.0 dieser Spec in SPEC-03 und sind
dort mit den Nummern 10 bis 12 geführt worden. Sie sind wörtlich übernommen; die
Verweise in SPEC-03 zeigen hierher.

Der Umzug war nötig, weil SPEC-01, Abschnitt 4.3, ausdrücklich festlegt:

"Die endgültige Zieldatenstruktur gehört zum Modul Daten exportieren/importieren
und nicht zur Eingangsstruktur des Konsolidierungsmoduls."

und Abschnitt 32 derselben Spec Zielstrukturen, Zielformate, Datenbankimport und
Exportformate Modul 3 zuordnet.

Innerhalb der Konsolidierung ist eine Datenbank ausschließlich Quelle
(SPEC-03, Abschnitt 9). Modul 2 schreibt nur seinen eigenen Ergebnisbestand.

Unterstützt werden dieselben Datenbanken wie auf der Quellseite:

Microsoft SQL Server
Oracle
PostgreSQL
MySQL
MariaDB

2. Datenbank als Ziel

Daten können in:

bestehende Tabellen
neu anzulegende Tabellen

geschrieben werden.

Das Feldmapping wird explizit definiert.

Eine automatische Zuordnung nach Feldposition darf nicht als verbindliche Zuordnung verwendet werden.

Primärschlüssel können erkannt und im Mapping berücksichtigt werden.

Die Entscheidung über das Verhalten bei vorhandenen Datensätzen erfolgt jedoch nicht automatisch, sondern über das Profil.

3. Schreibstrategien

Für Datenbankziele werden mindestens unterstützt:

INSERT

Nur neue Datensätze.

Existiert der Datensatz bereits:

→ Konflikt.

UPDATE

Nur vorhandene Datensätze.

Existiert der Datensatz nicht:

→ Konflikt.

UPSERT

Existiert der Datensatz:

→ UPDATE

Existiert er nicht:

→ INSERT

4. Abgleichsschlüssel

Der Benutzer muss definieren können, anhand welcher Felder ein vorhandener Datensatz identifiziert wird.

Einzelne Schlüssel:

Kundennummer

sowie zusammengesetzte Schlüssel:

Mandant + Kundennummer

oder:

Kundennummer + Vertragsnummer

sind möglich.

UniCom darf keinen fachlichen Schlüssel einfach erraten.

Wenn ein Datensatz nicht eindeutig identifiziert werden kann, entsteht ein Konflikt.

5. Übernahme eines Konsolidierungsergebnisses

Modul 3 verwendet den Ergebnisbestand eines Konsolidierungslaufs (SPEC-02,
Abschnitt 36).

Ein Ergebnis darf nur übernommen werden, wenn es freigegeben ist. Nicht
freigegebene Ergebnisse gelten als unvollständig (SPEC-08, Abschnitt 13, und
SPEC-02, Abschnitt 38).

Modul 3 darf ohne Modul 2 betrieben werden und einen anderweitig bereitgestellten
Datenbestand verarbeiten (SPEC-01, Abschnitt 5).

6. Preflight

Vor dem Schreiben ist zu prüfen:

Zieldatenbank erreichbar
Zieltabelle vorhanden bzw. anlegbar
Schreibberechtigung vorhanden
Feldmapping vollständig
Abgleichsschlüssel definiert, sofern UPDATE oder UPSERT gewählt ist
Datentypen der Zielspalten mit dem Mapping vereinbar

Erst bei erfolgreichem Preflight darf geschrieben werden.

7. Noch nicht festgelegt

Diese Spec deckt bislang nur die Datenbankziele ab. Nicht festgelegt sind:

Exportformate für Dateien
Zielstrukturdefinition
Verhalten bei Teilfehlern während des Schreibens
Transaktionsgrenzen und Rollback
Import aus fremden Systemen

Diese Punkte gehören in dieselbe Modul-3-Spec und sind offen.

Status

SPEC-10 — Abschnitte 1 bis 6 verbindlich, Abschnitt 7 offen.

Änderungsverzeichnis
Version 1.0

Neu angelegt. Abschnitt 2 bis 4 wörtlich aus SPEC-03, Abschnitt 10 bis 12
übernommen; Abschnitt 1, 5, 6 und 7 neu geschrieben, um den übernommenen Teil in
Modul 3 einzubetten.
