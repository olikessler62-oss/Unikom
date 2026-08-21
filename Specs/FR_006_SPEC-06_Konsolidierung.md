# SPEC-06 – Mehrdateien-Konsolidierung

## 1. Zweck und Grundprinzip

SPEC-06 definiert die Verarbeitung und Konsolidierung mehrerer Datenquellen zu einem konsolidierten Datenbestand.

UniCom muss sowohl das einfache Zusammenführen gleichartiger Datenquellen als auch die schlüsselbasierte Zusammenführung logisch zusammengehöriger Daten unterstützen.

Die Art der Konsolidierung muss eindeutig konfiguriert und für jeden Verarbeitungslauf nachvollziehbar sein.

## 2. Eingangsdaten und Quellen

Eine Konsolidierung kann mehrere explizit ausgewählte oder eindeutig regelbasiert bestimmte Eingangsdatenquellen umfassen.

Die Quellen können unterschiedliche Strukturen besitzen und werden über die definierten Mapping- und Referenzregeln auf die gemeinsame Zielstruktur abgebildet.

Jede verwendete Quelle muss eindeutig identifizierbar und dem Verarbeitungslauf zuordenbar sein.

Nicht ausdrücklich ausgewählte oder eindeutig über eine Regel bestimmte Dateien dürfen nicht automatisch Bestandteil einer Konsolidierung werden.

## 3. Konsolidierungsschlüssel

Für eine schlüsselbasierte Konsolidierung muss ein eindeutiger Konsolidierungsschlüssel definiert werden können.

Der Schlüssel kann aus einem einzelnen Feld, mehreren Feldern oder einem regelbasiert erzeugten Wert bestehen.

Fehlende oder nicht eindeutige Schlüssel dürfen nicht zu einer willkürlichen Zuordnung führen, sondern müssen gemäß definierter Dubletten-, Konflikt- oder Fallback-Regeln behandelt werden.

## 4. Append und Merge

UniCom unterscheidet explizit zwischen **Append** und **Merge**.

Beim Append werden Datensätze mehrerer Quellen in einen gemeinsamen Datenbestand übernommen.

Beim Merge werden logisch zusammengehörige Datensätze anhand eines definierten Konsolidierungsschlüssels zusammengeführt.

Beide Verfahren können innerhalb eines Verarbeitungslaufs kombiniert werden.

Die gewünschte Konsolidierungsart muss konfiguriert sein und darf nicht automatisch aus den Eingangsdaten abgeleitet werden.

### Führende Quelle

Append und Merge beschreiben, **wie** Datensätze zusammenkommen. Davon getrennt zu konfigurieren ist, **ob eine Quelle führt**:

**Mit führender Quelle — Anreichern.** Eine Hauptdatei liefert die Referenzdatensätze, weitere Quellen ergänzen sie. Ein Datensatz einer Zusatzquelle ohne Bezug zur Hauptdatei wird zum Konflikt. Es gelten SPEC-02, Abschnitt 26 bis 30.

**Ohne führende Quelle — Sammeln.** Alle Quellen sind gleichwertig. Ein Append übernimmt ihre Datensätze in einen gemeinsamen Bestand; ein Merge vereinigt sie je Konsolidierungsschlüssel. Ein fehlender Bezug ist hier kein Konflikt, weil es keine Quelle gibt, auf die er sich beziehen müsste.

Auch dies wird eingestellt und nicht aus den Eingangsdaten abgeleitet.

## 5. Priorität bei konkurrierenden Werten

Bei konkurrierenden Werten aus mehreren Quellen entscheidet UniCom nur, wenn die Entscheidung begründbar ist.

Der Benutzer kann Quellen-, feldspezifische und wertbezogene Entscheidungsregeln definieren.

Mögliche Entscheidungsgrundlagen sind beispielsweise:

* Quellenpriorität
* feldspezifische Quellenpriorität
* Änderungsdatum
* Erstellungsdatum
* Aktualität
* Vollständigkeit
* Kombination mehrerer Kriterien

UniCom stellt hierfür alle verfügbaren relevanten Metadaten, insbesondere Quelle, Erstellungs- und Änderungszeitpunkt sowie Import- und Datenstandsinformationen, bereit.

Liegt eine konfigurierte Entscheidungsregel vor, gilt sie.

Liegt keine vor, darf UniCom aus den verfügbaren Metadaten selbst entscheiden, wenn das Ergebnis die Schwelle aus SPEC-02, Abschnitt 5, erreicht und die tragende Begründung festgehalten wird (SPEC-09, Abschnitt 7).

Andernfalls wird ein Konflikt erzeugt.

Eine Entscheidung ohne festgehaltene Begründung ist keine zulässige Entscheidung.

## 6. Dubletten innerhalb und zwischen Quellen

UniCom erkennt Dubletten innerhalb einzelner Quellen sowie quellenübergreifend anhand der definierten Konsolidierungs- und Identifikationsregeln.

Dubletten werden niemals ungefragt gelöscht.

Ihre Behandlung kann automatisch gemäß definierter Regeln oder durch eine manuelle Benutzerentscheidung erfolgen.

