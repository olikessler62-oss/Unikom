# SPEC-07 – Konfliktprüfung und Benutzerbearbeitung

## 1. Zweck und Grundprinzip

UniCom stellt für nicht eindeutig automatisiert lösbare Konflikte und prüfpflichtige Fälle eine gezielte Benutzerprüfung bereit.

Nur Fälle, für die aufgrund definierter Regeln keine eindeutige automatische Entscheidung möglich ist oder bei denen eine manuelle Prüfung ausdrücklich vorgeschrieben wurde, werden dem Benutzer zur Entscheidung vorgelegt.

Eindeutig automatisch lösbare Fälle werden ohne unnötige Benutzerinteraktion verarbeitet.

## 2. Erkennung und Klassifizierung prüfpflichtiger Fälle

UniCom muss prüfpflichtige Fälle erkennen und anhand ihrer Bedeutung klassifizieren können.

Mindestens sind folgende Kategorien unterscheidbar:

* Information
* Warnung
* Konflikt
* fachlicher Prüffall
* kritischer Fall

Für jeden zur Benutzerprüfung vorgelegten Fall muss nachvollziehbar angegeben werden, warum eine manuelle Prüfung erforderlich ist und welche Regel bzw. Bedingung den Prüffall ausgelöst hat.

## 3. Priorisierung von Prüffällen

UniCom muss prüfpflichtige Fälle priorisieren und nach konfigurierbaren Kriterien sortieren können.

Dabei sollen insbesondere berücksichtigt werden können:

* Kritikalität
* Konflikttyp
* Datenquelle
* betroffene Daten
* Auswirkung auf das Ergebnis
* Bearbeitungsstatus
* Zeitpunkt der Entstehung bzw. Bearbeitung

UniCom kann sinnvolle Standardprioritäten bereitstellen, muss dem Benutzer jedoch die Möglichkeit geben, Reihenfolge und Filterkriterien selbst festzulegen.

Eine fachliche Priorität darf nicht ohne entsprechende Grundlage automatisch angenommen werden.

## 4. Darstellung eines Prüffalls

Jeder Prüffall muss dem Benutzer übersichtlich und verständlich dargestellt werden.

Die Darstellung muss mindestens enthalten:

* Ursache und Art des Prüffalls
* betroffene Daten
* zugehörige Quellen
* vorhandene Werte
* relevante Metadaten
* Grund für die erforderliche Benutzerentscheidung
* verfügbare Entscheidungsoptionen

Bei konkurrierenden Werten müssen diese vergleichbar gegenübergestellt werden.

Das voraussichtliche Ergebnis einer Entscheidung soll, soweit möglich, vor der Bestätigung angezeigt werden.

Das Offenlassen eines Prüffalls stellt keine fachliche Entscheidung dar. Der Fall bleibt mit dem Status „offen“ bzw. „Entscheidung erforderlich“ erhalten.

Abhängig von Kritikalität und Konfiguration wird der betroffene Datensatz entweder zurückgestellt oder darf als ungeklärter Fall weiterverarbeitet werden. Eine automatische fachliche Entscheidung darf daraus nicht abgeleitet werden.

## 5. Lebenszyklus, Aufbewahrung und Bereinigung

UniCom unterscheidet zwischen dauerhaft aufzubewahrenden Ergebnissen und temporären Verarbeitungselementen.

Arbeitsdateien, Konfliktdateien, Konfliktzieldateien und sonstige Zwischen-Dateien werden nach erfolgreichem Abschluss des Verarbeitungslaufs gemäß einer konfigurierbaren Aufbewahrungsfrist automatisch bereinigt.

Die Bereinigung trifft ausschließlich Dateien. Konfliktfall, UUID, Entscheidungen und Bearbeitungshistorie liegen in der Datenbank und bleiben davon unberührt (siehe Dateimodell).

Für nicht erfolgreich abgeschlossene oder noch in Bearbeitung befindliche Läufe dürfen für Fortsetzung, Konfliktbearbeitung, Fehleranalyse oder Wiederherstellung erforderliche Dateien nicht vorzeitig gelöscht werden.

