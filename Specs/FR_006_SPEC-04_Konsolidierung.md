# SPEC-04 – Datenqualität, Normalisierung und Mapping

**Modul:** Modul 2 – Daten konsolidieren
**Status:** FINAL
**Version:** 1.3

## 1. Ziel und Grundprinzipien

SPEC-04 definiert die Regeln für Datenqualität, Normalisierung, Datentypkonvertierung, Feld-Mapping, Referenzabgleich, Dublettenerkennung, Zusammenführung und Priorisierung innerhalb der Datenkonsolidierung.

Oberstes Prinzip:

> **UniCom darf Daten niemals aufgrund einer bloßen Vermutung verändern.**

Automatische Änderungen sind nur zulässig, wenn sie:

1. durch eine eindeutige und definierte Regel abgesichert sind,
2. durch einen eindeutig definierten Kontext abgesichert sind oder
3. durch eine ausdrücklich aktivierte Erkennungsregel abgesichert sind, deren Confidence die Schwelle aus SPEC-02, Abschnitt 5, erreicht.

Alle übrigen mehrdeutigen Fälle werden als Konflikt bzw. als Benutzerentscheidung behandelt.

---

# 2. Normalisierung

Normalisierung dient grundsätzlich dazu, unterschiedliche Darstellungen eines fachlich identischen Wertes zu vereinheitlichen.

Sie darf die fachliche Bedeutung eines Wertes nicht eigenmächtig verändern.

Unterstützt werden insbesondere:

* Entfernung führender und nachfolgender Leerzeichen
* Reduzierung definierter überflüssiger Leerzeichen
* Normalisierung von Tabulatoren und definierten Steuerzeichen
* Groß-/Kleinschreibung
* Unicode-Normalisierung
* Zahlenformate
* Datumsformate
* definierte Telefon-, IBAN-, E-Mail-, Postleitzahl-, Kunden- oder Artikelnummernformate
* weitere benutzerdefinierte Normalisierungsregeln

Die Normalisierung ist profilabhängig konfigurierbar.

### Normalisierung versus Korrektur

Eine reine Normalisierung ist beispielsweise:

```text
" 4711 " → "4711"
```

Eine fachliche Korrektur ist beispielsweise:

```text
"471l" → "4711"
```

Die zweite Änderung stellt eine Interpretation dar und unterliegt daher den strengeren Guardrails dieser SPEC.

---

# 3. Feld-Mapping

UniCom muss Felder unterschiedlicher Quellen explizit auf Zielfelder abbilden können.

Unterstützt werden:

* 1:1-Mapping
* mehrere Quellfelder → ein Zielfeld
* ein Quellfeld → mehrere Zielfelder
* zusammengesetzte Werte
* Aufteilung eines Quellwertes
* Transformationen innerhalb des Mappings
* Mapping auf unterschiedliche Datentypen

Beispiel:

```text
Straße + Hausnummer → Adresse
```

oder:

```text
"Mustermann, Max"
→ Nachname = Mustermann
→ Vorname = Max
```

## Automatisches Mapping

UniCom darf Mapping-Vorschläge automatisch erzeugen.

Dabei können unter anderem berücksichtigt werden:

* Feldname
* definierte Aliasnamen
* Datentyp
* Feldlänge
* bekannte Bezeichnungen
* bestehende Mapping-Referenzen

Es werden drei Zustände unterschieden:

### Eindeutig

Die Zuordnung ist eindeutig.

→ automatische Übernahme zulässig.

### Vorschlag

Eine Zuordnung ist plausibel, aber nicht eindeutig.

→ Benutzer kann sie bestätigen.

### Mehrdeutig

Mehrere Zuordnungen sind plausibel.

→ keine automatische Entscheidung; Benutzerentscheidung bzw. Konflikt.

Bestätigte Mapping-Entscheidungen können optional als wiederverwendbare Referenzen gespeichert werden. Das daraus entstehende Lernen muss kontrolliert und nachvollziehbar erfolgen.

---

# 4. Datentypen und Konvertierung

UniCom verwendet unabhängig vom Quellformat ein einheitliches internes Datentypmodell.

Mindestens unterstützt werden:

* String
* Integer
* Decimal
* Boolean
* Date
* Time
* DateTime
* Binary
* Null

