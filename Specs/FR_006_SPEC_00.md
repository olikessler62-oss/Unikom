# SPEC-UX – Verbindliche Regel für Benutzerführung, Oberflächengestaltung und Mandantenkonfiguration

## 1. Zweck

UniCom muss so gestaltet sein, dass Benutzer die Anwendung ohne unnötige Komplexität bedienen und konfigurieren können.

Die technische Leistungsfähigkeit von UniCom darf nicht dazu führen, dass Benutzer mit einer überladenen Oberfläche, zu vielen Optionen oder umfangreichen manuellen Konfigurationen konfrontiert werden.

**Die Komplexität liegt im System – nicht auf dem Schreibtisch des Benutzers.**

Diese Spec gilt übergreifend für alle Funktionen, Module und zukünftigen Specs von UniCom.

## 2. Übersichtlichkeit als oberstes Gestaltungsprinzip

Die Übersichtlichkeit der Benutzeroberfläche hat höchste Priorität.

Die Oberfläche muss:

* klar strukturiert
* logisch aufgebaut
* ruhig
* einheitlich
* verständlich
* auf die aktuelle Aufgabe konzentriert

sein.

Funktionen, die für den aktuellen Arbeitsschritt nicht benötigt werden, sollen nicht dauerhaft sichtbar sein.

Eine große Anzahl von Funktionen darf nicht durch eine große Anzahl gleichzeitig sichtbarer Buttons, Auswahlfelder oder Optionen dargestellt werden.

## 3. Einfache Bedienung mit optionaler fachlicher Tiefe

UniCom muss zwei Nutzungsebenen ermöglichen.

### Standardbedienung

Der Benutzer erhält nur die Informationen und Optionen, die für die aktuelle Aufgabe erforderlich sind.

Automatische Erkennung und intelligente Standardentscheidungen sollen den manuellen Aufwand möglichst gering halten.

### Erweiterte Bedienung

Benutzer, die tiefer in die Verarbeitung eingreifen möchten oder müssen, erhalten Zugriff auf weiterführende Definitions- und Konfigurationsmöglichkeiten.

Diese Funktionen müssen klar getrennt und übersichtlich strukturiert sein.

Der Benutzer darf nicht gezwungen werden, Experteneinstellungen zu verstehen oder zu konfigurieren, wenn diese für seine aktuelle Aufgabe nicht erforderlich sind.

## 4. Klare Trennung der Hauptbereiche

Die Anwendung muss die fachlichen Bereiche klar voneinander trennen.

Es gilt insbesondere:

### Mandant

Unter **Mandant** werden die mandantenbezogenen fachlichen und technischen Definitionen verwaltet.

Hierzu gehören insbesondere die grundsätzlichen Konsolidierungseinstellungen und Definitionen des jeweiligen Mandanten, beispielsweise:

* Mapping
* Zielstrukturen
* Konvertierungsdefinitionen
* Quellenprioritäten
* Validierungsvorgaben
* mandantenspezifische Regeln
* weitere dauerhaft geltende Konsolidierungseinstellungen

### Daten

Unter **Daten** werden die konkreten zu verarbeitenden Datenbestände und Quellen verwaltet.

Dazu gehören insbesondere:

* Quelldateien
* importierte Daten
* Datenbestände
* Datenquellen
* konkrete Datenobjekte

### Workflow

Unter **Workflow** wird der konkrete Verarbeitungsvorgang gesteuert und überwacht.

Dazu gehören insbesondere:

* Verarbeitung starten
* Verarbeitung pausieren oder fortsetzen
* Fortschritt
* Status
* aktuelle Verarbeitungsschritte
* offene Bearbeitungsvorgänge
* Wiederaufnahme eines unterbrochenen Vorgangs

**Mandantenweite Konsolidierungseinstellungen gehören grundsätzlich unter „Mandant“ und dürfen nicht zusätzlich redundant unter „Daten“ oder „Workflow“ gepflegt werden.**

Eine Einstellung soll grundsätzlich dort gepflegt werden, wo ihr fachlicher Geltungsbereich liegt.

## 5. Wiederverwendung von Mandantenkonfigurationen

UniCom muss ermöglichen, bestehende Konfigurationen eines anderen Mandanten als Grundlage für einen neuen oder bestehenden Mandanten zu verwenden.

Der Benutzer soll nicht sämtliche Konsolidierungseinstellungen für jeden Mandanten erneut erfassen müssen.

Dabei muss mindestens möglich sein:

