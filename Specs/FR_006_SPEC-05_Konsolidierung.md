# SPEC-05 – Mapping & Referenzsystem

## 1. Zweck und Abgrenzung

UniCom stellt ein versioniertes Mapping- und Referenzsystem bereit. Mapping- und Referenzdefinitionen können unabhängig von einzelnen Verarbeitungsläufen verwaltet und von mehreren Verarbeitungsläufen bzw. Profilen wiederverwendet werden. Die Verwendung einer konkreten Version muss für jeden Verarbeitungslauf eindeutig nachvollziehbar sein.

## 2. Mapping-Definition

Eine Mapping-Definition beschreibt vollständig die Zuordnung zwischen Quell- und Zielfeldern einschließlich Datentypen, optionalen Transformationen und Normalisierungen sowie dem definierten Verhalten bei fehlenden, ungültigen oder nicht konvertierbaren Werten.

Die Mapping-Definition enthält keine konkreten Verarbeitungsdaten und kann unabhängig von einem Verarbeitungslauf wiederverwendet werden.

UniCom unterstützt dabei zwei Bedienebenen:

* **Standardmodus:** möglichst weitgehende automatische Erkennung und Übernahme vorhandener Definitionen, Regeln und Zuordnungen.
* **Expertenmodus:** vollständige explizite Konfiguration aller verfügbaren Mapping-Eigenschaften.

Automatische Vorschläge dürfen nicht stillschweigend zu verbindlichen Regeln werden. Für den Benutzer muss erkennbar sein, welche Einstellungen automatisch erkannt, aus bestehenden Profilen übernommen oder manuell festgelegt wurden.

## 3. Mapping-Wiederverwendung und Vererbung

Mapping-Definitionen müssen wiederverwendbar sein. Ein Benutzer kann bestehende Mappings übernehmen und anpassen.

Optional kann eine kontrollierte Vererbung verwendet werden. Überschreibende Einstellungen müssen eindeutig gekennzeichnet werden.

Änderungen an bereits verwendeten Definitionen erzeugen eine neue Version. Die Herkunft jeder übernommenen oder geerbten Einstellung muss nachvollziehbar bleiben.

## 4. Referenzdefinitionen

Eine Referenzdefinition beschreibt eine wiederverwendbare Referenzquelle einschließlich Zugriff, Vergleichsschlüsseln, Vergleichsregeln, optionaler Normalisierung bzw. Fuzzy-Matching-Regeln, Rückgabefeldern und dem Verhalten bei keinem, einem oder mehreren Treffern.

Referenzdefinitionen sind unabhängig von konkreten Verarbeitungsläufen, versionierbar und enthalten selbst keine konkreten Referenzdaten.

## 5. Referenzabgleich und Trefferentscheidung

Der Referenzabgleich unterscheidet eindeutig zwischen:

* eindeutigem Treffer
* keinem Treffer
* mehreren Treffern

Eindeutige Treffer können gemäß Profilregel automatisch verwendet werden.

Nicht eindeutige Ergebnisse dürfen nicht willkürlich entschieden werden und werden als Konflikt bzw. Benutzerentscheidung behandelt.

Bei Fuzzy Matching gelten explizit konfigurierte Schwellenwerte, mindestens jedoch die Schwelle aus SPEC-02, Abschnitt 5. Der Referenzabgleich selbst verändert keine Quelldaten; eine Übernahme von Referenzwerten muss ausdrücklich definiert sein.

## 6. Referenzquellen und Aktualisierung

Referenzquellen können extern bleiben und werden gemäß ihrer Referenzdefinition verwendet.

Für jeden Verarbeitungslauf muss der tatsächlich verwendete Referenzdatenstand nachvollziehbar sein. Je nach Quelle können hierfür beispielsweise Version, Änderungszeitpunkt, Timestamp, Hash oder eine vom Quellsystem bereitgestellte Kennung verwendet werden.

Caching ist zulässig, wenn es ausdrücklich konfiguriert ist.

