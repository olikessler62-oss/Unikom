SPEC-02 — Datenkonsolidierung

Status: FINAL
Modul: UniCom – Datenkonsolidierung
Abhängigkeit: SPEC-01 – Gemeinsame Verarbeitungs- und Systemgrundlagen
Version: 1.4

1. Zweck

Das Modul Datenkonsolidierung verarbeitet eingehende Datenbestände, erkennt unterschiedliche Datenstrukturen und Formate, ordnet Daten Feldern und Referenzdaten zu, normalisiert eindeutig interpretierbare Abweichungen und führt zusammengehörige Datenbestände zu einem konsistenten Ergebnis zusammen.

Das Modul muss dabei zwischen:

eindeutig verarbeitbaren Daten,
automatisch korrigierbaren Abweichungen,
unsicheren bzw. mehrdeutigen Daten und
echten Konflikten

unterscheiden.

Grundprinzip:

UniCom soll so viel wie möglich automatisch verarbeiten, aber niemals unsichere Interpretationen als sichere Tatsachen behandeln.

2. Unterstützte Eingangsformate

Das Modul muss mindestens folgende Formate unterstützen:

CSV
XLSX
TXT
2.1 CSV

CSV-Dateien müssen unterschiedliche Trennzeichen unterstützen.

Standard:

;

Weitere Trennzeichen müssen konfigurierbar sein, beispielsweise:

,
TAB
|

Das verwendete Trennzeichen muss über das Profil bzw. die Konfiguration definiert oder eindeutig erkannt werden können.

UTF-8 muss unterstützt werden.

Weitere Encodings, insbesondere Windows-1252, müssen technisch unterstützt werden können, sofern sie für konkrete Kunden-/Altbestände benötigt werden.

2.2 Excel

XLSX muss unterstützt werden.

XLS, das alte Binärformat, ist nicht Bestandteil von V1.

Es ist kein Zip mit XML, sondern ein Strom aus Datensätzen mit eigenen
Zeichensatzregeln. Ein eigener Leser dafür steht in keinem Verhältnis, und eine
fremde Bibliothek dafür wäre Fremdcode, den der Kunde in seinem Haus mit
betreibt. Wer heute noch XLS liefert, kann in Excel „Speichern unter" wählen.

Mehrere Tabellenblätter innerhalb einer Excel-Datei müssen verarbeitet werden können.

Einzelne Tabellenblätter können:

eigenständige Datenbestände darstellen,
zusammengehören,
anhand eines gemeinsamen Schlüssels zusammengeführt werden.

Die Zuordnung erfolgt über definierte Profile und Schlüssel.

2.3 TXT

TXT-Dateien müssen sowohl

mit Header
als auch ohne Header

verarbeitet werden können.

Die Header-Behandlung muss konfigurierbar sein.

Der Header darf nicht automatisch als alleinige Grundlage für die Bestimmung von Datentypen verwendet werden.

3. Eingangsprofile

Für unterschiedliche Datenquellen werden Profile verwendet.

Ein Profil kann unter anderem definieren:

erwartete Felder
Feldnamen
Datentypen
Formatierungen
Trennzeichen
Encoding
Header-Verhalten
Datums-/Zeitformate
Zahlenformate
Zuordnungsschlüssel
Pflichtfelder
Mapping-Regeln
Toleranzen
Normalisierungsregeln

Profile werden versioniert.

Ein Verarbeitungslauf verwendet immer eine eindeutig identifizierbare Profilversion.

Eine spätere Änderung eines Profils darf historische Verarbeitungsläufe nicht nachträglich verändern.

4. Stichprobenbasierte Strukturerkennung

UniCom darf bei unbekannten oder nicht eindeutig definierten Eingangsdaten zunächst eine Stichprobe untersuchen.

Die Stichprobe umfasst im Regelfall:

100 Datensätze, sofern mindestens 100 Datensätze vorhanden sind.

Die Prüfung darf vorzeitig beendet werden, sobald eine ausreichende Konfidenz erreicht wurde.

Beispiel:

10 geprüfte Datensätze
9 eindeutig
1 abweichend

Kann bereits eine ausreichend hohe Wahrscheinlichkeit bestehen, dass der eine Datensatz ein Ausreißer ist, darf die Prüfung beendet werden.

Umgekehrt muss UniCom die Stichprobe erweitern, wenn die bisherige Datenbasis keine ausreichend sichere Aussage erlaubt.

Die Erweiterung endet bei:

1.000 Datensätzen

