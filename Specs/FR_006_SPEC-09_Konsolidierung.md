# SPEC-09 – Intelligentes Datenmapping und Feldzuordnung

## 1. Zweck und Grundprinzip

UniCom muss Datenfelder aus unterschiedlichen Quellen intelligent erkennen, einander zuordnen und in eine definierte Zielstruktur überführen können.

Die Zuordnung soll soweit zuverlässig möglich automatisch anhand von Feldbezeichnungen, Datentypen, Dateninhalten, Strukturen, Kontext und weiteren verfügbaren Informationen erfolgen.

Der Benutzer soll nur bei nicht eindeutig lösbaren Zuordnungen eingreifen müssen.

Automatisch erkannte Zuordnungen müssen nachvollziehbar dargestellt und vor der endgültigen Verarbeitung überprüfbar sein.

## 2. Datenmapping und Feldzuordnung

UniCom muss Quellfelder eindeutig oder regelbasiert Zielfeldern zuordnen können.

Dabei müssen sowohl direkte Zuordnungen als auch Zuordnungen mit unterschiedlichen Feldbezeichnungen unterstützt werden.

Sofern fachlich und technisch zulässig, müssen:

* mehrere Quellfelder zu einem Zielfeld zusammengeführt werden können
* einzelne Quellfelder auf mehrere Zielfelder aufgeteilt werden können

Nicht eindeutig zuordenbare Felder dürfen nicht eigenmächtig einem Zielfeld zugewiesen werden, sondern müssen als ungeklärt gekennzeichnet und entsprechend den definierten Prüf- bzw. Benutzerprozessen behandelt werden.

## 3. Automatische Erkennung von Feldzuordnungen

UniCom muss Feldzuordnungen möglichst automatisch erkennen können.

Hierzu sollen unter anderem berücksichtigt werden:

* Feldbezeichnungen
* alternative Schreibweisen
* Sprache
* Datentypen
* tatsächliche Datenwerte
* Werteformate
* Datenstrukturen
* Abhängigkeiten
* bereits bekannte Zuordnungen
* bestätigte frühere Entscheidungen
* semantische Erkennung über die ausgelieferte Bezeichnungsliste (Abschnitt 4)

Eindeutig erkennbare Zuordnungen sollen automatisch angewendet werden.

Wahrscheinliche, aber nicht vollständig eindeutige Zuordnungen sollen als verständlicher Vorschlag dargestellt und gegebenenfalls vom Benutzer bestätigt werden.

Mehrdeutige Zuordnungen dürfen nicht eigenmächtig vorgenommen werden.

Bestätigte oder korrigierte Zuordnungsentscheidungen sollen für zukünftige Verarbeitungsläufe wiederverwendbar sein können.

## 4. Semantische Zuordnung unterschiedlicher Feldbezeichnungen

UniCom muss semantisch gleichbedeutende Feldbezeichnungen unabhängig von Schreibweise, Sprache und Format möglichst automatisch erkennen können.

Beispiele sind unter anderem:

* `Customer ID`
* `Kundennummer`
* `Customer No.`
* `Kunden-Nr.`

oder:

* `DOB`
* `Date of Birth`
* `Geburtsdatum`

Grundlage dafür ist eine mit UniCom **ausgelieferte Bezeichnungsliste**: bekannte
Feldbezeichnungen, ihre Schreibweisen in mehreren Sprachen und ihre Zuordnung zu
den internen Feldern.

Sie wird wie ein Programmbestandteil gepflegt und ausgeliefert und ist durch den
Kunden erweiterbar. Mandantenspezifische Einträge gehen den ausgelieferten vor
(SPEC-02, Abschnitt 16).

Ohne diese Liste bliebe der Anspruch dieser Spec unerfüllbar: V1 enthält keine
KI, die Bedeutung aus einem Feldnamen ableitet (SPEC-11), und der Benutzer soll
die Zuordnungen gerade nicht selbst pflegen müssen.

Die semantische Zuordnung darf nicht ausschließlich anhand des Feldnamens erfolgen.

Zusätzlich müssen insbesondere berücksichtigt werden:

* Datentyp
* tatsächliche Werte
* benachbarte Felder
* Datenstruktur
* Kontext
* weitere verfügbare Informationen

Mehrdeutige Begriffe dürfen nicht isoliert interpretiert werden.

Die semantische Zuordnung und die anschließende technische Konvertierung sind logisch voneinander zu trennen und gemäß den jeweiligen Regeln der betroffenen SPECs zu behandeln.

## 5. Zusammenführung mehrerer Quellen

UniCom muss mehrere Datenquellen mit unterschiedlichen Strukturen gemeinsam auf eine definierte Zielstruktur abbilden können.

Dabei müssen insbesondere berücksichtigt werden:

* unterschiedliche Feldstrukturen
* vorhandene und fehlende Felder
* unterschiedliche Datenumfänge
* unterschiedliche Formate
* unterschiedliche Datensatzstrukturen

UniCom soll möglichst automatisch erkennen, welche Datenquellen zu gemeinsamen Datensätzen beitragen und welche Informationen aus mehreren Quellen zusammengeführt werden können.

Fehlende Felder einer einzelnen Quelle dürfen nicht automatisch als Fehler gelten, wenn der benötigte Wert aus anderen Quellen oder eindeutig aus vorhandenen Daten ermittelt werden kann.

Nicht eindeutig auflösbare Zusammenführungen werden gemäß SPEC-07 als Prüffälle bzw. Konflikte behandelt.

## 6. Priorisierung und Vertrauensbewertung von Quellen

UniCom muss bei konkurrierenden Informationen aus mehreren Quellen eine nachvollziehbare Vertrauens- und Prioritätsbewertung ermöglichen.

Dabei können unter anderem berücksichtigt werden:

* definierte Quellenprioritäten
* Aktualität
* Datenqualität
* Vollständigkeit
* Konsistenz
* historische Informationen
* Kontext
* bestätigte Benutzerentscheidungen

Eine definierte Quellenpriorität gilt.

Sprechen andere verfügbare Informationen eindeutig gegen ihre Verwendung, übergeht UniCom sie nicht stillschweigend, sondern erzeugt einen Prüffall nach SPEC-07.

Eine ausdrücklich eingestellte Priorität ist der erklärte Wille des Benutzers; sie ohne Rückfrage zu verwerfen wäre eine stille Entscheidung über den Kopf des Benutzers hinweg.

Automatische Entscheidungen müssen nachvollziehbar begründet werden können.

Quellenprioritäten und weitere Bewertungsparameter sollen konfigurierbar sein.

UniCom soll gleichzeitig sinnvolle automatische Standardbewertungen bereitstellen, um den manuellen Konfigurationsaufwand möglichst gering zu halten.

## 7. Konflikte bei unterschiedlichen Feldinhalten

UniCom muss unterschiedliche Werte desselben semantischen Zielfeldes erkennen und anhand verfügbarer Informationen bewerten können.

Dabei sollen insbesondere berücksichtigt werden:

* Quellenpriorität
* Aktualität bzw. Änderungsdatum
* Konsistenz
* Datenqualität
* Häufigkeit der Werte
* Kontext
* weitere belastbare Informationen

Kann daraus eine ausreichend sichere und nachvollziehbare Entscheidung abgeleitet werden, soll UniCom die Werte möglichst automatisch konsolidieren.

Ist keine ausreichend sichere Entscheidung möglich, darf kein Wert willkürlich bevorzugt werden.

Der Fall ist gemäß SPEC-07 als Konflikt bzw. Prüffall bereitzustellen.

Die konkrete Bearbeitung und Auflösung des Konflikts erfolgt ausschließlich nach den in SPEC-07 definierten Regeln.

## 8. Transformation und Berechnung von Zielwerten

UniCom muss Zielwerte aus einem oder mehreren Quellwerten durch definierte oder zuverlässig erkennbare Transformationen und Berechnungen erzeugen können.

Eindeutig erkennbare Transformationen sollen möglichst automatisch durchgeführt werden.

Dabei müssen insbesondere berücksichtigt werden:

* Datentypen
* Einheiten
* Formate
* fachliche Zusammenhänge

Mehrdeutige oder nicht ausreichend begründbare Transformationen dürfen nicht eigenmächtig angewendet werden.

Sie müssen als Vorschlag, definierte Regel oder Prüffall behandelt werden.

Die Entstehung automatisch erzeugter Zielwerte muss nachvollziehbar dokumentiert werden.

## 9. Zusammenführung und Aufteilung von Feldern

UniCom muss Felder bei Bedarf zusammenführen oder auf mehrere Zielfelder aufteilen können.

Eindeutig erkennbare Zusammenführungen und Aufteilungen sollen möglichst automatisch durchgeführt werden.

Bei nicht eindeutig interpretierbaren Strukturen muss UniCom die mögliche Transformation als verständlichen Vorschlag darstellen oder den Fall zur Prüfung vorlegen.

Bei Transformationen dürfen keine Quellinformationen unbeabsichtigt verloren gehen.

Vorgenommene Zusammenführungen und Aufteilungen müssen nachvollziehbar dokumentiert und im anschließenden Validierungsprozess überprüft werden.

## 10. Umgang mit nicht zuordenbaren Daten

UniCom muss nicht zuordenbare Quellfelder und Daten erkennen und darf diese nicht stillschweigend verwerfen.

