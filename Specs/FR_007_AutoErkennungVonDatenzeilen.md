# UniCom – Spec: Automatische Erkennung von Datenzeilen und Datenblöcken

## Ziel

UniCom soll nicht voraussetzen, dass eine Eingabedatei bereits sauber strukturiert ist.

UniCom soll selbstständig erkennen können, **welche Bereiche eines Eingabeinhalts tatsächlich verwertbare Daten enthalten**.

Das gilt insbesondere für:

* Excel-Dateien
* CSV-Dateien
* TXT-Dateien
* frei formatierte Textdateien
* Copy-&-Paste-Inhalte
* E-Mail-Texte
* E-Mail-Bodies
* später auch PDF-/Dokumentinhalte
* E-Mail-Anhänge

Ein Eingabedokument kann beliebigen Freitext enthalten. Die eigentlichen Daten können sich irgendwo innerhalb dieses Inhalts befinden.

Beispiel:

```text
Sehr geehrte Damen und Herren,

hiermit bestellen wir folgende Artikel.

Bitte liefern Sie schnellstmöglich.

Artikelnummer   Bezeichnung        Menge   Preis
4711            Schraube M8        500     0,12
4712            Mutter M8          500     0,08
4713            Unterlegscheibe    1000    0,04

Bitte bestätigen Sie den Auftrag.

Mit freundlichen Grüßen
Max Mustermann
```

UniCom muss erkennen, dass die drei mittleren Zeilen einen zusammenhängenden Datenblock bilden.

---

# 1. Grundprinzip

Die Funktion soll **Data Discovery / Datenstruktur-Erkennung** sein.

UniCom soll nicht primär fragen:

> „Welche Datei ist das?“

sondern:

> „Welche verwertbaren Datenstrukturen befinden sich innerhalb dieses Inhalts?“

Die Erkennung muss unabhängig vom ursprünglichen Eingangskanal funktionieren.

Architektur:

```text
INPUT
  │
  ├── Excel
  ├── CSV
  ├── TXT
  ├── Copy & Paste
  ├── E-Mail
  ├── E-Mail Body
  └── Attachments
        │
        ▼
CONTENT EXTRACTION
        │
        ▼
DATA DISCOVERY
        │
        ├── Row Detection
        ├── Column Detection
        ├── Type Detection
        ├── Pattern Detection
        ├── Block Detection
        ├── Header Detection
        └── Footer/Noise Detection
        │
        ▼
DATA BLOCK CANDIDATES
        │
        ▼
CONFIDENCE EVALUATION
        │
        ├── eindeutig
        ├── wahrscheinlich
        └── unsicher
        │
        ▼
optional AI ASSISTANCE
        │
        ▼
STRUCTURED DATA
        │
        ▼
CONSOLIDATION
        │
        ▼
EXPORT / IMPORT
```

---

# 2. Deterministische Erkennung ist die Basis

Die automatische Erkennung darf nicht ausschließlich von einem LLM abhängig sein.

UniCom soll zunächst mit deterministischen und heuristischen Verfahren arbeiten.

Für jede Zeile sollen unter anderem ermittelt werden:

* Anzahl der Felder
* Position der Felder
* erkannter Datentyp jedes Feldes
* Format jedes Feldes
* Feldlänge
* Trennzeichen
* Whitespace-Struktur
* numerische Werte
* Integer
* Decimal
* Datum
* Uhrzeit
* Boolean
* E-Mail-Adresse
* URL
* alphanumerische ID
* Text
* leere Werte

Beispiel:

```text
4711 | Schraube M8 | 500 | 0,12
```

ergibt:

```text
INTEGER | TEXT | INTEGER | DECIMAL
```

Dieses Muster wird als **Row Pattern / Row Signature** gespeichert.

---

# 3. Wiederkehrende Muster erkennen

Ein einzelnes Muster reicht nicht zwingend aus.

UniCom soll mehrere aufeinanderfolgende Zeilen analysieren.

Beispiel:

```text
INTEGER | TEXT | INTEGER | DECIMAL
INTEGER | TEXT | INTEGER | DECIMAL
INTEGER | TEXT | INTEGER | DECIMAL
INTEGER | TEXT | INTEGER | DECIMAL
```