Reicht auch das nicht, entsteht kein Ergebnis auf gut Glück. Die betreffende Erkennung gilt als nicht ausreichend sicher und wird nach Abschnitt 5 behandelt.

5. Konfidenz und automatische Entscheidungen

Die zentrale Schwelle beträgt:

97 % Konfidenz

Diese Schwelle ist eine Untergrenze.

Sie kann für einzelne Entscheidungen, Profile oder Mandanten heraufgesetzt, aber niemals unterschritten werden. Wo andere Specs von einer konfigurierten Confidence-Schwelle sprechen (SPEC-04 Abschnitt 9, SPEC-05 Abschnitt 5), ist eine Schwelle innerhalb dieser Grenze gemeint.

Eine automatische Interpretation bzw. Korrektur darf vorgenommen werden, wenn die Entscheidung mit mindestens der erforderlichen Konfidenz als ausreichend sicher gilt.

Alles darunter wird grundsätzlich dem Benutzer zur Entscheidung vorgelegt bzw. als Konflikt behandelt.

Die genaue technische Berechnung der Confidence wird in den technischen Implementierungsspezifikationen definiert.

6. Datum, Zeit und Timestamp

Datum und Zeit werden als eigenständiger komplexer Bereich behandelt.

UniCom muss mindestens unterstützen:

Datum
DD.MM.YYYY
MM/DD/YYYY
YYYY-MM-DD
unterschiedliche Trennzeichen
vierstellige Jahreszahlen
zweistellige Jahreszahlen
Uhrzeit
24-Stunden-Format
12-Stunden-Format
AM/PM
optional Sekunden
Kombinationen
Datum + Uhrzeit
Timestamp
Timestamp mit Sekunden
Timestamp mit Zeitzoneninformation

Die Unterscheidung zwischen:

Datum
Uhrzeit
Datum + Uhrzeit
Timestamp

muss explizit erfolgen.

7. Zweistellige Jahreszahlen

Für YY gilt standardmäßig:

00–49 → 2000–2049
50–99 → 1950–1999

Die Pivot-Regel ist konfigurierbar und kann mandantenspezifisch überschrieben werden.

Beispiel:

18.08.26 → 18.08.2026
18.08.50 → 18.08.1950

Die verwendete Regel muss im Verarbeitungskontext nachvollziehbar sein.

8. Zahlenformate und Region

Die in UniCom konfigurierte Region ist maßgeblich für die Interpretation von Zahlen.

Beispiel Deutschland:

1.234,56

→ 1234,56

Beispiel USA:

1,234.56

→ 1234.56

UniCom darf bei einer erkannten Abweichung nicht eigenmächtig die Region ändern.

Eine falsch konfigurierte Region ist ein Konfigurationsfehler und muss dem Benutzer angezeigt werden.

9. Intelligente Zahlenformat-Erkennung

Nicht jede formale Abweichung stellt automatisch einen Konflikt dar.

UniCom muss Region, Profil, Stichprobe und bereits bekannte Muster berücksichtigen.

Beispiel:

1.234,56
2.345,67
5.678,90
1,234.56

Wenn eindeutig festgestellt werden kann, dass der letzte Wert lediglich ein Ausreißer ist und die korrekte Interpretation mit ausreichender Konfidenz feststeht, darf UniCom diesen automatisch normalisieren.

Die Korrektur wird protokolliert.

10. Echte Zahlenkonflikte

Ein Konflikt entsteht insbesondere bei:

mehrdeutigen Zahlenformaten
widersprüchlichen Formaten ohne ausreichende Konfidenz
nicht interpretierbaren Zahlen
nichtnumerischen Werten in numerischen Pflichtfeldern
widersprüchlichen Profilvorgaben
nicht eindeutig auflösbaren Formatabweichungen

Beispiel:

1,234

kann abhängig von Region bedeuten:

1234

oder:

1,234

Wenn keine eindeutige Entscheidung möglich ist, entsteht ein Konflikt.

11. Negative Zahlen

Unterstützt werden:

-1234,56
-1.234,56
-1234.56
-1,234.56

abhängig von Region und Profil.

Auch Klammernotation für negative Werte kann unterstützt werden:

(1.234,56)
12. Prozentwerte

Prozentwerte müssen unterstützt werden.

Dabei muss zwischen Darstellung und internem numerischem Wert unterschieden werden.

Beispielsweise:

15,5 %

kann je nach Profil intern als:

0,155

oder:

15,5

interpretiert werden.

Diese Semantik muss eindeutig konfigurierbar sein.