Ein technischer Fehler beim Zugriff auf eine Referenzquelle muss eindeutig von einem fachlichen „kein Treffer“ unterschieden werden und darf nicht als solcher interpretiert werden.

## 7. Mehrfachreferenzen und Referenzketten

Ein Verarbeitungslauf darf mehrere Referenzdefinitionen verwenden.

Abhängigkeiten zwischen Referenzen müssen explizit definiert und in einer eindeutigen Reihenfolge ausgeführt werden.

Zyklische oder nicht auflösbare Referenzabhängigkeiten müssen vom System erkannt und abgelehnt werden.

Die Abhängigkeiten müssen für den Benutzer nachvollziehbar sein.

## 8. Referenz- und Mapping-Vorlagen

UniCom unterstützt wiederverwendbare Mapping- und Referenzvorlagen.

Vorlagen können systemseitig bereitgestellt oder durch Benutzer erstellt werden.

Die Verwendung einer Vorlage erzeugt eine eigenständige, versionierbare Definition; die ursprüngliche Vorlage wird dadurch nicht verändert.

UniCom kann geeignete Vorlagen automatisch vorschlagen, darf diese jedoch nicht ohne definierte bzw. bestätigte Übernahme als verbindliche Regel anwenden.

## 9. Berechtigungen und Verantwortlichkeiten

Mapping- und Referenzdefinitionen unterliegen einem kontrollierten Berechtigungs- und Freigabemodell.

Erstellen, Ändern, Freigeben, Aktivieren und Deaktivieren müssen entsprechend den Benutzerrechten steuerbar sein.

Bereits verwendete oder freigegebene Versionen sind unveränderlich.

Für historische Nachvollziehbarkeit dürfen verwendete Definitionen nicht physisch gelöscht, sondern nur außer Betrieb genommen werden.

Erstellung, Änderung und Freigabe müssen mit Benutzer und Zeitpunkt protokolliert werden.

### Geltungsbereich

Dieses Modell gilt für **Feldmappings** — die Zuordnung einer Feldbezeichnung zu einem internen Feld — und für Referenzdefinitionen.

Die Bestätigung einer vorgeschlagenen Feldzuordnung durch einen Benutzer ist die Freigabe im Sinne dieses Abschnitts. Sie erzeugt eine neue Version mit Benutzer und Zeitpunkt.

**Wertmappings** (SPEC-02, Abschnitt 15) sind ausgenommen. Sie lernen selbst und wirken ohne Freigabe; sie werden protokolliert und können in der Mapping-Verwaltung eingesehen und zurückgenommen werden.

Der Unterschied liegt in der Wirkung: Ein falsches Wertmapping trifft einen Wert, den man im Datensatz sieht. Ein falsches Feldmapping leitet eine ganze Spalte in das falsche Zielfeld.

Eine eindeutige Zuordnung darf im laufenden Verarbeitungslauf angewendet werden, ohne dass sie damit schon eine Regel wäre. Zur Regel wird sie erst mit der Bestätigung.

### Wer freigibt

Es sind zwei verschiedene Handlungen:

**Eine einzelne vorgeschlagene Feldzuordnung bestätigen** ist Arbeit an den Daten. Sie steht jedem angemeldeten Benutzer offen, der Workflows verwalten darf. Andernfalls bräuchte jede neue Spaltenbezeichnung einen Administrator, und niemand würde mehr bestätigen.

**Eine Mapping- oder Referenzversion produktiv freigeben, aktivieren oder außer Betrieb nehmen** ist ein verwaltender Eingriff. Er ist der Berechtigungsstufe Administrator vorbehalten.

Damit kommt dieses Modell mit den zwei Berechtigungsstufen aus, die UniCom kennt.

## 10. Gültigkeit und Aktivierungszeitraum

Mapping- und Referenzdefinitionen besitzen einen kontrollierten Aktivierungs- und Gültigkeitsstatus.

Für neue produktive Verarbeitungsläufe darf ausschließlich eine eindeutig gültige und aktive Version verwendet werden.