Der Benutzer muss Dubletten:

* zusammenführen,
* einzelne Datensätze übernehmen,
* einzelne Datensätze löschen,
* oder unverändert beibehalten

können.

Bei manueller Zusammenführung muss eine feldweise Auswahl bzw. Bearbeitung der resultierenden Werte möglich sein.

Alle manuellen Entscheidungen werden nachvollziehbar protokolliert.

## 7. Reihenfolge der Konsolidierung

Die Reihenfolge mehrerer Konsolidierungsschritte muss eindeutig bestimmbar sein.

Sie kann durch den Benutzer explizit festgelegt oder über definierte Abhängigkeiten und Prioritäten bestimmt werden.

Eine automatisch ermittelte Reihenfolge darf keine fachliche Entscheidung ersetzen.

Ist die Reihenfolge für ein korrektes Ergebnis relevant und nicht eindeutig bestimmbar, muss UniCom dies erkennen und melden.

## 8. Konsolidierung von Excel-Tabellenblättern

Bei XLSX-Dateien können mehrere Tabellenblätter als eigenständige Eingangsdatenquellen einer Konsolidierung verwendet werden.

Tabellenblätter müssen sowohl über ihren Namen als auch über ihre Position ausgewählt werden können.

Jedes ausgewählte Tabellenblatt wird eindeutig der Konsolidierung zugeordnet und gemäß den definierten Mapping- und Konsolidierungsregeln verarbeitet.

Fehlt ein ausdrücklich konfiguriertes Tabellenblatt, darf kein anderes Tabellenblatt ersatzweise verwendet werden. UniCom muss dies eindeutig melden.

## 9. Konsolidierungsprofil und Übernahme bestehender Einstellungen

Für eine neue Konsolidierung müssen bestehende Profile, Vorlagen und kompatible Einstellungen wiederverwendbar sein.

Einstellungen können entweder explizit festgelegt oder aus einer bestehenden Definition übernommen werden.

Übernommene Einstellungen müssen als solche erkennbar sein und können für das neue Profil explizit überschrieben werden.

UniCom soll dadurch den Konfigurationsaufwand reduzieren, ohne die vollständige fachliche Kontrolle des Benutzers einzuschränken.

## 10. Fehler-, Konflikt- und Ausnahmebehandlung

UniCom muss mindestens folgende Fälle eindeutig unterscheiden:

* technische Fehler
* Strukturfehler
* Datenfehler
* Konsolidierungskonflikte
* Dublettenfälle

Diese müssen gemäß konfigurierbaren Regeln behandelt werden können, beispielsweise durch:

* Fortsetzen der Verarbeitung
* Überspringen eines Datensatzes
* Zurückstellen eines Datensatzes
* Erzeugen eines Konflikts
* Anforderung einer manuellen Entscheidung
* Abbruch der Verarbeitung

Fehler und Konflikte dürfen nicht durch stillschweigende Ersatzentscheidungen verborgen werden.

Eine teilweise erfolgreiche Konsolidierung muss optional möglich sein. Fehlerhafte oder ungeklärte Datensätze müssen dabei eindeutig separiert und nachvollziehbar dokumentiert werden.

### Verständliche Fehlerkommunikation

Alle Fehler, Strukturprobleme, Konflikte und Ausnahmen müssen dem Benutzer in klarer und verständlicher Sprache erklärt werden.

Eine Meldung soll, soweit möglich, enthalten:

* betroffene Datei bzw. Quelle
* betroffenes Tabellenblatt
* betroffenes Feld bzw. betroffene Spalte
* erwarteten Zustand
* tatsächlich vorgefundenen Zustand
* Ursache des Problems
* mögliche nächste Schritte

Technische Detailinformationen können zusätzlich für Experten bereitgestellt werden, dürfen aber die verständliche Erklärung nicht ersetzen.

## 11. Vorschau und Prüflauf

UniCom muss vor einer produktiven Konsolidierung einen optionalen Prüflauf bzw. eine Vorschau ermöglichen.

Dabei werden unter anderem dargestellt:

* vorgesehene Quellen
* ausgewählte Tabellenblätter
* verwendete Definitionen
* erwartete Zusammenführungen
* erkannte Dubletten
* erkannte Konflikte
* voraussichtlich nicht verarbeitbare Datensätze

Die Vorschau soll konkrete Beispielergebnisse und erforderliche Entscheidungen sichtbar machen.

Der Prüflauf darf keine produktiven Daten verändern.

## 12. Ergebnis und Nachvollziehbarkeit

Nach Abschluss einer Konsolidierung muss UniCom das Ergebnis einschließlich Quellen, Verarbeitungslauf, verwendeten Definitionen, Datensatzmengen, Zusammenführungen, Dubletten, Konflikten, Fehlern und manuellen Entscheidungen nachvollziehbar dokumentieren.

Die Herkunft konsolidierter Daten muss soweit möglich bis zu den jeweiligen Eingangsdaten zurückverfolgbar sein.