Dies ist ein sehr starkes Indiz für einen Datenblock.

Das System soll deshalb nicht nur einzelne Zeilen bewerten, sondern **Sequenzen von Zeilen**.

Dabei sollen unter anderem berücksichtigt werden:

* gleiche Spaltenanzahl
* gleiche Datentypen
* gleiche Position der Datentypen
* ähnliche Feldformate
* ähnliche Feldlängen
* Wiederholung des Musters
* räumliche Nähe der Zeilen
* Leerzeilen
* Header direkt vor dem Block
* Freitext vor dem Block
* Freitext nach dem Block

---

# 4. Datenblöcke erkennen

Mehrere passende Datenzeilen sollen zu einem Data Block zusammengefasst werden.

Beispiel:

```text
Zeile 1  Text
Zeile 2  Text
Zeile 3  Leer
Zeile 4  Header
Zeile 5  Separator
Zeile 6  Daten
Zeile 7  Daten
Zeile 8  Daten
Zeile 9  Leer
Zeile 10 Text
```

Ergebnis:

```text
Data Block
Start: Zeile 6
Ende: Zeile 8
Rows: 3
Columns: 4
```

UniCom soll erkennen können, dass Freitext außerhalb des Blocks **kein Fehler** ist.

---

# 5. Header erkennen

Ein Header ist häufig keine Datenzeile.

Beispiel:

```text
Artikelnummer | Bezeichnung | Menge | Preis
4711          | Schraube M8 | 500   | 0,12
4712          | Mutter M8   | 500   | 0,08
```

UniCom soll erkennen:

```text
Header
↓
Data Row
↓
Data Row
```

Der Header soll dem erkannten Data Block zugeordnet werden können.

Dabei darf nicht vorausgesetzt werden, dass ein Header existiert.

---

# 6. Unterbrechungen und Leerzeilen

UniCom soll auch mit realen, unsauberen Daten umgehen.

Beispiel:

```text
4711 | Müller | 500
4712 | Meier  | 300

4713 | Schulz | 400
4714 | Weber  | 200
```

Eine einzelne Leerzeile muss nicht automatisch das Ende des Datenblocks bedeuten.

Das System soll anhand des Gesamtmusters entscheiden, ob der Block fortgesetzt wird.

---

# 7. Tolerante Pattern-Erkennung

Die Erkennung darf nicht unnötig strikt sein.

Beispiel:

```text
INTEGER | TEXT | DATE | DECIMAL
INTEGER | TEXT | DATE | DECIMAL
INTEGER | TEXT | TEXT | DECIMAL
INTEGER | TEXT | DATE | DECIMAL
```

Die dritte Zeile soll nicht automatisch aus dem Datenblock entfernt werden.

Stattdessen soll ein Match-Score berechnet werden.

Beispiel:

```text
Row Match: 75 %
```

oder:

```text
Row Match: 96 %
```

Die konkrete Berechnung soll sauber gekapselt und erweiterbar sein.

---

# 8. Confidence Score

Jede erkannte Zeile und jeder erkannte Datenblock soll einen Confidence Score erhalten.

Beispiel:

```text
Row Confidence:   98 %
Block Confidence: 96 %
```

Die Bewertung soll mehrere Faktoren kombinieren:

* Datentyp-Match
* Position-Match
* Spaltenanzahl
* Pattern-Wiederholung
* Nachbarzeilen
* Header-Korrelation
* Format-Konsistenz
* Block-Kontinuität
* Anzahl erkannter Datensätze

Die Schwellenwerte sollen konfigurierbar sein.

---

# 9. KI nur bei Unsicherheit

KI/LLM soll **nicht die gesamte Aufgabe ersetzen**.

Primärer Ablauf:

```text
Deterministische Erkennung
        ↓
eindeutig?
   ├── JA → übernehmen
   │
   └── NEIN
          ↓
      KI-Unterstützung
          ↓
      Entscheidung
```

Die KI soll insbesondere verwendet werden für:

* semantisch ungewöhnliche Datentypen
* unbekannte Spalteninhalte
* uneindeutige Datenzeilen
* ungewöhnliche Formate
* semantische Interpretation von Headern
* Entscheidung zwischen mehreren möglichen Datenblöcken
* Erkennung von Daten in Freitext