Die Zieldatei und das kompakte Verarbeitungsprotokoll bleiben entsprechend den definierten Aufbewahrungs- und Archivierungsregeln erhalten.

Die Originaldatei wird von der Konsolidierung nicht angefasst — weder verändert noch gelöscht (SPEC-02, Abschnitt 21).

Was nach der Verarbeitung mit ihr geschieht, entscheidet Modul 1 an seiner Quelle. Die Konsolidierung räumt dort nicht auf.

## 6. Bearbeitung eines Konflikts

UniCom muss für jeden Konflikttyp die jeweils zulässigen Bearbeitungs- und Entscheidungsoptionen bereitstellen.

Dazu können insbesondere gehören:

* Übernahme eines vorhandenen Wertes
* Auswahl eines anderen vorhandenen Wertes
* manuelle Eingabe oder Korrektur eines Wertes
* Zusammenführung von Datensätzen
* Nichtzusammenführung von Datensätzen
* Offenlassen eines Konflikts
* bewusste Akzeptierung eines Konflikts, sofern fachlich zulässig

Vor der Bestätigung muss das erwartete Ergebnis der Entscheidung nachvollziehbar dargestellt werden.

Ein offener Konflikt bleibt unverändert als offener Fall bestehen und kann zu einem späteren Zeitpunkt erneut bearbeitet werden.

## 7. Feldweise Bearbeitung und Zusammenführung

Bei der Zusammenführung konkurrierender Datensätze muss UniCom eine feldweise Entscheidungs- und Bearbeitungsmöglichkeit bereitstellen.

Der Benutzer kann für jedes betroffene Feld:

* einen vorhandenen Wert auswählen
* einen Wert manuell eingeben
* einen Wert bearbeiten, sofern dies zulässig ist

Die jeweils geltenden Mapping-, Datentyp-, Validierungs- und sonstigen Fachregeln bleiben auch bei manueller Bearbeitung wirksam.

Die für den resultierenden Datensatz getroffenen Feldentscheidungen müssen nachvollziehbar dokumentiert werden.

## 8. Mehrere Konflikte gemeinsam bearbeiten

UniCom muss die gemeinsame Bearbeitung mehrerer gleichartiger Konflikte ermöglichen.

Der Benutzer kann eine Entscheidung oder Regel gezielt auf eine ausgewählte Gruppe von Konfliktfällen anwenden.

Vor der Ausführung müssen Umfang, betroffene Fälle und erwartete Auswirkungen nachvollziehbar dargestellt und vom Benutzer bestätigt werden.

Jede durch eine Massenentscheidung vorgenommene Änderung muss den betroffenen Konfliktfällen eindeutig zugeordnet und protokolliert werden.

## 9. Suchen, Filtern und Gruppieren

UniCom muss innerhalb der Konfliktbearbeitung leistungsfähige Such-, Filter- und Gruppierungsfunktionen bereitstellen.

Konflikte müssen insbesondere anhand folgender Kriterien gefunden und eingegrenzt werden können:

* Konflikt-UUID
* Datensatzidentifikation
* Quelle
* Konfliktart
* Status
* betroffene Felder
* Kritikalität
* relevante Zeitinformationen
* Bearbeitungsinformationen

Die Konflikte müssen zusätzlich gruppiert und sortiert werden können.

Die Funktionen dienen ausschließlich der Navigation und Auswahl und dürfen den Datenbestand nicht verändern.

## 10. Konflikte zurückstellen und später fortsetzen

UniCom muss ermöglichen, Konflikte bewusst zurückzustellen und zu einem späteren Zeitpunkt weiterzubearbeiten.

Ein zurückgestellter Konflikt gilt nicht als bereinigt oder gelöst.

Der Konflikt bleibt mit seiner eindeutigen UUID und seiner vollständigen Bearbeitungshistorie erhalten.

UniCom muss den individuellen Bearbeitungsfortschritt des Benutzers speichern.

Beim erneuten Öffnen der Konfliktbearbeitung wird der Benutzer standardmäßig an die zuletzt bearbeitete Stelle zurückgeführt.