13. Währungswerte

Währungswerte müssen unterstützt werden.

Beispiele:

1.234,56 €
€ 1.234,56
1,234.56 USD
USD 1,234.56

Währung und numerischer Wert werden intern getrennt betrachtet.

14. Null- und Leerwerte

Profile müssen definieren können, welche Darstellungen als leer bzw. NULL interpretiert werden.

Beispielsweise:

""
-
—
N/A
NULL
null

Diese Werte dürfen nicht automatisch als echte numerische oder textuelle Werte interpretiert werden, wenn sie als NULL-Werte definiert sind.

15. Selbstlernende Mapping-Tabellen

UniCom unterstützt Mapping-Tabellen zur automatischen Zuordnung unterschiedlicher Feldbezeichnungen.

Beispiel:

Kundennr.
Kunden-Nr
CustomerID
Customer_Number

können auf ein internes Feld wie:

customerId

zugeordnet werden.

Zwei Arten von Mappings

UniCom unterscheidet:

Wertmapping (Datenebene)

Ordnet einem vorkommenden Wert seinen fachlichen Wert zu.

Beispiel:

FFm → Frankfurt am Main

Feldmapping (Strukturebene)

Ordnet eine Feldbezeichnung einem internen Feld zu.

Beispiel:

Kunde-ID, Kundennummer, Customer-ID → customerId

Wertmappings lernt UniCom selbst. Sie wirken ohne Freigabe, werden protokolliert und sind in der Mapping-Verwaltung einsehbar und rücknehmbar.

Ein Feldmapping wird dagegen erst durch eine ausdrückliche Bestätigung eines Benutzers zu einer dauerhaften Regel.

Der Unterschied ist nicht die Mühe, sondern die Wirkung: Ein falsches Wertmapping trifft einen Wert, den man im Datensatz sieht. Ein falsches Feldmapping leitet eine ganze Spalte still in das falsche Zielfeld — und das fällt auf, wenn die Daten längst woanders sind.

Anwenden ist nicht dasselbe wie Regel werden

Eine eindeutige Zuordnung darf im laufenden Verarbeitungslauf angewendet werden (SPEC-04, Abschnitt 3).

Dauerhafte Regel wird sie erst mit der Bestätigung.

Damit bleibt der Grundsatz erhalten, so viel wie möglich automatisch zu erkennen und zu lösen, ohne dass eine ungeprüfte Vermutung in den Regelbestand wandert.

16. Allgemeine und mandantenspezifische Mappings

Mappings existieren auf zwei Ebenen:

Allgemein

Gilt für UniCom bzw. allgemein bekannte Datenstrukturen.

Mandantenspezifisch

Gilt nur für den jeweiligen Mandanten.

Priorität:

Mandantenspezifisches Mapping
        ↓
Mapping des Profils
        ↓
Allgemeines Mapping
        ↓
automatische Erkennung
        ↓
Benutzerentscheidung

Mandantenspezifische Regeln haben Vorrang. Die Reihenfolge ist dieselbe wie in Abschnitt 40.

17. Lernverhalten

UniCom darf aus Benutzerentscheidungen lernen.

Eine einzelne unsichere automatische Vermutung darf jedoch nicht automatisch zu einer dauerhaft gültigen Regel werden.

Wertmappings können insbesondere durch:

bestätigte Benutzerentscheidungen
wiederholt bestätigte Zuordnungen
ausreichend sichere automatische Entscheidungen

entstehen.

Feldmappings entstehen ausschließlich durch eine ausdrückliche Bestätigung.

Mappings speichern mindestens:

Quelle
Ziel
Mandant
Confidence
Anzahl der Bestätigungen
Herkunft der Regel
Erstellungs-/Änderungsinformationen
Version/Historie

Die Regel selbst ist Konfiguration und steht in JSON. Confidence, Anzahl der Bestätigungen und die Lernhistorie sind Betriebsdaten und stehen in SQLite (SPEC-01, Abschnitt 11).
18. Schutz vor falschem Umlernen

Ein bestehendes Mapping darf nicht aufgrund eines einzelnen widersprüchlichen Datensatzes automatisch verändert oder gelöscht werden.

Widersprüche führen zu:

Neubewertung bzw. Konflikt.

Das System darf sich nicht durch einzelne fehlerhafte Eingangsdaten selbst „umlernen“.

19. Mapping-Verwaltung

Der Benutzer erhält einen eigenen Bereich zur Verwaltung der Mapping-Regeln.

Er kann:

Mappings anzeigen
suchen
filtern
bearbeiten
aktivieren/deaktivieren
löschen
Confidence einsehen
Anzahl der Bestätigungen einsehen
Quelle/Herkunft einsehen
globale und mandantenspezifische Mappings unterscheiden
historische Versionen nachvollziehen

Das automatische Lernen muss für den Benutzer transparent und kontrollierbar sein.

20. Konfliktmanagement

Datensätze, die nicht sicher verarbeitet werden können, dürfen die Verarbeitung der übrigen Datensätze grundsätzlich nicht blockieren.

Verarbeitungsweg:

Originaldatei
     ↓
Arbeitsbestand
     ↓
 ┌───────────────┐
 │               │
 ▼               ▼
eindeutig       Konflikt
 │               │
 ▼               ▼
weiter          Konfliktbestand
21. Originaldatei

Eine Originaldatei darf von UniCom niemals verändert, überschrieben oder gelöscht werden.

Dies ist eine unveränderliche Grundregel.

Die Verarbeitung erfolgt auf einer Arbeitsgrundlage.

22. Konfliktbestand

Konfliktdatensätze werden aus dem weiterzuverarbeitenden Arbeitsbestand entfernt bzw. von diesem getrennt und in einem separaten Konfliktbestand geführt.

Dadurch kann die restliche Datei weiterverarbeitet werden.

Der Konfliktbestand enthält neben den ursprünglichen Daten mindestens die Informationen, die zur Bearbeitung des Konflikts erforderlich sind.

Dazu gehören insbesondere:

Datensatz-ID
ursprünglicher Wert
betroffenes Feld
erkannter Wert bzw. mögliche Werte
Problembeschreibung
Confidence
Verarbeitungslauf
Zeitstempel
23. Benutzeraktionen bei Konflikten

Jeder Konfliktdatensatz muss komfortabel bearbeitet werden können.

Mindestens folgende Aktionen:

Ändern
Ignorieren
Löschen
Archivieren
Übernehmen/erneut verarbeiten

Die Bearbeitung muss ohne unnötige Dateiverwaltung durch den Benutzer möglich sein.

24. Neuer Verarbeitungslauf

Bearbeitete Konfliktdatensätze werden nicht rückwirkend in den ursprünglichen Verarbeitungslauf eingefügt.

Nach einer Entscheidung entsteht ein:

neuer Verarbeitungslauf mit eigener Verarbeitungs-ID.

Damit bleiben alle Verarbeitungsvorgänge eindeutig voneinander getrennt.

25. Eindeutige Zuordnung von Konfliktbeständen

Ein Konfliktbestand gehört immer genau einem Verarbeitungslauf.

Er darf niemals Datensätze aus mehreren Verarbeitungsläufen enthalten.

Die eindeutige Zuordnung ergibt sich aus der Verknüpfung mit dem Verarbeitungslauf in der Datenbank.

Eine ausgeleitete Konfliktdatei trägt sie zusätzlich im automatisch erzeugten Dateinamen, damit sie auch außerhalb von UniCom zuordenbar bleibt.

Der Benutzer muss die Dateinamen nicht selbst verwalten.

26. Mehrere zusammengehörige Dateien

Mehrere Dateien können zu einer fachlichen Dateigruppe gehören.

UniCom unterscheidet dabei zwei Betriebsarten:

Anreichern — eine Datei führt, weitere ergänzen sie.
Sammeln — gleichwertige Quellen kommen in einen gemeinsamen Bestand.

Welche Art gilt, wird eingestellt und nicht aus den Eingangsdaten abgeleitet (SPEC-06, Abschnitt 4).

Beim Anreichern wird für jede Dateigruppe genau eine Hauptdatei definiert. Weitere Dateien werden als abhängige bzw. ergänzende Dateien zugeordnet.

Beispiel:

Kunden.csv, dazu Adressen.csv und Kontakte.csv über die Kundennummer.

Beim Sammeln gibt es keine Hauptdatei. Alle Quellen sind gleichwertig; doppelte Datensätze findet die Dublettenerkennung (SPEC-04, Abschnitt 7).

Beispiel:

Filiale-Nord.csv und Filiale-Sued.csv, beides Kundenlisten.

Die folgenden Abschnitte 27 bis 30 gelten für das Anreichern.

27. Hauptdatei

Die Hauptdatei liefert grundsätzlich die Referenzdatensätze.

Beispiel:

Kunden.csv
Adressen.csv
Kontakte.csv

mit:

Kunden.csv = Hauptdatei