Die KI soll möglichst nur die **relevanten Kandidaten und deren Kontext** erhalten und nicht unnötig komplette Dokumente übertragen.

---

# 10. Copy & Paste

UniCom benötigt einen Eingabemodus:

**„Text einfügen“**

Der Benutzer kann beliebigen Text in einen Editor einfügen.

Beispiel:

```text
Sehr geehrte Damen und Herren,

wir bestellen:

4711 Schraube M8 500 0,12
4712 Mutter M8 500 0,08
4713 Scheibe 1000 0,04

Vielen Dank.
```

Danach:

**[Datenstruktur analysieren]**

UniCom analysiert den kompletten Inhalt und zeigt erkannte Datenblöcke an.

Beispiel:

```text
1 Datenblock erkannt

Zeilen: 5–7
Datensätze: 3
Spalten: 4
Confidence: 94 %
```

Der Benutzer muss die erkannte Struktur vor der weiteren Verarbeitung sehen und bei Bedarf korrigieren können.

---

# 11. E-Mail-Verarbeitung

**Unikom greift nicht auf Postfächer zu.**

Ein Postfachzugang berechtigt zu allem, was darin liegt — auch zu Nachrichten,
die Unikom nichts angehen. Stattdessen legt eine Regel im Mailsystem des Kunden
die betreffenden Nachrichten als Datei in ein Verzeichnis, und Unikom holt sie
dort ab wie jede andere Datei. Der Kunde entscheidet damit in seinem eigenen
System, was Unikom überhaupt zu sehen bekommt; siehe FR_009, Abschnitt 8.

Die abgelegte Nachricht wird als Eingangsformat behandelt.

Eine E-Mail kann enthalten:

```text
FROM
TO
SUBJECT
DATE
BODY
ATTACHMENTS
```

Der Body wird anschließend durch dieselbe Data-Discovery-Engine verarbeitet wie Copy-&-Paste-Text.

Beispiel:

```text
Regel im Mailsystem
  ↓
abgelegte Nachricht im Verzeichnis
  ↓
Abholung (Modul 1)
  ↓
Body
  ↓
Content Extraction
  ↓
Data Discovery
  ↓
Data Block
```

Es darf keine separate, völlig andere Erkennungslogik für E-Mails entstehen.

Die Data-Discovery-Engine soll möglichst unabhängig von der Quelle arbeiten.

---

# 12. E-Mail-Anhänge

Auch Anhänge sollen verarbeitet werden können.

Beispiel:

```text
E-Mail
│
├── Body
│    └── Data Block
│
└── Bestellung.xlsx
     └── Data Block
```

UniCom soll beide Quellen erkennen können.

Die Quelle jedes Datenblocks muss dabei erhalten bleiben.

Beispiel:

```text
Source:
Email Body

oder:

Source:
Attachment: Bestellung.xlsx
Sheet: Bestellungen
```

---

# 13. Mehrere Datenblöcke

Ein Dokument kann mehrere unterschiedliche Datenblöcke enthalten.

Beispiel:

```text
Bestellung

Kundendaten:
10001 | Müller GmbH | Frankfurt

Bestellpositionen:
4711 | Schraube | 500
4712 | Mutter   | 500

Versand:
Frankfurt | DHL | Express
```

UniCom soll nicht nur „einen“ Datenblock suchen.

Es soll **alle relevanten Kandidaten erkennen und voneinander trennen**.

---

# 14. Row Profile

Für jeden erkannten Datenblock soll intern ein Row Profile erzeugt werden.

Beispiel:

```text
Row Profile

Columns: 4

Column 1:
  INTEGER
  Confidence: 0.99

Column 2:
  TEXT
  Confidence: 0.98

Column 3:
  INTEGER
  Confidence: 0.99

Column 4:
  DECIMAL
  Confidence: 0.97

Pattern:
  INTEGER | TEXT | INTEGER | DECIMAL

Rows:
  183

Block Confidence:
  0.97
```

Dieses Profil soll später für Mapping, Konsolidierung und Export wiederverwendbar sein.

---

# 15. Benutzerinteraktion

Die automatische Erkennung soll den Benutzer möglichst wenig belasten.

Prinzip:

**Automatisch erkennen → Ergebnis zeigen → nur bei Unsicherheit fragen.**

