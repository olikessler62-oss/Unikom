# SPEC-08 – Datenvalidierung, intelligente Erkennung und Ergebnisfreigabe

## 1. Zweck und Grundprinzip

UniCom muss Daten vor, während und nach relevanten Verarbeitungsschritten anhand definierter technischer und fachlicher Regeln validieren können.

Validierungen müssen zwischen gültigen Daten, Warnungen, korrigierbaren Problemen, ungültigen Daten und kritischen Fehlern unterscheiden.

Daten dürfen nur dann automatisch verändert oder korrigiert werden, wenn hierfür eine definierte oder zuverlässig erkannte Grundlage besteht.

UniCom soll den Benutzer bei der Definition und Pflege von Regeln weitestgehend entlasten. Eindeutig erkennbare Datenmuster und Konvertierungen sollen möglichst automatisch erkannt und verarbeitet werden.

## 2. Datenvalidierung vor der Verarbeitung

Vor Beginn einer Verarbeitung muss UniCom die Eingangsdaten auf grundlegende technische und strukturelle Verarbeitbarkeit prüfen.

Dabei sind unter anderem zu prüfen:

* Lesbarkeit
* Dateiformat
* vorhandene Tabellenblätter
* vorhandene und erwartete Spalten
* grundlegende Datentypen
* erforderliche Strukturen
* offensichtliche Datenprobleme

Die Ergebnisse müssen eindeutig klassifiziert werden können.

Kritische Fehler, die eine sichere Verarbeitung verhindern, müssen vor Beginn der Verarbeitung erkannt und dem Benutzer verständlich angezeigt werden.

## 3. Datentypen und automatische Konvertierung

UniCom muss Datentypen erkennen und Daten anhand definierter Regeln zwischen kompatiblen Datentypen konvertieren können.

Eindeutige und zuverlässig erkennbare Konvertierungen dürfen automatisch durchgeführt werden.

Mehrdeutige oder nicht eindeutig interpretierbare Werte dürfen nicht ohne ausreichende Grundlage automatisch umgewandelt werden.

Nicht konvertierbare Werte müssen entsprechend den definierten Fehler- oder Konfliktregeln behandelt werden.

Benutzer müssen eigene Datentyp- und Konvertierungsregeln definieren können.

## 4. Intelligente und benutzerdefinierte Konvertierungsregeln

UniCom muss den Benutzer bei der Definition von Konvertierungsregeln weitestgehend entlasten.

Das System soll bekannte und aus Daten, Feldbezeichnungen, Kontext und vorhandenen Wertemustern eindeutig ableitbare Datentypen und Konvertierungen möglichst automatisch erkennen und anwenden können.

Grundlage sind dabei die tatsächlich vorhandenen Werte, die Feldbezeichnung, das Profil und bereits bestätigte Entscheidungen.

Eine KI-gestützte Erkennung ist nicht Bestandteil von V1; die Ausbaustufe beschreibt SPEC-11.

Beispielsweise sollen Werte wie:

* `Ja`
* `Nein`
* `Yes`
* `No`
* `True`
* `False`
* `J`
* `N`
* `Y`

bei ausreichender Eindeutigkeit automatisch als Boolean-Werte erkannt und entsprechend konvertiert werden können.

Dabei gelten drei Grundstufen:

1. **Eindeutig erkannt**
   → automatische Verarbeitung.

2. **Wahrscheinlich, aber nicht vollständig eindeutig**
   → Benutzerbestätigung bzw. transparente Vorschlagsentscheidung.

3. **Nicht eindeutig oder widersprüchlich**
   → keine eigenmächtige Interpretation; vorhandene Regeln oder Benutzerentscheidung erforderlich.

Explizit definierte Benutzerregeln haben Vorrang und dürfen nicht unbemerkt durch automatische Interpretationen außer Kraft gesetzt werden.

Benutzerdefinierte Regeln müssen gespeichert, wiederverwendet, versioniert und einem Verarbeitungslauf eindeutig zugeordnet werden können.

UniCom darf nicht voraussetzen, dass der Benutzer für jedes auftretende Datenformat eine eigene Regel erstellt.

## 5. Pflichtfelder und fehlende Werte

UniCom muss fehlende, leere, nicht vorhandene und als Platzhalter verwendete Werte unterscheiden und anhand definierter oder zuverlässig erkannter Regeln bewerten können.

Ob ein fehlender Wert zulässig ist, muss vom jeweiligen Feld und Verarbeitungskontext abhängig sein.

UniCom soll vorhandene Datenbestände, vergleichbare Datensätze, Folgedaten, historische Datenstände und weitere verfügbare Informationen nutzen, um einen fehlenden Wert möglichst automatisch und nachvollziehbar zu bestimmen.

Ist ein relevanter Wert bei vergleichbaren Datensätzen konsistent vorhanden und lässt sich seine Übernahme eindeutig begründen, darf UniCom den fehlenden Wert automatisch ergänzen.

Bei unterschiedlichen, widersprüchlichen oder nicht ausreichend belastbaren Werten darf keine willkürliche Auswahl erfolgen.