Die Hauptdatei darf nicht automatisch durch UniCom erraten werden.

Sie muss in der Mandanten-/Profildefinition eindeutig festgelegt sein.

28. Zuordnungsschlüssel

Zusatzdateien werden über definierte Schlüssel mit der Hauptdatei verbunden.

Es müssen unterstützt werden:

einfache Schlüssel
zusammengesetzte Schlüssel (Composite Keys)

Beispiel:

Kunden.ID
=
Adressen.KundenID

oder:

Mandant + Kundennummer
=
Mandant + Kundennummer
29. Mehrfachtreffer

Wenn mehrere Datensätze einer Zusatzdatei auf denselben Hauptdatensatz verweisen, muss das definierte fachliche Verhalten greifen.

Mögliche Regeln:

genau ein Treffer erwartet → Mehrfachtreffer = Konflikt
mehrere Treffer erlaubt → alle übernehmen
aktueller Datensatz verwenden
Status-/Prioritätsregel verwenden

Die konkrete Regel wird im Profil bzw. in den Konsolidierungseinstellungen definiert.

30. Fehlender Referenzdatensatz

Diese Regel gilt beim Anreichern.

Existiert für einen Datensatz der Zusatzdatei kein Referenzdatensatz in der Hauptdatei, darf UniCom standardmäßig keinen neuen Hauptdatensatz erzeugen.

Standardverhalten:

Fehlender Referenzdatensatz → Konflikt

Eine abweichende Regel muss explizit konfiguriert werden.

Beim Sammeln entsteht daraus kein Konflikt: dort gibt es keine Hauptdatei, auf die sich ein Datensatz beziehen müsste.

31. Dateinamenszuordnung

Die bestehende UniCom-Dateinamenslogik bleibt verbindlich erhalten.

Unterstützt werden:

*Dateiname.ext
Dateiname*.ext
*Dateiname*.ext

Damit kann festgelegt werden:

Text am Anfang
Text am Ende
Text irgendwo innerhalb des Dateinamens

Diese Logik wird sowohl bei Eingangsdaten als auch bei der Zuordnung zusammengehöriger Dateien verwendet.

32. Konsistenz der Dateinamensregeln

UniCom muss erkennen, wenn Dateiquelle und Zuordnungskriterium widersprüchlich definiert sind.

Beispiel:

Quelle:
*Kunden*.csv


Zuordnung:
Kunden_*.csv

Solche Konfigurationen müssen im Preflight-Check geprüft werden.

33. Zusammenspiel der drei UniCom-Module

Die Module:

Daten übertragen
Daten konsolidieren
Daten exportieren/importieren

sind unabhängig nutzbar.

Unterstützte Kombinationen:

1 → 2
1 → 3
2 → 3
1 → 2 → 3

Kein Modul darf voraussetzen, dass die anderen Module installiert oder aktiviert sind.

34. Gemeinsame Datenübergabe

Die Module verwenden die gemeinsame UniCom-Verzeichnis- und Verarbeitungsstruktur.

Ein Modul darf das interne Datenmodell eines anderen Moduls nicht direkt manipulieren.

Datenübergaben erfolgen über definierte Datenbestände und Verarbeitungsläufe.

35. Modul 1 → Modul 2

Modul 1 stellt die übertragenen Daten in dem definierten UniCom-Datenbereich bereit.

Modul 2 identifiziert die für die Konsolidierung vorgesehenen Daten anhand der konfigurierten Regeln.

36. Modul 2 → Modul 3

Das Ergebnis der Konsolidierung wird als definierter Datenbestand bereitgestellt.

Modul 3 kann diesen Datenbestand für Export oder Import verwenden.

Das konkrete Ausgabeformat von Modul 3 ist unabhängig vom internen Konsolidierungsformat.

37. Preflight-Check

Vor einem Verarbeitungslauf muss UniCom prüfen, ob die konfigurierte Verarbeitung ausführbar ist.

Zu prüfen sind insbesondere:

Quelle vorhanden
Leseberechtigung
Zielverzeichnis vorhanden
Schreibberechtigung
Dateinamensregeln
Eingangsprofil
Profilversion
Mapping
Hauptdatei
abhängige Dateien
aktivierte Module
Export-/Importdefinition
erforderliche Ressourcen

Erst bei erfolgreichem Preflight darf die Verarbeitung gestartet werden.

38. Abhängigkeiten

Bei einer Verarbeitungskette:

1 → 2 → 3