Der Zieltyp wird im Mapping bzw. Profil definiert.

Eine automatische Konvertierung ist zulässig, wenn sie eindeutig und ohne unerlaubten Informationsverlust möglich ist.

Beispiele:

```text
"12345" → Integer 12345
```

oder:

```text
"18.08.2026" → Date
```

sofern das Eingangsformat eindeutig definiert ist.

## Nicht zulässige automatische Konvertierungen

Nicht konvertierbare, mehrdeutige oder potenziell verlustbehaftete Werte werden als Konflikt behandelt, sofern keine ausdrückliche Profilregel etwas anderes erlaubt.

Beispielsweise:

```text
"ABC123" → Integer
```

oder:

```text
1234.56 → Integer
```

wenn dadurch Datenverlust entsteht.

Überläufe dürfen nicht automatisch durch Kürzung oder andere Datenverluste behandelt werden.

## Benutzerdefinierte Konvertierungsregeln

Benutzer können eigene Datentyp- und Konvertierungsregeln definieren.

Diese Regeln können:

* Standardkonvertierungen ergänzen
* Standardkonvertierungen präzisieren
* definierte Standardverhalten überschreiben

Die Regeln sind Bestandteil des Profils, werden versioniert und müssen nachvollziehbar sein.

## Null und leere Werte

UniCom unterscheidet mindestens zwischen:

* NULL
* leerem String
* ausschließlich aus Leerzeichen bestehendem Wert

Die Behandlung dieser Werte ist profilabhängig definierbar.

## Boolean

Unterschiedliche Darstellungen können konfiguriert werden, beispielsweise:

```text
Ja / Nein
J / N
Yes / No
True / False
1 / 0
```

Nicht eindeutig zuordenbare Werte erzeugen einen Konflikt.

---

# 5. Fachliche Qualitätsregeln

Neben technischen Format- und Datentypprüfungen unterstützt UniCom fachliche Qualitätsregeln.

Beispiele:

```text
Kundennummer darf nicht leer sein.
E-Mail muss einem gültigen Format entsprechen.
Geburtsdatum darf nicht in der Zukunft liegen.
PLZ muss für das jeweilige Land gültig sein.
Menge darf nicht negativ sein.
```

## Feldübergreifende Regeln

Regeln können mehrere Felder berücksichtigen.

Beispiel:

```text
WENN Zahlungsart = "Lastschrift"
DANN muss IBAN vorhanden sein.
```

oder:

```text
WENN Land = "DE"
DANN muss PLZ einem deutschen Format entsprechen.
```

## Benutzerdefinierte Regeln

Benutzer müssen eigene fachliche Qualitätsregeln definieren können.

Eine Regel kann beispielsweise auslösen:

* Fehler
* Warnung
* Information
* definierte automatische Aktion
* Konflikt

Die Regeln werden versioniert und sind Bestandteil des Profils.

---

# 6. Referenzdaten und Referenzabgleich

UniCom kann Daten gegen externe bzw. bestehende Referenzdaten prüfen.

Als Referenzquelle können unter anderem dienen:

* CSV
* XLSX
* TXT
* JSON
* XML
* Datenbanken
* bestehende UniCom-Daten
* definierte Referenztabellen

Die Referenzquelle wird im Profil definiert.

## Abgleich

Unterstützt werden:

* exakter Abgleich
* zusammengesetzter Schlüssel
* definierte normalisierte Vergleiche
* optional Fuzzy Matching

Ein eindeutiger Treffer kann automatisch übernommen werden.

Kein Treffer kann abhängig vom Profil zu:

* Warnung
* Konflikt
* Ignorierung

führen.

Mehrere plausible Treffer sind nicht automatisch entscheidbar und führen grundsätzlich zu einer Benutzerentscheidung bzw. einem Konflikt.

## Referenzwerte übernehmen

Referenzdaten können neben der Validierung auch zur Ergänzung von Datensätzen verwendet werden.

Dies muss ausdrücklich im Profil definiert sein.

## Schutz der Referenzdaten

Referenzquellen werden grundsätzlich nur gelesen.

Eine Konsolidierung darf die Referenzdaten nicht verändern.

## Referenzversion