UniCom muss zunächst weitere verfügbare Erkennungsmöglichkeiten und definierte Regeln prüfen.

Ist anschließend keine ausreichend sichere Entscheidung möglich, wird der Fall als Konflikt bzw. Prüffall an den Benutzer übergeben.

Jede automatische Ergänzung muss nachvollziehbar dokumentiert werden.

## 6. Wertebereiche und Formatprüfungen

UniCom muss Werte auf formale Gültigkeit, zulässige Wertebereiche und erkennbare Plausibilität prüfen können.

Neben explizit definierten Regeln sollen auch vorhandene Datenmuster, Vergleichsdaten und weitere verfügbare Kontextinformationen zur Erkennung ungewöhnlicher oder fehlerhafter Werte genutzt werden.

UniCom muss zwischen eindeutig ungültigen Werten und lediglich ungewöhnlichen, aber möglicherweise korrekten Werten unterscheiden.

Eindeutig ungültige Werte sind entsprechend den definierten Verarbeitungsregeln zu behandeln.

Bei lediglich auffälligen Werten soll eine Warnung oder ein Prüffall erzeugt werden, sofern keine sichere automatische Entscheidung möglich ist.

## 7. Referenz- und Abhängigkeitsprüfungen

UniCom muss Daten auch im Zusammenhang mit anderen Daten prüfen können.

Dabei sind insbesondere zu berücksichtigen:

* Referenzen
* Abhängigkeiten
* zulässige Wertkombinationen
* Beziehungen zwischen Datensätzen
* Beziehungen zwischen Feldern

Eindeutig erkennbare Referenzen und Abhängigkeiten sollen möglichst automatisch erkannt und geprüft werden.

Nicht eindeutig erkennbare Beziehungen dürfen nicht ohne ausreichende Grundlage angenommen werden.

Widersprüchliche oder nicht auflösbare Abhängigkeiten sind entsprechend ihrer Bedeutung als Warnung, Fehler oder Konflikt zu behandeln.

## 8. Umgang mit ungültigen Datensätzen

UniCom muss ungültige oder nicht sicher verarbeitbare Datensätze eindeutig erkennen und entsprechend klassifizieren.

Die konkrete Behandlung daraus entstehender Konflikte, Prüffälle und manueller Entscheidungen erfolgt gemäß **SPEC-07 – Konfliktprüfung und Benutzerbearbeitung**.

UniCom darf betroffene Datensätze weder stillschweigend verwerfen noch ihre ursprünglichen Werte unkontrolliert verändern.

Soweit eine eindeutige automatische Korrektur möglich ist, soll diese gemäß den in SPEC-08 definierten Validierungs- und Erkennungsmechanismen erfolgen.

Nicht eindeutig lösbare Fälle werden gemäß SPEC-07 als Prüf- bzw. Konfliktfälle weitergegeben.

Gültige Datensätze sollen unabhängig davon weiterverarbeitet werden können, sofern kein übergeordneter kritischer Fehler die gesamte Verarbeitung verhindert.

## 9. Warnungen und blockierende Fehler

UniCom muss Validierungsergebnisse mindestens in Hinweise, Warnungen und blockierende bzw. kritische Fehler unterscheiden können.

Nicht jede Auffälligkeit darf die Verarbeitung blockieren.

Nicht eindeutig falsche, aber ungewöhnliche Werte können als Hinweis oder Warnung protokolliert werden.

Eine Verarbeitung darf nur dann blockiert oder ein Datensatz separiert werden, wenn eine sichere Verarbeitung aufgrund eines erkannten Fehlers oder einer nicht zulässigen Struktur nicht möglich ist.

Die Einstufung soll soweit zuverlässig möglich anhand von:

* Datenmustern
* Kontext
* Abhängigkeiten
* historischen Informationen
* vorhandenen Regeln

erfolgen.

Die Ursache und Auswirkung jeder Warnung oder jedes Fehlers müssen dem Benutzer in verständlicher Sprache erklärt werden.

## 10. Validierung des Verarbeitungsergebnisses

UniCom muss das Verarbeitungsergebnis nach relevanten Verarbeitungsschritten und insbesondere vor der Freigabe der Zieldatei erneut validieren.

Dabei sind technische, strukturelle, fachliche und Plausibilitätsprüfungen durchzuführen.

Ein Ergebnis darf nicht allein aufgrund eines fehlerfreien technischen Ablaufs als fachlich korrekt gelten.

UniCom muss unter anderem prüfen können:

* Vollständigkeit
* Datensatzanzahl
* Duplikate
* Pflichtwerte
* Datentypen
* Referenzen
* Abhängigkeiten
* Einhaltung der definierten Zielstruktur
* wesentliche Abweichungen gegenüber dem Ausgangs- bzw. Arbeitsbestand

Auffällige Abweichungen zwischen Ausgangs-, Arbeits- und Ergebnisbestand müssen erkannt und verständlich angezeigt werden.

## 11. Vorschau und Testlauf

UniCom muss einen unveränderlichen Test- bzw. Vorschaulauf ermöglichen, mit dem die Auswirkungen einer geplanten Verarbeitung vor der endgültigen Ausführung ermittelt und dargestellt werden können.