darf Modul 3 nicht mit einem ungültigen oder unvollständigen Ergebnis von Modul 2 gestartet werden.

Beispiel:

Modul 1 ✓
     ↓
Modul 2 ✗
     ↓
Modul 3 NICHT STARTEN

Als unvollständig im Sinne dieser Regel gilt auch ein Ergebnis, das nach SPEC-08, Abschnitt 13, noch nicht freigegeben ist.
39. Verarbeitungs-IDs

Jeder Verarbeitungslauf erhält eine eindeutige Verarbeitungs-ID.

Bei einer Modul-/Workflow-Kette kann zusätzlich eine übergeordnete Workflow-ID verwendet werden.

Damit sind:

Quelle
Verarbeitung
Konfliktbestand
Ergebnis
Folgeprozess

eindeutig miteinander verknüpft.

40. Konfigurationshierarchie

UniCom unterscheidet drei Ebenen:

Allgemein — was UniCom mitbringt.
Profil — die Einstellungen für eine konkrete Eingangsquelle.
Mandant — die Festlegungen des Kunden.

Es gilt:

Mandant
   ↓
Profil
   ↓
Allgemein

Die Einstellung des Mandanten gewinnt immer.

Ein Profil kann eine allgemeine Einstellung überschreiben, eine mandantenspezifische nicht. Ein Profil ist eine Sammlung von Einstellungen und keine übergeordnete Ebene.

Einstellung und Feststellung

Im Profil stehen zwei verschiedene Dinge.

Eine Einstellung ist eine Wahl: Region, Pivot-Regel für zweistellige Jahreszahlen, Rundung, Mapping, Verhalten bei Dubletten. Für sie gilt die Hierarchie.

Eine Feststellung beschreibt eine Eigenschaft der Eingangsdatei: Trennzeichen, Encoding, Header-Verhalten, Textqualifizierer, Feldpositionen einer Fixed-Width-Datei sowie das in dieser Datei tatsächlich verwendete Datums- und Zahlenformat.

Feststellungen sind keine Einstellungen im Sinne dieser Hierarchie und nicht überschreibbar.

Eine Datei, die mit Komma trennt, trennt nicht Semikolon, weil am Mandanten Semikolon eingestellt ist. Wäre eine Feststellung überschreibbar, entstünde daraus ein stiller Fehler: „Meier;Frankfurt" ergibt auch als ein einziges Feld etwas Lesbares.

41. Effektive Einstellungen

Der Benutzer muss erkennen können, welche Einstellung tatsächlich verwendet wird.

Beispiel:

Region


Allgemein:   de-DE
Profil:      fr-FR
Mandant:     en-US


Effektiv:    en-US

Dadurch bleiben Konfigurationsvererbungen transparent.

42. Nicht überschreibbare Systemregeln

Bestimmte Grundregeln dürfen nicht durch Mandanten oder Profile außer Kraft gesetzt werden.

Dazu gehören insbesondere:

Originaldateien bleiben unverändert
Konfliktbestände bleiben Verarbeitungsläufen eindeutig zugeordnet
Historie bleibt nachvollziehbar
Verarbeitungs-IDs bleiben eindeutig
43. Konfigurations-Snapshot

Beim Start eines Verarbeitungslaufs wird die zu diesem Zeitpunkt gültige Konfiguration eindeutig festgehalten.

Eine spätere Änderung von:

Profil
Mapping
Region
Regeln
Einstellungen

darf einen bereits abgeschlossenen oder laufenden Verarbeitungslauf nicht nachträglich verändern.

44. Protokollierung

Einwandfrei verarbeitete Datensätze werden nicht einzeln protokolliert.

Detailliert protokolliert werden:

Fehler
Warnungen
Konflikte
automatische Korrekturen
Benutzerentscheidungen
relevante Verarbeitungsschritte
Abbrüche
außergewöhnliche Ereignisse
45. Verarbeitungsstatistik

Jeder Lauf erhält eine zusammenfassende Statistik.

Beispiel:

Eingang:                 10.000
Erfolgreich:              9.942
Automatisch korrigiert:      43
Konflikte:                   15
Fehler:                       0

Damit bleibt der Verarbeitungslauf auch ohne Einzelprotokollierung vollständig nachvollziehbar.

46. Benutzerentscheidungen

Manuelle Entscheidungen werden mit der eindeutigen Benutzer-ID des angemeldeten UniCom-Benutzers protokolliert.

Zu speichern sind insbesondere:

Benutzer-ID
Zeitpunkt
Verarbeitungslauf
Datensatz
ursprünglicher Wert
neue Entscheidung bzw. neuer Wert
Aktion