* eine bestehende Mandantenkonfiguration auszuwählen
* die gewünschte Konfiguration zu kopieren
* die kopierte Konfiguration vor der Übernahme zu prüfen
* die übernommenen Einstellungen bei Bedarf anzupassen
* die neue Konfiguration unabhängig vom ursprünglichen Mandanten weiterzuentwickeln

Die Kopie muss anschließend **eigenständig** sein.

Änderungen am ursprünglichen Mandanten dürfen die bereits kopierte Konfiguration nicht unkontrolliert verändern.

## 6. Selektives Kopieren von Konfigurationen

Das Kopieren muss soweit sinnvoll nicht nur als vollständige Kopie möglich sein.

UniCom soll ermöglichen, einzelne Konfigurationsbereiche oder geeignete Gruppen zu übernehmen.

Beispielsweise könnte ein Benutzer:

* nur das Mapping
* nur die Zielstruktur
* nur bestimmte Konvertierungsdefinitionen
* nur Quellenprioritäten
* oder eine vollständige Mandantenkonfiguration

übernehmen.

Vor der Übernahme muss klar erkennbar sein, **was kopiert wird und was nicht**.

## 7. Schutz vor unbeabsichtigter Übernahme

Beim Kopieren einer Konfiguration muss UniCom mögliche Abhängigkeiten erkennen und den Benutzer verständlich darauf hinweisen.

Beispielsweise darf ein Mapping nicht unbemerkt übernommen werden, wenn die dafür erforderliche Zielstruktur im neuen Mandanten nicht vorhanden ist.

UniCom soll solche Abhängigkeiten möglichst automatisch erkennen und dem Benutzer eine verständliche Lösung oder Anpassung anbieten.

## 8. Klare Trennung der Definitionsmodule

Definitions- und Konfigurationsbereiche müssen logisch voneinander getrennt werden.

Insbesondere dürfen beispielsweise:

* Mapping
* Konvertierungsregeln
* Validierungsregeln
* Konfliktbearbeitung
* Quellenprioritäten
* Verarbeitungseinstellungen
* Exporteinstellungen

nicht ungeordnet in einer gemeinsamen Oberfläche vermischt werden.

Jedes Definitionsmodul muss einen klar erkennbaren Zweck besitzen.

## 9. Eingabe- und Auswahlfelder

Eingabe- und Auswahlfelder müssen grundsätzlich einheitlich gestaltet werden.

Es gilt:

* Eingabefelder haben grundsätzlich die gleiche Breite.
* Auswahlfelder haben grundsätzlich die gleiche Breite.
* Eingabe- und Auswahlfelder sollen innerhalb eines Formularbereichs einheitlich ausgerichtet sein.
* Abweichende Größen sind nur zulässig, wenn dies aufgrund der Funktion des jeweiligen Feldes erforderlich ist.

## 10. Infobutton

Eingabe- und Auswahlfelder erhalten grundsätzlich rechts einen Infobutton.

Der Infobutton öffnet die zugehörige Hilfe bzw. Erklärung für genau dieses Feld.

Die Erklärung muss sich unmittelbar auf das jeweilige Eingabe- oder Auswahlfeld beziehen.

## 11. Erklärungstexte

Erklärungstexte sollen die Oberfläche nicht unnötig verlängern oder unübersichtlich machen.

Zusätzliche Erklärungstexte unterhalb von Eingabe- oder Auswahlfeldern sind grundsätzlich nicht zulässig, wenn sie lediglich die Funktion oder Bedeutung des jeweiligen Feldes erklären.

Solche Informationen gehören ausschließlich in den zugehörigen Hilfe- bzw. Infotext.

Ausnahmen sind nur zulässig, wenn der Text selbst Bestandteil des Arbeitsergebnisses oder für die unmittelbare Durchführung des aktuellen Arbeitsschrittes zwingend erforderlich ist.

## 12. Sprache

Alle Texte der Benutzeroberfläche müssen:

* klar
* direkt
* kurz
* sachlich
* verständlich

formuliert sein.

Es sind keine unnötigen Floskeln, Marketingformulierungen oder künstlich wirkenden Formulierungen zu verwenden.

Die Sprache soll so gestaltet sein, dass der Benutzer schnell versteht:

* was passiert
* was das Problem ist
* was von ihm erwartet wird
* welche Konsequenz eine Entscheidung hat

## 13. Fehlermeldungen und Hinweise

Fehler, Warnungen und Hinweise müssen in verständlicher Sprache formuliert sein.