Gültigkeitszeiträume können optional definiert werden.

Bereits abgeschlossene Verarbeitungsläufe bleiben unverändert an die damals verwendete Version gebunden.

Überschneidungen, die eine eindeutige Auswahl verhindern, müssen als Konfigurationsfehler erkannt werden.

## 11. Import und Export

Mapping- und Referenzdefinitionen müssen unabhängig von konkreten Verarbeitungsdaten exportiert und importiert werden können.

Der Import prüft Format, Version, Abhängigkeiten und externe Referenzen.

Bestehende Definitionen dürfen nicht stillschweigend überschrieben werden.

Nicht verfügbare externe Abhängigkeiten müssen beim Import eindeutig angezeigt werden.

## 12. Prüfung und Validierung

Mapping- und Referenzdefinitionen müssen vor Freigabe bzw. Aktivierung auf technische und logische Konsistenz geprüft werden.

Geprüft werden unter anderem:

* Vollständigkeit
* Existenz von Quell- und Zielfeldern
* Datentyp-Kompatibilität
* vorhandene Abhängigkeiten
* zyklische Abhängigkeiten
* widersprüchliche Einstellungen
* erforderliche externe Referenzen
* Berechtigungen
* Eindeutigkeit der gültigen Definition

Fehlerhafte, unvollständige oder widersprüchliche Definitionen dürfen nicht produktiv aktiviert werden.

Erkannte fachliche Mehrdeutigkeiten dürfen nicht automatisch korrigiert werden, sondern müssen dem Benutzer eindeutig angezeigt und von diesem aufgelöst werden.

## 13. Nachvollziehbarkeit und Audit

Die Anwendung von Mapping- und Referenzdefinitionen muss revisionssicher nachvollziehbar sein.

Jeder Verarbeitungslauf muss eindeutig auf die verwendeten Versionen und relevanten automatischen bzw. manuellen Entscheidungen verweisen können.

Nachvollziehbar müssen insbesondere sein:

* verwendete Mapping-Version
* verwendete Referenz-Version
* angewendete Regeln
* relevante automatische Entscheidungen
* relevante Benutzerentscheidungen
* Übernahmen aus Referenzquellen
* aufgetretene Konflikte
* Zeitpunkt der Anwendung

Eine vollständige doppelte Speicherung sämtlicher verarbeiteter Datensätze ist hierfür nicht erforderlich.

Nachträgliche Änderungen oder Deaktivierungen von Definitionen dürfen die historische Nachvollziehbarkeit abgeschlossener Verarbeitungsläufe nicht verändern.

---

## Status

**SPEC-05 – FINAL, Version 1.2**

Die SPEC ist damit abgeschlossen und wird nicht erneut verändert, sofern keine ausdrückliche Änderung beauftragt wird.

## Änderungsverzeichnis

### Version 1.2

**Abschnitt 5:** Der Schwellenwert beim Fuzzy Matching darf die Untergrenze aus
SPEC-02, Abschnitt 5, nicht unterschreiten.

**Abschnitt 9:** Ergänzt, wer freigibt.

Diese Spec verlangte getrennt steuerbare Rechte für Ändern und Freigeben.
UniCom kennt zwei Berechtigungsstufen; die Trennung liegt deshalb nicht in einem
dritten Recht, sondern in zwei verschiedenen Handlungen.

### Version 1.1

**Abschnitt 9:** Geltungsbereich ergänzt.

Das Versions- und Freigabemodell dieser Spec und das selbsttätige Lernen aus
SPEC-02, Abschnitt 17, schlossen einander aus: Entweder erzeugte jede
Lernbewegung eine freizugebende Version — dann lernte das System nicht mehr —,
oder es schrieb am aktiven Bestand weiter und die Versionskette war gebrochen.

Die Trennung nach Wirkung löst das auf: Wertmappings lernen frei, Feldmappings
werden durch Bestätigung freigegeben, und diese Bestätigung erzeugt die Version.