Dabei sollen insbesondere erhalten bleiben:

* zuletzt bearbeiteter Konflikt
* aktuelle Position innerhalb der Ansicht
* aktive Filter
* aktive Sortierung
* relevante Bearbeitungseinstellungen

Die Wiederaufnahme muss auch am nächsten Tag oder nach einem Neustart genau an diesem Bearbeitungsstand möglich sein, sofern die zugrunde liegenden Daten und Filter noch gültig sind.

Der Benutzer kann den Wiedereinstiegspunkt jederzeit verlassen und die Konfliktliste an einer anderen Stelle öffnen.

Das Zurückstellen eines Konflikts darf die zugrunde liegenden Original- oder Arbeitsdaten nicht verändern.

## 11. Zuständigkeit und gleichzeitige Bearbeitung

UniCom muss bei gemeinsamer Nutzung verhindern, dass derselbe Konflikt unbeabsichtigt gleichzeitig von mehreren Benutzern verändert wird.

Während der Bearbeitung muss der Konflikt eindeutig als in Bearbeitung gekennzeichnet und der zuständige Benutzer angezeigt werden.

Bearbeitungssperren müssen bei Abbruch, Programmfehler oder längerer Inaktivität kontrolliert aufgehoben werden können.

Bereits vorhandene Bearbeitungen dürfen dabei nicht unbemerkt überschrieben werden.

## 12. Nachvollziehbarkeit der Benutzerentscheidungen

UniCom muss alle relevanten Benutzerentscheidungen bei der Konfliktbearbeitung nachvollziehbar und unveränderbar dokumentieren.

Die Dokumentation muss mindestens umfassen:

* Konflikt-UUID
* ursprünglichen Konflikt
* ursprüngliche relevante Werte
* getroffene Entscheidung bzw. Änderung
* gegebenenfalls neuen Wert
* Zeitpunkt
* Benutzer
* gegebenenfalls verwendete Regel
* daraus resultierendes Verarbeitungsergebnis

Nachträgliche Korrekturen dürfen frühere Entscheidungen nicht löschen oder überschreiben.

Sie müssen als neue Bearbeitungsschritte dokumentiert werden.

Die Konflikt-UUID bleibt über den gesamten Lebenszyklus des jeweiligen Konfliktfalls erhalten.

Die Originaldatei bleibt unverändert.

Die Arbeitsdatei enthält keine Konflikt-UUID und keine Konflikt-Metadaten.

Die Konflikt-UUID wird beim Entstehen des Konfliktfalls in der Datenbank vergeben. Ausgeleitete Konflikt- und Konfliktzieldateien führen sie unverändert mit, damit ein Fall auch außerhalb von UniCom wiedererkennbar bleibt.

## 13. Abschluss und Freigabe der Konfliktbearbeitung

UniCom muss den Gesamtstatus der Konfliktbearbeitung eindeutig darstellen und dem Benutzer eine explizite Freigabe zur erneuten Verarbeitung ermöglichen.

Vor der Freigabe muss geprüft werden:

* wie viele Konflikte insgesamt vorhanden sind
* wie viele bereinigt wurden
* wie viele offen sind
* wie viele zurückgestellt wurden
* wie viele kritische Fälle noch bestehen
* ob eine erneute Verarbeitung möglich ist
* welche offenen oder kritischen Fälle eine erneute Verarbeitung verhindern

Bereinigte Konfliktfälle werden für die erneute Verarbeitung in einer Konfliktzieldatei bereitgestellt.

Der ursprüngliche Konfliktfall und seine Bearbeitungshistorie bleiben in der Datenbank als nachvollziehbarer Bestand erhalten und werden durch die Benutzerbearbeitung nicht überschrieben.

Ein erneuter Verarbeitungslauf erzeugt einen neuen Verarbeitungslauf mit eigener Verarbeitungs-ID, der auf den ursprünglichen verweist (SPEC-01, Abschnitt 9).