Für die Nachvollziehbarkeit muss feststellbar sein, welche Referenzquelle und – soweit möglich – welche Version bzw. welcher Datenstand für einen Verarbeitungslauf verwendet wurde.

---

# 7. Dubletten- und Duplikaterkennung

UniCom muss exakte und fachliche Dubletten erkennen können.

## Exakte Duplikate

Identische Datensätze können anhand definierter Schlüssel erkannt werden.

## Fachliche Dubletten

Nach der Normalisierung können auch technisch unterschiedliche, fachlich identische Datensätze erkannt werden.

Beispielsweise:

```text
Müller GmbH
Mueller GmbH
MÜLLER GMBH
```

## Dublettenschlüssel

Der Benutzer definiert, anhand welcher Felder Dubletten erkannt werden.

Beispiele:

```text
Kundennummer
```

oder:

```text
Nachname + Vorname + Geburtsdatum
```

oder:

```text
Firma + Straße + PLZ
```

UniCom darf fachliche Dublettenschlüssel nicht eigenmächtig als verbindliche Wahrheit bestimmen.

## Fuzzy Matching

Fuzzy Matching ist optional möglich.

Ähnlichkeit allein berechtigt nicht zu einer automatischen Zusammenführung.

Mehrdeutige Fälle werden als Konflikt bzw. Benutzerentscheidung behandelt.

## Verhalten bei Dubletten

Das Profil kann festlegen:

* ersten Datensatz behalten
* letzten Datensatz behalten
* Datensatz nach Priorität auswählen
* Datensätze zusammenführen
* Dublette verwerfen
* Dublette separat ausgeben
* Dublette protokollieren

## Zusammenführen

Wenn mehrere Datensätze keine widersprüchlichen Werte enthalten, dürfen vorhandene Informationen innerhalb einer ausdrücklich definierten Merge-Regel automatisch zu einem vollständigen Datensatz ergänzt werden.

Beispiel:

```text
Datensatz A:
Name = Müller GmbH
Telefon = leer
E-Mail = info@mueller.de

Datensatz B:
Name = Mueller GmbH
Telefon = 069 123456
E-Mail = leer
```

Ergebnis:

```text
Name = Müller GmbH
Telefon = 069 123456
E-Mail = info@mueller.de
```

Widersprüchliche Werte werden entsprechend den Prioritätsregeln behandelt oder als Konflikt vorgelegt.

---

# 8. Priorisierung und Entscheidungsregeln

Wenn mehrere Quellen unterschiedliche Werte für denselben Datensatz liefern, muss UniCom anhand definierter Entscheidungsregeln entscheiden können.

## Quellenpriorität

Quellen können priorisiert werden.

Beispiel:

```text
1. Stammdaten
2. CRM
3. ERP
4. Importdatei
```

## Feldspezifische Priorität

Die Priorität kann je Feld unterschiedlich sein.

Beispiel:

```text
Name:
Stammdaten > CRM > Import

Telefon:
CRM > Stammdaten > Import

E-Mail:
CRM > Import > Stammdaten
```

## Aktualität

Optional kann das Änderungsdatum eines Wertes als Entscheidungsregel verwendet werden.

Dabei darf nicht einfach angenommen werden, dass der zuletzt eingelesene Wert der aktuellste ist.

## Regelhierarchie

Es gilt folgende Entscheidungsreihenfolge:

1. explizite Benutzerregel
2. feldspezifische Regel
3. Quellenpriorität
4. Aktualitätsregel
5. Standardregel
6. keine eindeutige Entscheidung → Konflikt

Benutzerdefinierte Entscheidungsregeln können damit allgemeine Regeln überschreiben.

Sprechen andere verfügbare Informationen eindeutig gegen die eingestellte Quellenpriorität, wird sie nicht stillschweigend übergangen. Es entsteht ein Prüffall nach SPEC-07 (siehe SPEC-09, Abschnitt 6).

Eine ausdrücklich eingestellte Priorität ist der erklärte Wille des Benutzers. Sie ohne Rückfrage zu verwerfen wäre genau die stille Entscheidung, die Abschnitt 1 ausschließt.

## Nachvollziehbarkeit

Bei einer automatischen Entscheidung muss nachvollziehbar sein:

* welche Werte vorlagen
* welcher Wert ausgewählt wurde
* welche Regel angewendet wurde
* welche Quelle Vorrang hatte

---

# 9. Regel-Engine und Ausführungsreihenfolge

Die unterschiedlichen Regelarten werden über eine definierte Verarbeitungspipeline ausgeführt.

Die logische Standardreihenfolge lautet:

```text
Quelldaten
   ↓
1. Einlesen
   ↓
2. technische Normalisierung
   ↓
3. Datentyp-Konvertierung
   ↓
4. Feld-Mapping
   ↓
5. fachliche Normalisierung
   ↓
6. Qualitätsregeln
   ↓
7. Referenzabgleich
   ↓
8. Dublettenerkennung
   ↓
9. Merge / Priorisierung
   ↓
10. Ergebnisprüfung
   ↓
11. Zieldaten
```

Nicht jeder Verarbeitungslauf muss jeden Schritt enthalten.

## Abhängigkeiten

Regeln können von Ergebnissen vorheriger Verarbeitungsschritte abhängen.

UniCom muss verhindern, dass eine Regel in einer fachlich oder technisch unzulässigen Reihenfolge ausgeführt wird.

Der Benutzer kann Regeln innerhalb dafür geeigneter Verarbeitungsschritte konfigurieren, darf jedoch die geschützten Abhängigkeiten der Pipeline nicht umgehen.

## Regelkonflikte

Wenn mehrere Regeln widersprüchliche Ergebnisse erzeugen und anhand der definierten Hierarchie keine eindeutige Entscheidung möglich ist:

→ Konflikt.

UniCom darf keine zufällige oder implizite Auswahl treffen.

## Erkennungsverfahren und Ausbaustufe

V1 arbeitet ausschließlich mit deterministischen Regeln, mit Mustererkennung über
Stichproben (SPEC-02, Abschnitt 4) und mit bestätigten, gelernten Zuordnungen
(SPEC-02, Abschnitt 17).

Eine KI-gestützte Erkennung ist **nicht Bestandteil von V1**. Sie ist als
Ausbaustufe in SPEC-11 beschrieben; ihre Modi und Grenzen werden dort definiert.

Wird sie später aktiviert, gelten die Guardrails dieser SPEC unverändert. Sie darf
sie niemals umgehen.

---

# 10. Test, Simulation und Vorschau

Neue oder geänderte Profile müssen vor dem produktiven Einsatz testbar sein.

Der Benutzer kann eine Beispieldatei bzw. einen ausgewählten Datenbestand im **Preview-/Testmodus** verarbeiten.

Dabei werden keine produktiven Quelldaten verändert und keine produktiven Zielsysteme beschrieben.

Angezeigt werden können insbesondere:

* angewendetes Mapping
* Normalisierungen
* Datentypkonvertierungen
* Qualitätsregeln
* Referenztreffer
* Dubletten
* Merge-Entscheidungen
* Prioritätsentscheidungen
* Konflikte
* erwartetes Ergebnis

Eine Vorher-/Nachher-Darstellung soll relevante Änderungen transparent machen.

Beispiel:

```text
Quelle:
"  Mueller GmbH  "

Normalisierung:
"Mueller GmbH"

Referenzabgleich:
"Müller GmbH" – eindeutiger Treffer

Ergebnis:
"Müller GmbH"
```

Nach dem Test kann der Benutzer das Profil:

* speichern
* freigeben
* produktiv verwenden
* oder Änderungen verwerfen

Ein Testlauf darf keinen produktiven Verarbeitungslauf ersetzen und keine produktiven Daten verändern.

---

# 11. Profilversionierung und Rückverfolgbarkeit

Alle relevanten Einstellungen dieser SPEC sind Bestandteil eines versionierten Profils.

Eine bereits verwendete Profilversion ist **unveränderlich**.

Jede fachlich relevante Änderung erzeugt eine neue Version.

Dazu gehören insbesondere Änderungen an:

* Mapping
* Normalisierung
* Datentypregeln
* Qualitätsregeln
* Referenzabgleich
* Dublettenregeln
* Merge-Regeln
* Prioritätsregeln
* Einstellungen einer späteren KI-Ausbaustufe (SPEC-11)
* benutzerdefinierten Konvertierungsregeln