Die Verwaltung der Benutzer-ID und Authentifizierung ist nicht Bestandteil von SPEC-02, sondern der zentralen UniCom-Authentifizierung.

47. Speicherung

Es wird eine hybride Speicherung verwendet.

JSON

Für:

Einstellungen
Profile
Definitionen
Mapping-Konfigurationen
Regeln
SQLite

Für:

Verarbeitungsläufe
Status
Ereignisse
Konflikte
Benutzerentscheidungen
Statistiken
Historie
Confidence und Bestätigungszähler gelernter Mappings

Damit werden Konfiguration und Laufzeit-/Historieninformationen sauber getrennt.

Eine gelernte Regel steht in JSON, weil sie beschreibt, wie UniCom arbeiten soll. Wie oft sie bestätigt wurde, steht in SQLite, weil es beschreibt, was tatsächlich passiert ist.

48. Live-Verarbeitungsansicht

Bei einer Verarbeitung im Vordergrund erhält der Benutzer eine Live-Ansicht.

Anzuzeigen sind mindestens:

aktuelle Datei
Fortschritt
Anzahl verarbeiteter Datensätze
erfolgreiche Datensätze
automatische Korrekturen
Konflikte
Fehler
letzte relevante Aktivität
aktueller Verarbeitungsstatus

Die Ansicht dient der Transparenz und ersetzt nicht das dauerhafte Protokoll.

49. HTTP API und SSE

Für die Live-Kommunikation werden verbindlich vorgesehen:

HTTP API + Server-Sent Events (SSE)

Die HTTP API stellt Statusinformationen bereit.

SSE übermittelt laufende Ereignisse und Statusänderungen an eine geöffnete Oberfläche.

Beispielsweise:

START
PROGRESS
CORRECTION
CONFLICT
WARNING
ERROR
COMPLETE
50. Verarbeitung ohne Browser

Die Verarbeitung darf niemals von einem geöffneten Browser abhängig sein.

Bei Hintergrundbetrieb:

Background Worker
       │
       ├── SQLite
       ├── HTTP API
       └── Benachrichtigung

Die Live-Ansicht wird nur verwendet, wenn eine Benutzeroberfläche geöffnet ist.

Wird der Browser geschlossen, läuft die Verarbeitung unabhängig davon weiter.

51. Benachrichtigungen

Der Benutzer muss insbesondere bei folgenden Ereignissen informiert werden:

unerwarteter Abbruch
Fehler
neu entstandener Konfliktbestand

Über welche Kanäle eine Meldung geht, legt SPEC-01, Abschnitt 21, fest.

Ein neu entstandener Konfliktbestand ist eine Meldung der Stufe „Aktion erforderlich"; ein unerwarteter Abbruch und ein technischer Fehler sind kritische Ereignisse. In beiden Fällen gehören E-Mail und lokale Benachrichtigung dazu.

Die Benachrichtigung darf nicht davon abhängig sein, dass der Benutzer UniCom manuell öffnet.

Eine erfolgreiche Verarbeitung kann optional ebenfalls per E-Mail gemeldet werden.

52. Hintergrundabbruch

Ein unerwartet beendeter Hintergrundprozess muss dauerhaft erkannt und gespeichert werden.

Der Status darf nicht dauerhaft auf RUNNING stehen bleiben.

Die konkrete technische Recovery-/Resume-Logik wird in der technischen Worker-Spezifikation definiert.

53. Abgrenzung zu SPEC-01

SPEC-02 nutzt die in SPEC-01 definierten gemeinsamen Grundlagen, insbesondere:

UniCom-Verzeichnisstruktur
On-Premise-Ausführung
Background Worker
HTTP API
SSE
Benachrichtigungsmechanismus
hybride JSON-/SQLite-Speicherung
Verarbeitungs-IDs
Preflight-Grundlagen

Die technische Umsetzung dieser Komponenten wird nicht nochmals in SPEC-02 definiert.

54. Abgrenzung zu späteren Modul-Specs

Folgende Punkte werden bewusst in späteren technischen bzw. modulspezifischen Specs detailliert:

konkrete Implementierung des Background Workers
konkrete HTTP-Endpunkte
SSE-Event-Schema
konkretes SQLite-Schema
konkrete JSON-Schemas
konkrete Dateinamenskonventionen
konkrete Recovery-/Resume-Strategien
konkrete Import-/Exportimplementierungen
konkrete UI-Komponenten
konkrete Authentifizierungsimplementierung