Vor einer Nichtübernahme muss geprüft werden, ob eine:

* eindeutige Zuordnung
* Zusammenführung
* Transformation
* Nutzung eines vorhandenen optionalen Zielfeldes

möglich ist.

Ist keine sichere Zuordnung möglich, muss der Benutzer verständlich darüber informiert werden.

UniCom darf die definierte Zielstruktur nicht eigenmächtig durch neue Zielfelder verändern.

Eine Erweiterung der Zielstruktur kann jedoch als Vorschlag dargestellt werden.

Jede endgültige Nichtübernahme muss nachvollziehbar dokumentiert werden.

## 11. Vorschau des Mapping-Ergebnisses

UniCom muss vor der endgültigen Anwendung eines Mappings eine verständliche Vorschau des erkannten Zuordnungsergebnisses bereitstellen.

Dabei müssen insbesondere erkennbar sein:

* automatisch erkannte Zuordnungen
* vorgeschlagene Zuordnungen
* nicht zuordenbare Felder
* Zusammenführungen
* Aufteilungen
* Transformationen
* mögliche Datenverluste
* relevante Konflikte und Folgeprobleme

Eindeutig erkannte Zuordnungen sollen ohne Einzelbestätigung übernommen werden können.

Übernommen heißt: im laufenden Verarbeitungslauf angewendet. Eine dauerhafte Regel entsteht daraus erst mit der Bestätigung (SPEC-02, Abschnitt 15).

Der Benutzer soll sich auf tatsächlich unklare oder kritische Fälle konzentrieren können.

Die Vorschau muss Änderungen vor der endgültigen Anwendung ermöglichen.

## Grundprinzip von SPEC-09

Das Mapping in UniCom soll **intelligent statt regelintensiv** funktionieren.

Der Benutzer soll nicht hunderte oder tausende Feldzuordnungen manuell definieren müssen.

UniCom soll aus:

* Sprache
* Semantik
* Feldnamen
* Datentypen
* tatsächlichen Daten
* Datenstrukturen
* Kontext
* Quellenhistorie
* bestätigten Benutzerentscheidungen
* und der ausgelieferten Bezeichnungsliste

möglichst selbstständig ein belastbares Mapping erzeugen.

Eine KI-gestützte Analyse ist als Ausbaustufe vorgesehen (SPEC-11) und nicht
Bestandteil von V1. Der Anspruch dieser Spec ruht in V1 auf der ausgelieferten
Bezeichnungsliste, auf den tatsächlichen Daten und auf bestätigten früheren
Entscheidungen.

Es gilt:

> **Eindeutig → automatisch.**
> **Wahrscheinlich → Vorschlag.**
> **Mehrdeutig → Benutzerentscheidung.**

Die Verarbeitung darf dabei niemals auf Kosten der Nachvollziehbarkeit oder Datenintegrität automatisiert werden.

## Verweise auf andere Specs

* **SPEC-07** – Konfliktprüfung, Konfliktbearbeitung und Benutzerentscheidungen
* **SPEC-08** – Datenvalidierung, Datentypen, Konvertierung und Ergebnisvalidierung
* **SPEC-11** – KI-gestützte Erkennung; Ausbaustufe, nicht Bestandteil von V1

Bereits in diesen Specs definierte Prozesse werden in SPEC-09 nicht redundant neu definiert.

## Status

**SPEC-09 – FINAL, Version 1.3**

## Änderungsverzeichnis

### Version 1.3

**Abschnitt 6:** Eine eingestellte Quellenpriorität wird nicht mehr „nicht blind"
angewendet, sondern gilt; widersprechende Informationen erzeugen einen Prüffall.

Die bisherige Formulierung erlaubte, die feste Rangfolge aus SPEC-04, Abschnitt
8, unbemerkt zu umgehen.

### Version 1.2

**Abschnitt 11:** Klargestellt, dass eine ohne Einzelbestätigung übernommene
Zuordnung im Lauf angewendet wird, aber noch keine dauerhafte Regel ist.

### Version 1.1

**Abschnitt 3 und Grundprinzip:** Die KI-gestützte Analyse ist entfallen und in
SPEC-11 als Ausbaustufe beschrieben.

**Abschnitt 4:** Neu aufgenommen ist die ausgelieferte Bezeichnungsliste.

Sie ist die Folge der Streichung, nicht eine Zutat: Der Anspruch dieser Spec —
`Customer ID`, `Kundennummer` und `Kunden-Nr.` als dasselbe zu erkennen, ohne dass
der Benutzer Regeln pflegt — braucht in V1 eine Quelle für Bedeutung. Ohne diesen
Abschnitt wäre aus dem Versprechen genau die Regelarbeit geworden, die diese Spec
vermeiden will.
