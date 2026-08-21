SPEC-03 – Datenquellen, Formate, Mapping und technische Verarbeitung

Modul: Daten konsolidieren
Status: FINAL
Version: 1.4

1. Ziel

SPEC-03 definiert die Verarbeitung unterschiedlicher Datenquellen und Dateiformate innerhalb der Konsolidierung.

UniCom muss Daten aus unterschiedlichen Quellen einlesen, strukturiert interpretieren, auf ein einheitliches internes Datenmodell abbilden und für die weitere Konsolidierung bereitstellen können.

Die Verarbeitung muss dabei profilbasiert, reproduzierbar und deterministisch erfolgen. Automatische Erkennung darf unterstützen, darf aber keine fachlich nicht eindeutige Interpretation erzwingen.

2. Unterstützte Datenquellen

UniCom unterstützt innerhalb der Konsolidierung mindestens:

lokale Dateien
Dateien aus Freigaben
Dateien aus anderen frei wählbaren Verzeichnissen
Dateien aus vorherigen UniCom-Verarbeitungsläufen
Dateien, die außerhalb von UniCom abgelegt wurden
Datenbanken

Die Quelle muss explizit auswählbar sein.

Eine Datei muss nicht zuvor durch Modul 1 oder Modul 2 verarbeitet worden sein.

Damit kann Modul 2 beispielsweise eine beliebige, extern bereitgestellte Datei direkt verarbeiten.

3. Unterstützte Dateiformate

Unterstützt werden:

CSV
XLSX
TXT
Fixed-Width-TXT
JSON
XML

PDF wird nicht als Datenverarbeitungsformat unterstützt.

PDF ist für die Konsolidierung von strukturierten Daten nicht geeignet und gehört nicht in diesen Verarbeitungskontext.

4. CSV

CSV-Dateien müssen flexibel verarbeitet werden können.

Unterstützt werden:

unterschiedliche Trennzeichen
Semikolon als Standard
Komma
Tabulator
Pipe
weitere frei definierbare Trennzeichen
UTF-8
UTF-8 mit bzw. ohne BOM
weitere erforderliche Encodings, insbesondere Windows-1252
Header vorhanden
kein Header
Textqualifizierer
Escape-Regeln

Das Trennzeichen muss explizit festgelegt oder aus einem bestehenden Profil übernommen werden können.

Der Header darf nicht automatisch zur Datentypbestimmung verwendet werden.

5. Excel

Unterstützt wird XLSX.

XLS, das alte Binärformat, ist nicht Bestandteil von V1.

Es ist kein Zip mit XML, sondern ein Strom aus Datensätzen mit eigenen
Zeichensatzregeln. Ein eigener Leser dafür steht in keinem Verhältnis, und eine
fremde Bibliothek dafür wäre Fremdcode, den der Kunde in seinem Haus mit
betreibt. Wer heute noch XLS liefert, kann in Excel „Speichern unter" wählen.

Mehrere Tabellenblätter innerhalb einer Excel-Datei werden ausdrücklich unterstützt.

Ein Tabellenblatt kann adressiert werden über:

A – Tabellenblattname

Beispiel:

"Kunden"
B – Position

Beispiel:

1. Tabellenblatt
2. Tabellenblatt
3. Tabellenblatt
C – alle Tabellenblätter

Die Konfiguration muss das gewünschte Zuordnungskriterium ausdrücklich festlegen.

Wenn mehrere Tabellenblätter zusammengehören, muss eine Zusammenführung anhand eines gemeinsamen Merkmals bzw. einer ID möglich sein.

Dabei darf UniCom nicht allein aufgrund des Blattnamens entscheiden.

6. TXT

TXT wird in zwei grundsätzlichen Varianten unterstützt.

6.1 Delimiterbasierte TXT-Dateien

Diese funktionieren ähnlich wie CSV.

Unterstützt werden:

frei definierbares Trennzeichen
Semikolon als Standard
Header vorhanden/kein Header
Textqualifizierer
Escape-Regeln
Encoding
Zahlen- und Datumsformate

Die Regeln für Textqualifizierer und Escape-Verfahren gelten ausdrücklich auch für TXT-Dateien.

6.2 Fixed-Width-TXT

Fixed-Width-Dateien werden ausdrücklich unterstützt.

Felder werden über Position und Länge definiert.

Beispiel:

Kundennummer   Position 1–5
Nachname       Position 6–25
Vorname        Position 26–40
Geburtsdatum   Position 41–50

Intern wird die Felddefinition als Startposition + Länge geführt.

Unterstützt werden außerdem:

Ausrichtung
Füllzeichen
feste Feldlängen
unterschiedliche Felddefinitionen

Fixed-Width-TXT wird als reguläres und nicht als Sonderformat behandelt.

7. JSON

JSON wird für Import und Export unterstützt.

Unterstützt werden:

Objekte
Arrays
verschachtelte Objekte
verschachtelte Arrays
JSON-Pfade
native JSON-Datentypen
String
Number
Boolean
Null

Verschachtelte Daten müssen in eine flache Datenstruktur überführt werden können.

Umgekehrt muss aus einer flachen Datenstruktur eine definierte verschachtelte JSON-Struktur erzeugt werden können.

Beim Export muss beispielsweise zwischen:

[
  {...},
  {...}
]

und

{
  "customers": [
    {...},
    {...}
  ]
}

unterschieden werden können.

Optional kann eine JSON-Datei gegen ein JSON Schema validiert werden.

Festlegung

Eine JSON-Datei stellt innerhalb eines Verarbeitungslaufs genau einen Datenbestand dar.

Mehrere JSON-Dateien werden nicht automatisch zu einem gemeinsamen JSON-Datenbestand zusammengeführt.

8. XML

XML wird für Import und Export unterstützt.

Unterstützt werden:

verschachtelte Elemente
Attribute
wiederholende Elemente
XML-Pfade
XML-Namespaces
XML-Encoding
UTF-8
optionale XSD-Validierung

XML-Attribute müssen separat adressierbar sein.

Beispielsweise:

Kunde.@id

Verschachtelte XML-Strukturen müssen in eine flache Datenstruktur überführt werden können.

Umgekehrt muss aus einer flachen Datenstruktur eine definierte XML-Struktur erzeugt werden können.

Sicherheit

Die XML-Verarbeitung muss sicher erfolgen.

Externe Entitäten und externe Ressourcen müssen deaktiviert werden, um insbesondere XXE-Angriffe zu verhindern.

Festlegung

Eine XML-Datei stellt innerhalb eines Verarbeitungslaufs genau einen Datenbestand dar.

9. Datenbanken

Folgende Datenbanken werden unterstützt:

Microsoft SQL Server
Oracle
PostgreSQL
MySQL
MariaDB

Innerhalb der Konsolidierung ist eine Datenbank ausschließlich Quelle.

Das Schreiben in fremde Datenbanken gehört zu Modul 3 und ist in SPEC-10 beschrieben.

Als Quelle

Unterstützt werden:

Tabellen
Views
frei definierbare SELECT-Abfragen

Eine als Quelle definierte Datenbank darf durch die Verarbeitung nicht verändert werden.

Schreibende SQL-Anweisungen sind dort nicht zulässig.

10. Datenbank als Ziel

Verschoben nach SPEC-10 – Datenbankziele (Modul 3), Abschnitt 2.

11. Schreibstrategien

Verschoben nach SPEC-10, Abschnitt 3.

12. Abgleichsschlüssel

Verschoben nach SPEC-10, Abschnitt 4.

Die Abschnittsnummern bleiben stehen, damit ältere Verweise auf diese Spec nicht ins Leere gehen.

13. Fehlerhafte Datenbankdatensätze

Ein fehlerhafter Datensatz darf nicht automatisch den gesamten Verarbeitungslauf stoppen.

Beispiel:

100.000 Datensätze


99.997 erfolgreich
2 Konflikte
1 Fehler

Die gültigen Datensätze werden weiterverarbeitet.

Fehlerhafte bzw. konfliktbehaftete Datensätze werden separat behandelt.

Ein technischer Fehler, der die gesamte Verarbeitung unmöglich macht – beispielsweise eine nicht erreichbare Datenbank – kann dagegen zum Abbruch des gesamten Laufs führen.

14. Verarbeitung, Abbruch und Wiederaufnahme

Jeder Verarbeitungslauf besitzt eine eindeutige Verarbeitungs-ID.

Beispiel:

RUN-2026-08-19-000471

Gespeichert werden mindestens:

Startzeit
Endzeit
Status
Quelle
Profil
Profilversion
Anzahl Datensätze
erfolgreiche Datensätze
Warnungen
Konflikte
Fehler