SPEC-02 definiert hierfür die fachlichen Anforderungen, nicht die vollständige technische Implementierung.

55. Zentrale Leitlinie

Das Verhalten des Konsolidierungsmoduls lässt sich auf einen zentralen Grundsatz reduzieren:

Automatisieren, was eindeutig ist. Korrigieren, was mit ausreichender Konfidenz eindeutig interpretierbar ist. Dem Benutzer vorlegen, was nicht eindeutig ist. Niemals Originaldaten verändern oder unsichere Entscheidungen stillschweigend übernehmen.

Status SPEC-02
Bereich	Status
Dateiformate	✅ FINAL
Profile	✅ FINAL
Stichprobenerkennung	✅ FINAL
Konfidenz	✅ FINAL
Datum/Zeit/Timestamp	✅ FINAL
Zahlen/Region	✅ FINAL
Mapping/Lernen	✅ FINAL
Konfliktmanagement	✅ FINAL
Mehrere Dateien/Hauptdatei	✅ FINAL
Modulübergreifende Verarbeitung	✅ FINAL
Einstellungen/Prioritäten	✅ FINAL
Logging/Live-Ansicht	✅ FINAL

SPEC-02 ist damit fachlich final. Die noch offenen Punkte sind bewusst technische Folge-Spezifikationen und keine fachlichen Lücken mehr.

56. Änderungsverzeichnis
Version 1.4

Abschnitt 2 und 2.2: XLS ist gestrichen; unterstützt wird XLSX.

Version 1.3

Abschnitt 4: Die Stichprobe wächst höchstens auf 1.000 Datensätze.

„Maximal 100" und „muss erweitert werden" standen bisher in demselben Abschnitt.
Ein Maximum, das überschritten werden muss, ist keines.

Abschnitt 5: Die 97 % sind als Untergrenze bezeichnet.

SPEC-04 und SPEC-05 sprechen von einer konfigurierten Schwelle; ohne diesen Satz
hätte eine Konfiguration die zentrale Schwelle unterlaufen können.

Abschnitt 51: Die Kanäle je Stufe stehen nur noch in SPEC-01, Abschnitt 21.

Version 1.2

Abschnitt 15: Wertmapping und Feldmapping werden unterschieden; nur das
Feldmapping wird durch Bestätigung zur dauerhaften Regel.

Bisher lernte UniCom nach Abschnitt 17 selbsttätig, während SPEC-05 jede Änderung
einer verwendeten Definition unter Versionierung und Freigabe stellte. Beides
zusammen ging nicht: entweder lernte das System nicht mehr, oder die Versionskette
war gebrochen. Der Satz „Anwenden ist nicht dasselbe wie Regel werden" hält beides
auseinander.

Abschnitt 16 und 40: Die Konfigurationshierarchie lautet Mandant vor Profil vor
Allgemein.

Abschnitt 16 sagte „Mandant gewinnt", Abschnitt 40 „die spezifischere Ebene
gewinnt" und damit Profil vor Mandant — zwei entgegengesetzte Aussagen in
derselben Spec. Neu hinzugekommen ist die Abgrenzung zwischen Einstellung und
Feststellung: Was die Eingangsdatei beschreibt, ist keine Wahl und damit nicht
überschreibbar.

Abschnitt 26 und 30: Anreichern und Sammeln werden unterschieden.

Die Pflicht zu genau einer Hauptdatei galt bisher für jede Dateigruppe. Beim
Sammeln gleichartiger Quellen — SPEC-06 nennt es Append — gibt es keine
Hauptdatei; nach dem alten Abschnitt 30 wäre dort jeder Datensatz der zweiten
Quelle ein Konflikt gewesen.

Abschnitt 17 und 47: Confidence und Bestätigungszähler stehen in SQLite, die
Regel selbst in JSON.

Version 1.1

Abschnitt 25: Die eindeutige Zuordnung eines Konfliktbestands hängt an der
Datenbank, nicht am Dateinamen.

Bisher trug das Dateinamensschema die Zuordnung mit. Damit gab es zwei Stellen,
die dasselbe wussten und auseinanderlaufen konnten. Der Dateiname trägt sie
weiterhin, aber nur noch als Zugabe für ausgeleitete Dateien.

Abschnitt 38: Ein nicht freigegebenes Ergebnis gilt als unvollständig.

Ohne diesen Satz hätte Modul 3 ein Ergebnis abholen dürfen, dessen Freigabe nach
SPEC-08 noch aussteht.