Ein bearbeiteter Konflikt gilt erst dann als erfolgreich verarbeitet, wenn die anschließende Verarbeitung erfolgreich abgeschlossen wurde.

Ein Konflikt kann daher die Statusentwicklung beispielsweise

`OFFEN → ZURÜCKGESTELLT → BEREINIGT → ERNEUT VERARBEITET → ERFOLGREICH VERARBEITET`

durchlaufen.

Entsteht bei der erneuten Verarbeitung ein neuer Konflikt, muss dieser als neuer Konfliktfall nachvollziehbar mit dem vorausgegangenen Bearbeitungsvorgang verknüpft werden.

---

## Bestand und Dateimodell

Die Konfliktbearbeitung führt ihren Bestand in der Datenbank.

Konflikt-UUID, Status, Entscheidungen, Bearbeitungshistorie und der
Bearbeitungsfortschritt des Benutzers liegen in SQLite (SPEC-01, Abschnitt 11.2).
Suchen, Filtern, Gruppieren, Sperren und Wiederaufnahme nach Abschnitt 9 bis 11
arbeiten ausschließlich darauf.

Dateien entstehen daraus. Sie führen den Bestand nicht:

1. **Originaldatei**
   Unverändert und nicht mit Konflikt-Metadaten angereichert.

2. **Arbeitsdatei**
   Temporärer Arbeits- und Konsolidierungsstand ohne Konflikt-UUID.

3. **Konfliktdatei**
   Ausleitung der Konflikte eines Verarbeitungslaufs zur Ansicht und Weitergabe.
   Sie trägt die in der Datenbank vergebenen UUIDs.

4. **Konfliktzieldatei**
   Ausleitung der bereinigten Fälle für die erneute Verarbeitung. Sie übernimmt
   deren bestehende Konflikt-UUIDs unverändert.

Wird eine Ausleitung nach Ablauf der Aufbewahrungsfrist gelöscht, bleiben
Konfliktfall, Entscheidungen und Historie in der Datenbank erhalten. Die
Nachvollziehbarkeit nach Abschnitt 12 hängt damit nicht an einer Datei, die
irgendwann fortgeräumt wird.

## Status

**SPEC-07 – FINAL, Version 1.2**

Die Spec ist abgeschlossen und wird nicht erneut verändert, sofern keine ausdrückliche Änderung beauftragt wird.

## Änderungsverzeichnis

### Version 1.2

**Abschnitt 5:** Die Originaldatei wird von der Konsolidierung nicht angefasst.

Der bisherige Satz „kann abhängig von der Konfiguration ebenfalls aufbewahrt
werden" räumte der Konfiguration ein, sie nicht aufzubewahren — während SPEC-02,
Abschnitt 21, das Löschen als unveränderliche Grundregel ausschließt.

**Abschnitt 13:** „Verarbeitungsschritt" heißt wieder Verarbeitungslauf mit
eigener Kennung, wie in SPEC-01, SPEC-02 und SPEC-03.

### Version 1.1

**Dateimodell:** Als führender Bestand ist die Datenbank benannt; die vier
Dateien sind Ausleitungen daraus.

Konflikte standen bisher zugleich in SQLite (SPEC-01 Abschnitt 11.2, SPEC-02
Abschnitt 47, SPEC-03 Abschnitt 17) und in Dateien, ohne Angabe, welcher Bestand
im Zweifel gilt. Abschnitt 9 bis 11 dieser Spec verlangen Suchen, Filtern,
Sperren und einen Bearbeitungsstand über Neustarts hinweg — das trägt nur die
Datenbank.

**Abschnitt 5 und 13:** Damit ist auch der Widerspruch innerhalb dieser Spec
aufgelöst. Abschnitt 5 räumt Konfliktdateien nach Frist fort, Abschnitt 13
verlangte ihren dauerhaften Erhalt. Fortgeräumt wird jetzt nur die Ausleitung;
der Fall und seine Historie bleiben.

**Abschnitt 12:** Die Konflikt-UUID entsteht in der Datenbank und reist mit den
Ausleitungen mit, statt in der Konfliktdatei geführt zu werden.