Bei einem technischen Abbruch wird gespeichert, bis zu welchem Verarbeitungspunkt der Lauf erfolgreich war.

Eine Wiederaufnahme darf bereits erfolgreich verarbeitete Daten nicht unkontrolliert erneut verarbeiten.

15. Konfliktdatensätze

Konfliktdatensätze werden aus der normalen Verarbeitung herausgenommen.

Sie werden in einer separaten Konfliktverarbeitung bereitgestellt.

Eine nachträgliche Bearbeitung erzeugt:

einen neuen Verarbeitungslauf mit einer neuen, eigenen Verarbeitungs-ID.

Dadurch bleibt der ursprüngliche Verarbeitungslauf unverändert nachvollziehbar.

16. Protokollierung

Erfolgreiche Datensätze werden nicht einzeln protokolliert.

Protokolliert werden insbesondere:

Fehler
Warnungen
Konflikte
technische Abbrüche
Wiederaufnahmen
Benutzerentscheidungen
Statusänderungen

Benutzerentscheidungen müssen nachvollziehbar sein.

Beispielsweise:

Verarbeitungs-ID
Konflikt-ID
Benutzer
Zeitpunkt
Entscheidung

Das bestehende UniCom-Protokollierungskonzept wird weiterverwendet.

17. Speicherung

Die zuvor festgelegte Hybridarchitektur wird verwendet.

JSON

JSON enthält:

Profile
Definitionen
Einstellungen
Mapping
Konfigurationen
SQLite

SQLite enthält:

Verarbeitungsläufe
Status
Ereignisse
Fehler
Warnungen
Konflikte
Benutzerentscheidungen
Verarbeitungshistorie

Damit werden Definition und Verarbeitungshistorie sauber getrennt.

18. Profile

Profile werden versioniert.

Eine Verarbeitung verwendet immer eine konkrete Profilversion.

Dadurch bleibt auch Jahre später nachvollziehbar, mit welchen Definitionen ein Lauf durchgeführt wurde.

Einstellungen können:

explizit definiert
aus einem bestehenden Modul/Profil übernommen

werden.

Es müssen nicht sämtliche Einstellungen bei jedem neuen Profil erneut eingegeben werden.

19. Preflight Check

Vor Beginn eines Verarbeitungslaufs führt UniCom einen Preflight Check durch.

Dabei wird insbesondere geprüft:

Quelle vorhanden
Quelle lesbar
Quelldatenbank erreichbar
Ergebnisbestand des Laufs vorhanden bzw. anlegbar
Schreibberechtigung im Ergebnisbestand
erforderliche Verzeichnisse erreichbar
erforderliche Berechtigungen vorhanden
benötigte Dateien vorhanden
Profil vollständig
erforderliche Einstellungen vorhanden

Eine Verarbeitung darf nicht erst nach Beginn der eigentlichen Datenverarbeitung feststellen, dass beispielsweise das Zielverzeichnis nicht beschreibbar ist.

Der Preflight Check ist verpflichtender Bestandteil.

20. Benutzeroberfläche

Im normalen interaktiven Betrieb erhält der Benutzer eine Live-Verarbeitungsanzeige.

Angezeigt werden beispielsweise:

aktueller Verarbeitungsschritt
Fortschritt
Anzahl verarbeiteter Datensätze
erfolgreiche Datensätze
Warnungen
Konflikte
Fehler

Erfolgreiche Datensätze müssen nicht dauerhaft einzeln dargestellt werden.

Konflikte und relevante Probleme müssen dagegen unmittelbar sichtbar sein.

21. Konsolidierungseinstellungen

Die umfangreichen Einstellungen werden nicht dauerhaft im Hauptfenster angezeigt.

Dafür gibt es ein eigenes Modal:

Konsolidierungseinstellungen

Dort werden die konsolidierungsspezifischen Regeln und Optionen zentral verwaltet.

Dabei gilt:

Es gilt die Reihenfolge Mandant → Profil → Allgemein (SPEC-02, Abschnitt 40).

Der Mandant hat Vorrang, sofern für ihn eine entsprechende Einstellung existiert. Angaben, die eine Eigenschaft der Eingangsdatei beschreiben — Trennzeichen, Encoding, Header-Verhalten, Feldpositionen —, sind keine Einstellungen in diesem Sinne und nicht überschreibbar.

22. Background Worker

UniCom muss perspektivisch sowohl interaktiv als auch im Hintergrund betrieben werden können.