Der Benutzer soll nicht für jede Datei manuell Spaltenregeln definieren müssen.

Bei eindeutigen Ergebnissen:

```text
✓ Datenblock erkannt
✓ Struktur erkannt
✓ Datentypen erkannt
✓ 183 Datensätze erkannt
```

Bei Unsicherheit:

```text
⚠ Zwei mögliche Datenblöcke erkannt.

[Block 1 verwenden]
[Block 2 verwenden]
[Beide verwenden]
```

---

# 16. Architektur-Anforderung

Die Data-Discovery-Funktion muss als eigenständige, wiederverwendbare Engine implementiert werden.

Nicht direkt in CSV-, Excel- oder E-Mail-Code integrieren.

Empfohlene logische Komponenten:

```text
ContentExtractor
    ↓
RowTokenizer
    ↓
FieldDetector
    ↓
DataTypeDetector
    ↓
RowPatternAnalyzer
    ↓
DataBlockDetector
    ↓
HeaderDetector
    ↓
ConfidenceEvaluator
    ↓
AIResolver (optional)
    ↓
StructuredDataResult
```

Die konkrete technische Umsetzung kann an die bestehende UniCom-Architektur angepasst werden.

---

# 17. Wichtig: keine unnötige Überautomatisierung

Die Funktion darf nicht versuchen, jede beliebige Textzeile zwanghaft als Datenzeile zu interpretieren.

Wenn keine ausreichenden strukturellen Hinweise vorhanden sind:

```text
Keine eindeutige Datenstruktur erkannt.
```

ist ein korrektes Ergebnis.

Ebenso muss die Engine Unsicherheit explizit darstellen können.

---

# 18. Zielbild

Das langfristige Ziel von UniCom ist:

> **Der Benutzer liefert Daten – UniCom findet die Datenstruktur.**

Dabei spielt es keine entscheidende Rolle, ob die Daten ursprünglich aus

* einer Excel-Datei,
* CSV,
* TXT,
* einer E-Mail,
* einem Copy-&-Paste-Text,
* einem PDF,
* einem E-Mail-Anhang

kommen.

Die Quelle liefert zunächst nur Content.

Die **Data-Discovery-Engine erkennt daraus verwertbare Strukturen**.

Die klassische deterministische Logik bildet dabei das Fundament.

KI wird ergänzend eingesetzt, wenn Regeln und Mustererkennung keine ausreichende Sicherheit liefern.

## Implementierungsauftrag

Analysiere zunächst die bestehende UniCom-Codebasis.

Prüfe, welche Komponenten für diese Architektur bereits vorhanden sind.

Implementiere nicht sofort eine parallele neue Architektur.

Erweitere vorhandene Komponenten, wenn dies sinnvoll ist.

Beginne mit einer robusten **Data-Discovery-Engine für Text/CSV/Copy-&-Paste**.

Danach soll dieselbe Engine über Adapter für Excel und E-Mail nutzbar gemacht werden.

Vor der Implementierung:

1. bestehende Datenimport-Architektur analysieren
2. bestehende Parser und Datentyp-Erkennung identifizieren
3. vorhandene Konsolidierungslogik berücksichtigen
4. Architekturvorschlag erstellen
5. notwendige Änderungen auflisten
6. erst danach implementieren

Bestehende UniCom-Funktionalität darf nicht ohne Grund verändert oder entfernt werden.

Die Lösung soll modular, testbar und erweiterbar sein.

---

## Änderungsverzeichnis

### Version 1.1

**Abschnitt 11 und 12:** Aus dem „Input Connector E-Mail" wird die Abholung
abgelegter Nachrichten aus einem Verzeichnis.

Ein Zugang zum Postfach hätte Unikom Zugriff auf alle Nachrichten gegeben,
einschließlich derer, die es nichts angehen, und die Kennwörter fremder
Postfächer in seine Verwahrung gebracht. Mit einer Regel im Mailsystem
entscheidet der Kunde selbst, was Unikom sieht — dieselbe Erkennung, ein
erheblich kleinerer Zugriff. Begründung und Folgen stehen in FR_009.

Die Erkennung selbst ist davon unberührt: Rumpf und Anhänge gehen weiterhin
durch dieselbe Engine.