Der Testlauf darf Originaldaten nicht verändern.

Er muss insbesondere sichtbar machen können:

* erwartete Konvertierungen
* automatische Korrekturen
* Zusammenführungen
* Warnungen
* Konflikte
* nicht verarbeitbare Datensätze
* wesentliche Veränderungen des Ergebnisses

Automatisch erkannte Entscheidungen müssen dabei transparent als solche kenntlich gemacht werden.

Das Ergebnis des Testlaufs soll als Grundlage für die anschließende tatsächliche Verarbeitung verwendet werden können, ohne bereits getroffene Konfigurationen erneut erfassen zu müssen.

## 12. Protokollierung und Nachvollziehbarkeit der Validierung

UniCom muss die Ergebnisse der Validierung nachvollziehbar protokollieren.

Für erfolgreich validierte Daten soll eine kompakte Zusammenfassung ausreichen.

Auffällige, fehlerhafte oder automatisch veränderte Werte müssen detaillierter dokumentiert werden.

Bei automatischen Entscheidungen muss nachvollziehbar sein:

* welche Änderung vorgenommen wurde
* auf welcher Datengrundlage sie erfolgte
* welche Erkennung oder Regel verwendet wurde
* ob eine Benutzerentscheidung erforderlich war

Die detaillierte Bearbeitung und Historie von Konflikten erfolgt gemäß SPEC-07 und wird in SPEC-08 nicht redundant geführt.

## 13. Freigabe des validierten Ergebnisses

UniCom muss nach Abschluss der Validierung eindeutig feststellen und anzeigen, ob ein Verarbeitungsergebnis freigegeben werden kann.

Dabei sind insbesondere zu berücksichtigen:

* blockierende Fehler
* offene kritische Konflikte
* Warnungen
* sonstige ungeklärte Prüffälle
* konfigurierte Freigabebedingungen

Die Freigabefähigkeit muss dem Benutzer in verständlicher Sprache angezeigt werden.

Die endgültige Zieldatei darf erst nach Erfüllung der definierten Freigabebedingungen als gültiges Ergebnis freigegeben werden.

### Automatische und manuelle Freigabe

Liegen keine blockierenden Fehler, keine offenen kritischen Konflikte und keine
unerfüllten Freigabebedingungen vor, gibt UniCom das Ergebnis selbst frei.

Andernfalls wartet der Lauf im Status `WAITING_FOR_RELEASE` (SPEC-01, Abschnitt
14) und wird erst durch einen Benutzer freigegeben.

Ein nicht freigegebenes Ergebnis ist kein gültiges Ergebnis. Es darf von Modul 3
nicht übernommen werden (SPEC-02, Abschnitt 38).

Damit bleibt der Hintergrundbetrieb möglich: ein geplanter Lauf um zwei Uhr
nachts hat keinen Benutzer, der freigeben könnte, und darf deshalb nicht auf
einen warten, wenn nichts gegen die Freigabe spricht.

Die Freigabe muss nachvollziehbar dokumentiert werden, einschließlich:

* Verarbeitungslauf
* Ergebnisstand
* Zeitpunkt
* Benutzer bzw. Kennzeichnung als automatische Freigabe
* die Bedingungen, die die Freigabe getragen haben
* zugrunde liegende Validierungsergebnisse

## Grundprinzip von SPEC-08

UniCom soll **nicht** zu einem System werden, bei dem der Benutzer für jede denkbare Datenvariante hunderte oder tausende Regeln manuell erstellen muss.

Stattdessen gilt:

> **So viel intelligente automatische Erkennung wie zuverlässig möglich – so wenig manuelle Regeln wie nötig.**

Explizite Regeln dienen der Kontrolle und Absicherung dort, wo automatische Erkennung nicht ausreichend sicher ist.

Unsicherheit muss transparent gemacht werden. UniCom darf aus Unsicherheit keine scheinbare Gewissheit erzeugen.

## Status

**SPEC-08 – FINAL, Version 1.1**

Diese Spec ist abgeschlossen und wird nicht verändert, sofern keine ausdrückliche Änderung beauftragt wird.

## Änderungsverzeichnis

### Version 1.1

**Abschnitt 4, 9, 11 und 12:** Die KI-gestützte Erkennung ist entfallen; sie ist
als Ausbaustufe in SPEC-11 beschrieben.

SPEC-01 kannte keine KI-Komponente und sagt zu, dass Kundendaten die lokale
Umgebung nicht verlassen. Solange diese Spec ihre Einstufungen auf KI stützte,
stand beides nebeneinander.

**Abschnitt 13:** Die Freigabe erfolgt automatisch, wenn nichts sie blockiert,
und nur andernfalls durch einen Benutzer.

Bisher verlangte die Spec für jede Freigabe einen dokumentierten Benutzer. Ein
geplanter Nachtlauf hat keinen; sein Ergebnis wäre bis zum Morgen ungültig
geblieben, ohne dass der Statuskatalog dafür einen Namen hatte.