## Versionsstatus

Eine Profilversion kann beispielsweise folgende Zustände durchlaufen:

```text
Entwurf
   ↓
Getestet
   ↓
Freigegeben
   ↓
Aktiv
```

Nicht freigegebene Versionen dürfen nicht versehentlich produktiv eingesetzt werden.

## Änderungsverlauf

Für jede Version soll nachvollziehbar sein:

* Erstellungszeitpunkt
* Änderungszeitpunkt
* Benutzer
* vorherige Version
* relevante Änderungen
* Teststatus
* Freigabestatus

## Reproduzierbarkeit

Jeder Verarbeitungslauf muss eindeutig auf die verwendete Profilversion verweisen.

Damit entsteht die vollständige Kette:

```text
Verarbeitungslauf
      ↓
Profil
      ↓
Profilversion
      ↓
Regeln
```

Dadurch muss auch später nachvollziehbar sein, **warum ein Verarbeitungslauf ein bestimmtes Ergebnis erzeugt hat**.

---

# Verbindliche Grundprinzipien von SPEC-04

1. **Keine Änderung aufgrund bloßer Vermutung.**
2. **Eindeutige Regeln dürfen automatisch ausgeführt werden.**
3. **Mehrdeutige Fälle werden nicht automatisch entschieden.**
4. **Normalisierung und fachliche Korrektur werden strikt unterschieden.**
5. **Benutzer können eigene Normalisierungs-, Konvertierungs- und Qualitätsregeln definieren.**
6. **Mapping kann explizit oder automatisiert vorgeschlagen werden.**
7. **Mehrere Quellen können über definierte Regeln zusammengeführt werden.**
8. **Referenzdaten werden grundsätzlich nur gelesen.**
9. **Dubletten dürfen nur nach definierten Regeln zusammengeführt oder verworfen werden.**
10. **Widersprüchliche Werte werden nach einer definierten Priorität aufgelöst oder als Konflikt behandelt.**
11. **Die Regel-Engine besitzt eine geschützte Verarbeitungspipeline.**
12. **Eine KI-gestützte Erkennung ist nicht Bestandteil von V1; wird sie später aktiviert, darf sie keine Guardrails umgehen.**
13. **Profile und alle fachlich relevanten Regeln sind versioniert.**
14. **Bereits verwendete Profilversionen sind unveränderlich.**
15. **Neue oder geänderte Profile müssen testbar sein, ohne produktive Daten zu verändern.**
16. **Jeder Verarbeitungslauf verweist eindeutig auf die verwendete Profilversion.**

**SPEC-04 ist damit final.**

---

# Änderungsverzeichnis

## Version 1.3

**Abschnitt 6:** XLS ist als Referenzquelle gestrichen (siehe SPEC-02,
Abschnitt 2.2).

## Version 1.2

**Abschnitt 8:** Ergänzt, was geschieht, wenn andere Informationen gegen die
eingestellte Quellenpriorität sprechen: ein Prüffall, kein stilles Übergehen.

SPEC-09, Abschnitt 6, verlangte, eine definierte Quellenpriorität nicht „blind"
anzuwenden — damit hätte eine Aktualitätsangabe die Rangfolge dieses Abschnitts
unbemerkt aushebeln können.

## Version 1.1

**Abschnitt 1:** Die dritte zulässige Grundlage für eine automatische Änderung
hing an einer „ausdrücklich aktivierten KI-Regel". Sie hängt jetzt an einer
Erkennungsregel mit der Confidence-Schwelle aus SPEC-02.

**Abschnitt 3 und 6:** Die Nebenerwähnungen der KI-Unterstützung sind entfallen.

**Abschnitt 9:** Der Block „KI-Integration" ist durch „Erkennungsverfahren und
Ausbaustufe" ersetzt.

Der bisherige Text verwies auf „die bereits definierten Modi" — diese Modi waren
in SPEC-01 bis SPEC-03 nirgends definiert. Zugleich kannte SPEC-01 keine
KI-Komponente und sagte zu, dass Kundendaten die lokale Umgebung nicht verlassen.
Die Modi stehen jetzt in SPEC-11 und sind ausdrücklich keine V1-Fähigkeit.

**Grundprinzip 12** entsprechend angepasst.
