# Ergänzung: Zweigleisige Datenstrukturerkennung

## Grundsatz

UniCom soll Datenstrukturen auf **zwei Wegen** erkennen können:

1. **Automatische Erkennung**
2. **Konfigurierbare Erkennung über Einstellungen/Regeln**

Beide Verfahren müssen parallel existieren und miteinander kombinierbar sein.

Der Benutzer soll also entscheiden können, ob UniCom eine Struktur selbstständig erkennen soll oder ob für eine bestimmte Datenquelle bzw. einen bestimmten Mandanten bekannte Strukturen explizit hinterlegt werden.

---

# 1. Automatische Erkennung

Im automatischen Modus analysiert UniCom den eingehenden Content selbstständig.

Dabei werden unter anderem erkannt:

* Datenzeilen
* Datenblöcke
* Spalten
* Datentypen
* Header
* Trennzeichen
* wiederkehrende Zeilenmuster
* Leerzeilen und Unterbrechungen
* Beginn und Ende von Datenblöcken
* unterschiedliche Datenbereiche innerhalb eines Dokuments

Beispiel:

```text
Freitext
Freitext
Leerzeile
Header
Datenzeile
Datenzeile
Datenzeile
Leerzeile
Freitext
```

UniCom erkennt automatisch:

```text
Data Block
Start: Datenzeile 1
Ende: Datenzeile 3
Columns: 4
Pattern: INTEGER | TEXT | INTEGER | DECIMAL
Confidence: 97 %
```

---

# 2. Konfigurierbare Erkennung

Zusätzlich muss der Benutzer explizite Regeln bzw. Einstellungen hinterlegen können.

Das ist insbesondere sinnvoll, wenn eine Datenquelle regelmäßig dieselbe Struktur liefert.

Beispiel:

```text
Mandant: Kunde ABC
Quelle: Bestellung per E-Mail

Erwartete Datenstruktur:

Spalte 1 → Artikelnummer → INTEGER
Spalte 2 → Bezeichnung → TEXT
Spalte 3 → Menge → INTEGER
Spalte 4 → Preis → DECIMAL
```

Oder:

```text
Datenblock beginnt nach:
"Artikelnummer"

Datenblock endet bei:
Leerzeile

Erwartete Spalten:
4
```

Solche Einstellungen sollen die automatische Erkennung **nicht ersetzen**, sondern eine zusätzliche Erkennungsmöglichkeit darstellen.

---

# 3. Automatisch + Einstellungen kombinieren

Besonders wichtig ist die Kombination beider Verfahren.

Beispiel:

```text
Konfiguration:
4 Spalten erwartet
Spalte 1 = Artikelnummer
Spalte 3 = Menge
Spalte 4 = Preis
```

Die automatische Erkennung findet:

```text
INTEGER | TEXT | INTEGER | DECIMAL
```

UniCom kombiniert beide Informationen.

Ergebnis:

```text
Configuration Match: 100 %
Pattern Match:       98 %
Overall Confidence:  99 %
```

Dadurch kann eine bekannte Datenquelle besonders zuverlässig verarbeitet werden.

---

# 4. Einstellungen dürfen die automatische Erkennung unterstützen

Eine konfigurierte Regel kann als **Hinweis**, **Einschränkung** oder **harte Vorgabe** verwendet werden.

Beispielsweise:

### Hinweis

> Spalte 1 sollte eine Artikelnummer enthalten.

Die automatische Erkennung darf davon abweichen, wenn die tatsächlichen Daten eindeutig etwas anderes zeigen.

### Einschränkung

> Datenblock muss mindestens 3 Spalten besitzen.

### Harte Vorgabe

> Nur Datenzeilen mit exakt diesem Pattern akzeptieren.

Diese drei Verhaltensweisen sollten technisch unterscheidbar sein.

---

# 5. Priorität der Erkennung

Die Engine soll grundsätzlich nach folgendem Prinzip arbeiten:

```text
Konfiguration
      +
Automatische Analyse
      +
optional KI
      ↓
Gesamtergebnis
```

Nicht:

```text
Konfiguration ODER Automatik
```

sondern:

```text
Konfiguration UND Automatik
```

soweit beide Informationen verfügbar sind.

---

# 6. Konflikte erkennen

Wenn konfigurierte Regeln und automatische Erkennung widersprechen, darf UniCom nicht einfach stillschweigend eine Variante auswählen.

Beispiel:

```text
Konfiguration:
Spalte 3 = DATE

Automatische Erkennung:
Spalte 3 = DECIMAL
```

UniCom soll dies als Konflikt erkennen:

```text
⚠ Strukturabweichung

Konfigurierte Struktur:
Spalte 3 → DATE

Erkannte Struktur:
Spalte 3 → DECIMAL

[Automatische Struktur verwenden]
[Konfiguration verwenden]
[Analyse anzeigen]
```

Bei aktiviertem KI-Modus kann die KI zusätzlich eine Einschätzung liefern.

---

# 7. Lernfähigkeit

Wenn ein Benutzer eine erkannte Struktur bestätigt oder korrigiert, soll diese Information optional als zukünftige Konfiguration gespeichert werden können.

Beispiel:

```text
Automatisch erkannt:

INTEGER | TEXT | INTEGER | DECIMAL

Benutzer bestätigt:

✓ Als bekannte Struktur speichern
```

Danach kann UniCom diese Struktur bei zukünftigen Eingängen berücksichtigen.

Das führt langfristig zu:

```text
Unbekannte Quelle
      ↓
Automatische Erkennung
      ↓
Benutzer bestätigt
      ↓
Strukturprofil speichern
      ↓
Nächster Import
      ↓
Automatik + bekanntes Profil
      ↓
höhere Sicherheit
```

---

# 8. Keine unnötige Regelpflege

Trotz der Möglichkeit, Regeln zu konfigurieren, darf UniCom nicht zu einem System werden, bei dem der Benutzer für jede Datei manuell Regeln erstellen muss.

Grundprinzip:

> **Konfiguration ist möglich, aber nicht zwingend erforderlich.**

Die automatische Erkennung soll der Normalfall sein.

Konfiguration ist insbesondere für:

* bekannte Datenquellen
* wiederkehrende Dateiformate
* Mandanten
* feste E-Mail-Strukturen
* besonders kritische Imports
* bekannte Sonderfälle

gedacht.

---

# 9. Drei Erkennungsmodi

Für die Benutzeroberfläche sollte die Funktion deshalb mindestens folgende Modi anbieten:

### Automatisch

UniCom erkennt die Struktur selbstständig.

```text
Erkennung:
● Automatisch
○ Nach Einstellungen
○ Einstellungen + Automatik
```

### Nach Einstellungen

UniCom verwendet die vom Benutzer hinterlegte Struktur.

### Einstellungen + Automatik

UniCom verwendet die Einstellungen als zusätzliche Information und überprüft sie gegen die tatsächlich erkannten Daten.

Dieser Modus sollte für wiederkehrende professionelle Datenquellen der bevorzugte Modus sein.

---

# 10. KI bleibt optional

Auch die KI soll unabhängig davon optional bleiben.

Damit ergeben sich grundsätzlich drei Ebenen:

```text
                 DATA DISCOVERY
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   Einstellungen   Automatik          KI
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                Gesamtergebnis
```

Die KI soll nur dann hinzugezogen werden, wenn dies konfiguriert ist und die deterministische Erkennung bzw. die vorhandenen Einstellungen keine ausreichende Sicherheit liefern.

---

# 11. Zielarchitektur

Die endgültige Erkennung sollte deshalb konzeptionell so aussehen:

```text
INPUT
  │
  ▼
CONTENT EXTRACTION
  │
  ▼
┌──────────────────────────────────┐
│        DATA DISCOVERY ENGINE     │
│                                  │
│  ┌────────────┐  ┌────────────┐  │
│  │Konfiguration│  │ Automatik  │  │
│  │   / Regeln │  │  / Heuristik│ │
│  └──────┬─────┘  └──────┬─────┘  │
│         └────────┬──────┘         │
│                  ▼                │
│          Pattern Analysis         │
│                  │                │
│                  ▼                │
│          Conflict Detection       │
│                  │                │
│                  ▼                │
│        Confidence Evaluation      │
│                  │                │
│                  ▼                │
│          Optional AI Layer        │
└──────────────────┬───────────────┘
                   │
                   ▼
            STRUCTURED DATA
                   │
                   ▼
             CONSOLIDATION
                   │
                   ▼
          EXPORT / DATABASE
```

## Wichtig für die Implementierung

Die automatische Erkennung und die konfigurierbaren Regeln müssen **zwei eigenständige, aber kombinierbare Informationsquellen** sein.

Keine der beiden Varianten darf so implementiert werden, dass die jeweils andere später nur schwer ergänzt werden kann.

Die Engine muss deshalb intern unterscheiden können zwischen:

* **Observed** – tatsächlich aus den Daten erkannt
* **Configured** – vom Benutzer vorgegeben
* **Inferred** – aus Mustern abgeleitet
* **AI Suggested** – durch KI vorgeschlagen
* **Confirmed** – vom Benutzer bestätigt

Damit bleibt jederzeit nachvollziehbar, **woher eine erkannte Struktur stammt**.

Das ist eine zentrale Architekturvorgabe für UniCom.