Beim Background-Betrieb:

Browser muss nicht geöffnet sein
Verarbeitung läuft unabhängig von der Browser-Sitzung
Status wird persistent gespeichert
Live-Ansicht wird nicht angezeigt

Die Kommunikation zwischen Worker und Benutzeroberfläche erfolgt über:

HTTP API + SSE

23. Benachrichtigungen

Der Benutzer muss über folgende Ereignisse informiert werden:

ein Lauf abgebrochen wurde
ein technischer Fehler aufgetreten ist
ein Konfliktbestand entstanden ist
eine Benutzerentscheidung erforderlich ist
ein Lauf abgeschlossen wurde

Welche Stufe ein Ereignis hat und über welche Kanäle es geht, legt SPEC-01, Abschnitt 21, fest.

Eine Benachrichtigung darf nicht davon abhängig sein, dass der Benutzer UniCom irgendwann wieder manuell öffnet.

Das UniCom-Fenster wird — soweit die technische Umgebung dies ermöglicht — bei Meldungen der Stufen „Aktion erforderlich" und „Kritisches Ereignis" automatisch nach vorn geholt. Beim bloßen Abschluss eines Laufs geschieht das nicht.

24. Abschluss eines Laufs

Nach Abschluss wird eine Zusammenfassung angezeigt:

Konsolidierung abgeschlossen


12.450 Datensätze verarbeitet


12.431 erfolgreich
14 Warnungen
5 Konflikte


Verarbeitungs-ID:
RUN-2026-08-19-000471

Die Verarbeitungshistorie bleibt dauerhaft nachvollziehbar.

Verbindliche Grundprinzipien von SPEC-03
Keine destruktive Änderung der Originalquelle.
Keine fachlich nicht eindeutige automatische Interpretation.
Explizite Profildefinition hat Vorrang vor automatischer Erkennung.
Konflikte blockieren nicht automatisch die Verarbeitung aller anderen Datensätze.
Jeder Lauf besitzt eine eindeutige Verarbeitungs-ID.
Konfliktbearbeitung erzeugt einen neuen Verarbeitungslauf.
Profile sind versioniert.
Definitionen werden in JSON, Verarbeitungshistorie in SQLite gespeichert.
Preflight Check ist verpflichtend.
Mandanteneinstellungen haben Vorrang vor allgemeinen Einstellungen.
Interaktive Verarbeitung und Background Worker sind getrennt.
HTTP API + SSE sind für die Kommunikation vorgesehen.

SPEC-03 ist damit als konsolidierte Fassung vollständig.

Änderungsverzeichnis
Version 1.4

Abschnitt 3 und 5: XLS ist gestrichen; unterstützt wird XLSX.

Version 1.3

Abschnitt 14 und 24: Die Beispiel-Kennung folgt dem Format aus SPEC-01,
Abschnitt 8.

Abschnitt 23: Stufen und Kanäle stehen nur noch in SPEC-01, Abschnitt 21.

Bisher verlangte dieser Abschnitt, das Fenster bei jedem relevanten Ereignis nach
vorn zu holen, und zählte den Abschluss eines Laufs dazu — während SPEC-01 für
diese Stufe ausdrücklich kein Popup vorsah.

Version 1.2

Abschnitt 21: Die Einstellungshierarchie nennt jetzt dieselbe Kette wie SPEC-01
und SPEC-02 — Mandant vor Profil vor Allgemein — samt der Abgrenzung zwischen
Einstellung und Feststellung.

Version 1.1

Abschnitt 9: Eine Datenbank ist innerhalb der Konsolidierung nur noch Quelle.

Abschnitt 10 bis 12: Datenbank als Ziel, Schreibstrategien und Abgleichsschlüssel
sind wörtlich nach SPEC-10 umgezogen.

SPEC-01, Abschnitt 4.3 und 32, ordnet Zielstrukturen und Datenbankimport
ausdrücklich Modul 3 zu. Solange dieselben Festlegungen in der
Konsolidierungs-Spec standen, wären sie zweimal gebaut worden — oder ein Kunde
mit nur Modul 2 hätte die Fähigkeit von Modul 3 mitbekommen.

Abschnitt 19: Der Preflight prüft die Erreichbarkeit der Quelldatenbank und den
Ergebnisbestand des Laufs, nicht mehr die Schreibberechtigung an einem fremden
Ziel.