Technische Fehlercodes dürfen zusätzlich angezeigt werden, dürfen aber die verständliche Erklärung nicht ersetzen.

Die Meldung muss insbesondere erkennen lassen:

* was passiert ist
* warum es passiert ist
* ob eine Handlung erforderlich ist
* welche Handlung möglich ist
* welche Konsequenz die Handlung hat

## 14. Automatische Entscheidungen

UniCom soll möglichst viele Entscheidungen automatisch treffen, wenn diese zuverlässig möglich sind.

Die Benutzeroberfläche darf den Benutzer nicht mit den zugrunde liegenden technischen Entscheidungsprozessen belasten.

Wenn eine automatische Entscheidung relevant oder möglicherweise fehleranfällig ist, muss UniCom sie verständlich erklären können.

Der Benutzer soll bei Bedarf in die zugrunde liegenden Details einsteigen können.

## 15. Progressive Offenlegung

Komplexe Funktionen sollen erst dann sichtbar werden, wenn sie benötigt werden.

Die Standardansicht muss möglichst einfach bleiben.

Weiterführende Einstellungen können über klar erkennbare Bereiche oder Definitionsmodule erreichbar sein.

Der Benutzer darf nicht mit Expertenoptionen konfrontiert werden, bevor deren Verwendung erforderlich ist.

## 16. Konsistenz

Die gleichen Bedienkonzepte müssen in der gesamten Anwendung möglichst gleich funktionieren.

Dies betrifft insbesondere:

* Buttons
* Eingabefelder
* Auswahlfelder
* Infobuttons
* Dialoge
* Meldungen
* Navigation
* Bestätigungen
* Abbrechen-Funktionen
* Statusanzeigen

Ein Benutzer soll ein einmal erlerntes Bedienkonzept an anderer Stelle wiedererkennen.

## 17. Vermeidung unnötiger Benutzerentscheidungen

UniCom darf den Benutzer nicht für Entscheidungen heranziehen, die das System zuverlässig selbst treffen kann.

Dies gilt insbesondere für:

* Datentypen
* Feldzuordnungen
* Konvertierungen
* fehlende Werte
* Dubletten
* Datenqualität
* Priorisierung
* erkennbare Standardfälle

Der Benutzer wird nur dann einbezogen, wenn eine automatische Entscheidung nicht ausreichend sicher ist oder eine fachliche Entscheidung erforderlich ist.

## 18. Benutzerkontrolle bei komplexen Entscheidungen

Wenn eine Entscheidung nicht zuverlässig automatisch getroffen werden kann, muss UniCom dem Benutzer eine klare und überschaubare Entscheidungsmöglichkeit geben.

Dabei sollen nur die relevanten Informationen angezeigt werden.

Der Benutzer soll nicht durch technische Details oder eine große Anzahl irrelevanter Optionen überfordert werden.

## 19. Grundregel für neue Funktionen

Neue Funktionen dürfen die Benutzeroberfläche nicht unnötig verkomplizieren.

Wenn eine neue Funktion zusätzliche Konfigurationsmöglichkeiten erfordert, muss geprüft werden, ob UniCom diese Einstellungen:

* automatisch ermitteln
* sinnvoll vorbelegen
* aus einem bestehenden Mandanten übernehmen
* oder in ein separates Definitionsmodul auslagern

kann.

## 20. Übergreifende Grundregel

Für alle zukünftigen Specs und Funktionen gilt:

> **So einfach wie möglich für den Benutzer, so leistungsfähig wie notwendig im Hintergrund.**

Die Benutzeroberfläche muss die Komplexität von UniCom nicht vollständig abbilden.

Sie muss dem Benutzer nur die Komplexität zugänglich machen, die er für seine konkrete Aufgabe benötigt.

## 21. Verbindlichkeit

Diese Spec ist eine **übergreifende verbindliche UI-/UX-Regel**.

Sie gilt für:

* alle bestehenden Specs
* alle zukünftigen Specs
* alle Benutzeroberflächen
* alle Dialoge
* alle Definitionsmodule
* alle Konfigurationsbereiche
* alle Fehlermeldungen und Hinweise
* alle mandantenbezogenen Einstellungen

Bei Konflikten zwischen einer späteren Detailentscheidung und diesen Grundsätzen ist die Benutzerführung entsprechend dieser Spec zu überprüfen und gegebenenfalls anzupassen.

## Status

**SPEC-UX – FINAL / ÜBERGREIFENDE REGEL**