Problematische oder ungeklärte Datensätze müssen eindeutig identifizierbar und zur Nachbearbeitung verfügbar sein.

## 13. Wiederholbarkeit und Reproduzierbarkeit

Jeder Konsolidierungslauf muss so dokumentiert werden, dass seine fachlichen und technischen Rahmenbedingungen nachvollziehbar und, soweit die verwendeten Eingangsdaten verfügbar sind, reproduzierbar sind.

Dazu gehören insbesondere:

* verwendete Eingangsdaten und deren Datenstände
* Mapping-Versionen
* Referenz-Versionen
* Konsolidierungsregeln
* Prioritäts- und Dublettenregeln
* relevante Benutzerentscheidungen
* relevante Softwareversion

Eine erneute Verarbeitung erzeugt stets einen neuen Verarbeitungslauf und verändert historische Verarbeitungsläufe nicht.

## 14. Wiederherstellung und gezielte Korrektur

Die Konsolidierung darf die Eingangsdaten grundsätzlich nicht verändern.

Jeder Konsolidierungslauf erzeugt einen eigenständigen Ergebnisbestand.

Historische Ergebnisstände und Entscheidungen bleiben unverändert erhalten.

Ein vorheriger gültiger Ergebnisstand muss, sofern verfügbar, wiederherstellbar sein.

Zusätzlich muss eine gezielte Korrektur einzelner Konflikte und ausdrücklich als kritisch gekennzeichneter Fälle möglich sein.

Der Benutzer kann dabei beispielsweise:

* eine Konfliktentscheidung ändern
* eine fehlerhafte Zusammenführung korrigieren
* einen einzelnen Wert korrigieren
* einen Datensatz entfernen oder wiederherstellen

Solche Korrekturen laufen als eigener Verarbeitungslauf mit eigener Verarbeitungs-ID, der auf den ursprünglichen verweist (SPEC-01, Abschnitt 9).

Sie erzeugen einen neuen Ergebnisstand und verändern die Historie des ursprünglichen Laufs nicht.

## 15. Skalierbarkeit und Ressourcensteuerung

UniCom soll vor und während einer Konsolidierung die verfügbaren Systemressourcen berücksichtigen.

Bei großen Datenmengen muss die Verarbeitung in mehrere klar definierte Verarbeitungsschritte aufgeteilt werden können.

Zwischenstände werden separat und eindeutig dem jeweiligen Verarbeitungslauf zugeordnet gespeichert.

Der Benutzer wird transparent informiert über:

* die schrittweise Verarbeitung
* die Anzahl geplanter Schritte
* den aktuellen Verarbeitungsschritt
* den Fortschritt
* die verbleibende Datenmenge
* die verfügbaren bzw. relevanten Ressourcen

Die Größe der Verarbeitungsschritte ist nicht fest auf eine bestimmte Datensatzanzahl beschränkt, sondern muss abhängig von Datenmenge, Datenstruktur, Konfiguration und verfügbaren Ressourcen bestimmt bzw. konfiguriert werden können.

UniCom ist primär für normale operative Datenkonsolidierung ausgelegt, soll aber auch größere Datenmengen kontrolliert verarbeiten können, sofern die Systemressourcen dies zulassen.

Eine Verarbeitung kann bei Bedarf blockweise bzw. gestreamt erfolgen. Soweit technisch möglich, soll eine unterbrochene Verarbeitung fortgesetzt werden können, ohne bereits erfolgreich verarbeitete Eingangsdaten zu verändern.

---

## Status

**SPEC-06 – FINAL, Version 1.3**

Die SPEC ist abgeschlossen und wird nicht erneut verändert, sofern keine ausdrückliche Änderung beauftragt wird.

## Änderungsverzeichnis

### Version 1.3

**Abschnitt 8:** XLS ist gestrichen; es bleibt XLSX.

### Version 1.2

**Abschnitt 5:** UniCom darf bei konkurrierenden Werten auch ohne konfigurierte
Regel entscheiden, wenn die Schwelle erreicht ist und die Begründung festgehalten
wird.

Bisher stand hier „entscheidet nicht eigenständig" und in SPEC-09, Abschnitt 7,
„soll möglichst automatisch konsolidieren" — für denselben Fall zwei
entgegengesetzte Anweisungen.

**Abschnitt 14:** Eine gezielte Korrektur läuft als eigener Verarbeitungslauf mit
eigener Kennung, nicht als bloßer neuer Ergebnisstand.

### Version 1.1

**Abschnitt 4:** Der Unterabschnitt „Führende Quelle" ist ergänzt.

SPEC-02, Abschnitt 26, verlangte für jede Dateigruppe genau eine Hauptdatei, und
Abschnitt 30 machte jeden Datensatz ohne Bezug darauf zum Konflikt. Diese Spec
kannte den Begriff Hauptdatei nicht. Bei einem Append gleichartiger Quellen wäre
damit jeder Datensatz der zweiten Quelle ein Konflikt gewesen.

Ob eine Quelle führt, ist jetzt eine eigene Einstellung neben Append und Merge.
