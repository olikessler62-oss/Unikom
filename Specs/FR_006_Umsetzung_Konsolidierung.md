# FR_006 — Bauplan Konsolidierung

Stand 19.08.2026. Grundlage: SPEC-01 bis SPEC-11 in den Fassungen nach der
Überarbeitung.

Kein Anforderungsdokument. Dies ist der Weg vom Text zum Code: welcher
Spec-Abschnitt auf welchen Teil fällt, in welcher Reihenfolge, und was in einer
Etappe **nicht** gebaut wird.

---

## Was schon steht

Modul 1 ist gebaut, und mehr davon ist wiederverwendbar, als man auf den ersten
Blick sieht:

| Vorhanden | Wofür die Konsolidierung es braucht |
| --- | --- |
| Quellen (lokal, Freigabe, FTPS, SFTP) samt Zugängen | SPEC-03 §2 — die Konsolidierung liest aus denselben Quellen |
| Verzeichnisbrowser mit Baum | Auswahl der Eingangsdateien |
| Staging-Bereich | SPEC-01 §7 — der Arbeitsbestand neben dem unveränderten Original |
| Läufe, Protokoll in SQLite, Aufbewahrung | SPEC-01 §8, §29; SPEC-02 §44 |
| Mandanten mit Region und Zeitzone | SPEC-02 §8, §40 |
| Benutzer, Benutzer-ID im Protokoll | SPEC-02 §46, SPEC-07 §12 |
| Lizenzprüfung je Modul | SPEC-02 §33 — CONSOLIDATION ist bereits eine Marke |
| Zeitplan und Fälligkeit | SPEC-01 §24 |
| Verschlüsselung als Verarbeitungsschritt | SPEC-01 §4 |

Nicht gebaut ist alles, was Daten **innerhalb** einer Datei betrifft. Modul 1
kennt Dateien; die Konsolidierung kennt Datensätze und Felder. Das ist die
eigentliche Grenze.

---

## Zwei Entscheidungen vor der ersten Zeile Code

### 1. Die Stufenkette trägt die Konsolidierung nicht

`ProcessingStage` in [src/domain/processing/ProcessingStage.ts](../src/domain/processing/ProcessingStage.ts)
nimmt einen `FileProcessingContext` und gibt einen zurück: **eine Datei rein,
eine Datei raus**. Die Registry prüft danach sogar, dass eine Stufe, die die
Datei ersetzt, auch den neuen Hash mitliefert.

Eine Konsolidierung nimmt *drei* Dateien und erzeugt *einen* Ergebnisbestand,
dazu einen Konfliktbestand und eine Statistik. Das passt nicht in einen Vertrag,
dessen Zusicherung „dieselbe Datei, nur verändert" lautet.

**Vorschlag:** Die bestehende Kette bleibt, wie sie ist — sie ist für
dateiweise Arbeit richtig (entschlüsseln, verschlüsseln, konvertieren). Daneben
entsteht ein zweiter Vertrag für mengenweise Arbeit:

```
ProcessingStage    eine Datei  → eine Datei        (vorhanden)
ConsolidationStep  n Quellen   → Ergebnisbestand   (neu)
                               + Konfliktbestand
                               + Statistik
```

Beide hängen an derselben Verarbeitungs-ID und demselben Protokoll. Was die
Konsolidierung ausgibt, kann anschließend wieder dateiweise weiterlaufen
(SPEC-02 §36).

Der Fehler, den man hier machen kann, ist verlockend: die Konsolidierung in den
vorhandenen Vertrag zu pressen, weil er schon da ist. Dann wandert die
Mengenlogik in Felder, die für etwas anderes gedacht sind, und die Zusicherung
der Registry wird zur Lüge.

### 2. Definitionen in JSON — auch die, die es schon gibt?

SPEC-01 §11 ist eindeutig: *„JSON beschreibt, wie UniCom arbeiten soll. SQLite
beschreibt, was tatsächlich passiert ist."* Profile, Mappings und Regeln gehören
danach in JSON unter `config/`.

Die Implementierung hält es heute anders: Workflows, Mandanten und Zugänge sind
Definitionen und liegen als Dokumente **in SQLite**. Das ist kein Widerspruch
zwischen zwei Specs, sondern zwischen Spec und gebautem Produkt — die letzte
offene Kreuzung dieser Art.

Drei mögliche Wege, sie schließen einander aus:

**a) Der Spec folgen.** Profile und Mappings als JSON-Dateien unter
`config/tenants/<mandant>/`. Vorteil: ein Kunde kann eine Definition ansehen, in
eine Versionsverwaltung legen, per Mail schicken (SPEC-05 §11 verlangt Import
und Export ohnehin). Nachteil: zwei Speicherorte mit zwei Sicherungswegen — die
Sicherung über `VACUUM INTO` erfasst JSON-Dateien **nicht**.

**b) Alles in SQLite, SPEC-01 §11 anpassen.** Ein Speicherort, eine Sicherung,
vorhandene Muster. Import und Export werden zu Funktionen statt zu Dateien.

**c) Gemischt wie heute:** Definitionen in SQLite, Ausleitung nach JSON auf
Wunsch — dieselbe Bauweise, die wir gerade für die Konfliktdateien beschlossen
haben (SPEC-07: die Datenbank führt, Dateien sind Ausleitungen).

Empfehlung: **c**. Es ist die Regel, die im Haus schon gilt, und sie hält die
Sicherung bei einem Weg. SPEC-01 §11 wäre entsprechend zu schärfen.

**Entschieden: c.** Die Definitionen liegen in SQLite; JSON ist Ausleitung auf
Wunsch. Es ist die Regel, die im Haus schon für Workflows, Mandanten, Zugänge
und den Konfliktbestand gilt, und sie hält die Sicherung bei einem Weg: Ein
`VACUUM INTO` erfasst alles, ein zweiter Speicherort daneben nicht.

SPEC-01, Abschnitt 11, ist entsprechend geschärft.

---

## Die Etappen

Jede Etappe ist für sich brauchbar und wird abgenommen, bevor die nächste
beginnt. Die Reihenfolge folgt der Abhängigkeit, nicht der Spec-Nummerierung.

### Etappe 1 — Lesen und erkennen ✔ gebaut

**Ziel:** Eine Datei einlesen, ihre Struktur erkennen, Felder und Datentypen
bestimmen, das Ergebnis anzeigen. Noch keine Zuordnung, kein Ziel, kein Ergebnis.

**Specs:** SPEC-02 §2 bis §14 (Formate, Trennzeichen, Stichprobe, Konfidenz,
Datum, Zahlen, Region, Null-Werte) · SPEC-03 §4 bis §8 (CSV, Excel, TXT,
Fixed-Width, JSON, XML) · SPEC-08 §2 und §3.

**Code:**
```
src/domain/consolidation/     Feld, Datentyp, Erkennungsergebnis, Konfidenz
src/infrastructure/formats/   CsvReader, ExcelReader, FixedWidthReader,
                              JsonReader, XmlReader
```

**Worauf es ankommt:**
- Die Stichprobe nach SPEC-02 §4: Regelfall 100, Erweiterung bis 1.000, danach
  gilt die Erkennung als unsicher. Kein Ergebnis auf gut Glück.
- Region kommt vom **Mandanten** (`regionOf(tenant)`, existiert bereits). Ein
  Datum ohne Region gelesen ist der teuerste Fehler des ganzen Moduls, weil
  `04/03/2026` in beiden Lesarten gelingt.
- XML ohne externe Entitäten (SPEC-03 §8).
- Der Header bestimmt **nie** den Datentyp (SPEC-02 §2.3, SPEC-03 §4).

**Prüfbar mit:** echten Beispieldateien im Repository — deutsch und
amerikanisch, mit und ohne Header, Semikolon und Komma, Umlaute in Windows-1252.
Ohne diese Dateien ist die Erkennung nicht zu testen und alles Weitere steht auf
Sand.

**Nicht in dieser Etappe:** Mapping, Dubletten, Konflikte, Oberfläche außer einer
schlichten Vorschau.

**Gebaut:**

```
src/domain/consolidation/Numbers.ts       Zahlen nach Region, streng geprüfte Gruppierung
src/domain/consolidation/Dates.ts         Datum mit Reihenfolge und Jahrhundertgrenze
src/domain/consolidation/Recognition.ts   Stichprobe 100 → 1.000, Konfidenz, Mischspalten
src/infrastructure/formats/Csv.ts         Zeichensatz, Trennzeichen, Kopfzeile
src/infrastructure/formats/Xlsx.ts        XLSX über einen eigenen ZIP-Leser
src/infrastructure/formats/FixedWidth.ts  Position und Länge, Ausrichtung, Füllzeichen
src/infrastructure/formats/Json.ts        verschachtelt → flach, mit den Typen der Datei
src/infrastructure/formats/Xml.ts         eigener Parser, Attribute als Felder, ohne Entitäten
src/infrastructure/formats/Bestand.ts     die gemeinsame Form aller Leser
src/testing/consolidation/                der Fallkatalog, als Test und als Datei
```

**Was dabei entschieden wurde, und warum:**

*Ein Ergebnis für vier Formate.* Jeder Leser liefert `Gelesen`: Feldnamen,
Zeilen, Feststellungen. Alles danach — Erkennung, Mapping, Konsolidierung —
muss nicht wissen, woher die Daten kamen. Die Zellen tragen ihren erklärten Typ
mit, wo das Format ihn kennt.

*JSON und XML gehen nicht durch die Blocksuche.* Sie bringen ihre Feldnamen mit
und wissen, wo die Daten anfangen. Sie durch die Erkennung zu schicken, die aus
einem E-Mail-Text die Tabelle heraussucht, könnte etwas anderes finden als das,
was in der Datei steht.

*Ein eigener XML-Parser, und Sicherheit als Auslassung.* Übliche Parser können
externe Entitäten auflösen und müssen davon abgehalten werden; wer die
Einstellung vergisst, liest dem Angreifer die Passwortdatei vor (XXE). Dieser
Leser **kennt** keine Entitätsdeklarationen und weist eine Datei ab, die welche
mitbringt — statt sie ohne sie zu lesen und damit etwas anderes zu liefern, als
dort steht. Damit ist auch die Milliarden-Lacher-Falle zu.

*Feste Feldbreiten: Zeichen oder Bytes ist eine Frage, keine Voreinstellung.*
Wer die Positionen in Bytes gezählt hat und in Zeichen ausliest, bekommt ab dem
ersten Umlaut alles verschoben — und es sieht weiterhin aus wie Daten.
Voreingestellt sind Zeichen; enthält die Datei mehrbytige Zeichen, sagt der
Leser es ausdrücklich.

*Führende Nullen entscheidet die Feldbeschreibung, nicht der Leser.* `00042` ist
als Zahl 42 und als Kennung `00042`. Entfernt wird nur an der Seite, an der
aufgefüllt wurde.

**Der Weg zurück** (SPEC-03 §7 und §8) ist gebaut: `writeJson` und `writeXml`
in denselben Dateien wie die Leser, die Pfadzerlegung einmal in
`Pfade.ts` für beide.

*Eine Zerlegung für beide Richtungen.* Beim Lesen wird `kunde.adresse.ort`
daraus, beim Schreiben muss dasselbe wieder entstehen. Zwei Auslegungen
desselben Namens gingen eines Tages auseinander — und dann käme aus einer
gelesenen Datei eine andere heraus, als hineinging.

*Die Rundreise ist die Prüfung.* Lesen, schreiben, wieder lesen: Kommt etwas
anderes heraus, ist einer der beiden Wege falsch. Der ganze Fallkatalog läuft
sie mit, dazu der Weg von JSON nach XML und zurück.

*Die Typen überleben.* Aus `42` darf nicht `"42"` werden — dafür trägt jede
Zelle ihren erklärten Typ. Umgekehrt wird aus dem Text `1.234,50` **keine**
JSON-Zahl: Das wäre eine Umrechnung nach der Region, und die gehört ins
Mapping, nicht in den Schreiber.

*Was nicht als Element taugt, wird umbenannt — laut.* Ein Feld darf
„Bestell Nr." heißen, ein XML-Element nicht. Die Umbenennung steht in den
Meldungen; eine, die niemand mitbekommt, fällt erst beim Empfänger auf.

**Offen aus dieser Etappe:** mit Etappe 17 erledigt — bis auf XSD, siehe dort.

### Etappe 2 — Profil und Snapshot ✔ gebaut

**Ziel:** Das Erkannte festhalten, versionieren und einem Lauf unveränderlich
mitgeben.

**Specs:** SPEC-02 §3, §40 bis §43 · SPEC-03 §18 · SPEC-04 §11.

Konfigurationshierarchie **Mandant → Profil → Allgemein**, dazu die Abgrenzung
zwischen Einstellung und Feststellung (SPEC-02 §40): Was die Datei beschreibt,
ist nicht überschreibbar. Konfigurations-Snapshot je Lauf (SPEC-01 §10).

**Gebaut:**

```
src/domain/consolidation/Einstellungen.ts   Hierarchie, effektive Einstellung mit Herkunft
src/domain/consolidation/Feststellungen.ts  was die Datei beschreibt — eigener Typ
src/domain/consolidation/Profil.ts          Eingangsprofil mit Versionskette
src/domain/consolidation/Snapshot.ts        die eingefrorene Konfiguration eines Laufs
src/application/consolidation/ProfileService.ts
src/interface/http/routes/ProfileRoutes.ts  /api/profiles, /api/profiles/effective, /api/snapshots/:id
```

**Was dabei entschieden wurde, und warum:**

*Ein Begriff statt zwei.* Die „bekannte Struktur" aus FR_008 und das
„Eingangsprofil" aus SPEC-02 waren dieselbe Sache mit zwei Namen. Sie sind
zusammengelegt; die Struktur ist jetzt der Teil einer Profilversion. Zwei
Begriffe für eine Sache laufen auseinander, sobald einer von beiden etwas
dazubekommt.

*Feststellungen sind ein eigener Typ, kein Merkmal.* Der Unterschied ließe sich
auch als `{ wert, ueberschreibbar: false }` führen — dann müsste jede Stelle,
die zusammenführt, das Merkmal beachten, und eine davon vergäße es. So gibt es
gar keine Funktion, die Einstellung und Feststellung verrechnet.

*Unveränderlichkeit ist eingefroren, nicht zugesagt.* `readonly` verschwindet
beim Übersetzen. Profilversionen und Schnappschüsse laufen durch
`Object.freeze` in die Tiefe — auch beim Lesen aus der Datenbank, sonst wäre
die Zusage eine Eigenschaft des Arbeitsspeichers und beim Neustart fort.

*Der Schnappschuss trägt Werte, keine Verweise.* Einer, der `profilId` und
`mandantId` merkt und beim Lesen nachschlägt, ist ein Zeiger auf den heutigen
Stand: Wer am Mandanten die Region ändert, änderte damit rückwirkend die Lesart
jedes vergangenen Laufs.

*Eine Fortschreibung ohne Änderung erzeugt keine Version* — und sagt es. Eine
Kette aus zwanzig gleichen Versionen ist keine Geschichte.

*Nur Einstellungen, die auch wirken.* Ein Feld „Verhalten bei Dubletten" wäre
bis Etappe 6 eine Behauptung auf dem Bildschirm, die niemand einlöst. Die Liste
wächst mit den Etappen, nicht vor ihnen.

**Sichtbar in:** „Daten finden" → *Gelesen mit*: Profil, Version und jede
geltende Einstellung samt der Ebene, von der sie kommt (SPEC-02 §41).

### Etappe 3 — Mapping ✔ gebaut

**Specs:** SPEC-02 §15 bis §19 · SPEC-04 §3 · SPEC-05 · SPEC-09.

Wertmapping lernt selbst; Feldmapping wird bestätigt. **Anwenden ist nicht
dasselbe wie Regel werden.** Die ausgelieferte Bezeichnungsliste (SPEC-09 §4) ist
Teil der Auslieferung, kein Zubehör — ohne sie erkennt V1 keine Bedeutung.
Confidence und Bestätigungszähler nach SQLite, die Regel selbst dorthin, wo
Etappe 2 es entschieden hat.

**Gebaut:**

```
src/domain/mapping/Bezeichnungen.ts        die ausgelieferte Liste, mit Typen je Feld
src/domain/mapping/Feldzuordnung.ts        eindeutig, Vorschlag, mehrdeutig — je mit Begründung
src/domain/mapping/Regelbestand.ts         beide Arten, Rangfolge, Lernverhalten
src/application/mapping/MappingService.ts  anwenden, lernen, bestätigen, zurücknehmen
src/infrastructure/persistence/sqlite/SqliteMappingRepository.ts
src/interface/http/routes/MappingRoutes.ts /api/mappings, /api/mappings/preview
web/src/screens/MappingScreen.tsx          die Verwaltung — Bereich „Zuordnungen"
```

*Die Liste trägt Typen, nicht nur Namen.* „Die semantische Zuordnung darf nicht
ausschließlich anhand des Feldnamens erfolgen" (SPEC-09 §4). Eine Spalte
„Geburtsdatum", in der Namen stehen, ist ein falsch beschrifteter Export — wer
nur den Namen liest, leitet sie still ins Datumsfeld.

*Drei Ausgänge, nicht zwei.* Eindeutig wird angewendet, Wahrscheinliches wird
vorgelegt, Mehrdeutiges bleibt liegen. „So viel wie möglich automatisch
erkennen" heißt nicht „im Zweifel raten".

*Widersprechende Werte sind ein Veto, kein Abschlag.* Stehen in „E-Mail" keine
Adressen, ist die Beschriftung falsch oder die Spalte enthält etwas anderes —
beides gehört einem Menschen vorgelegt. Ein Abzug hätte den Vorschlag stehen
lassen, und ein Vorschlag mit widersprechenden Werten ist eine Einladung zum
Durchwinken.

*Zwei Spalten dürfen nicht in dasselbe Feld.* Sonst entschiede die Reihenfolge,
nicht die Bedeutung; beide werden zurückgestuft.

*Der Unterschied der beiden Arten steht an einer Stelle* — in `wirkt()`. Ein
Feldmapping ohne Bestätigung liegt im Bestand, damit man es bestätigen kann, und
wirkt bis dahin nicht.

*Zurückgenommen heißt nicht gelöscht.* Wer wissen will, warum ein Lauf vom März
etwas zugeordnet hat, das heute niemand mehr zuordnet, findet die Antwort sonst
nirgends.

*Der Zwischenzustand „vorgemerkt" — gefunden durch einen Test.* Der Lernweg
„wiederholt bestätigte Zuordnungen" (§17) war nicht zu erreichen: Ohne
Gedächtnis wäre die zweite Beobachtung wieder die erste, und die Regel
entstünde nie. Eine vorgemerkte Zuordnung steht jetzt im Bestand, **wirkt
nicht** und zählt mit. In der Verwaltung ist sie als Vormerkung zu sehen.

*Schutz vor falschem Umlernen (§18).* Widerspricht eine Beobachtung einer
bestehenden Regel, bleibt die Regel und es entsteht ein Widerspruch mit Eintrag
im Protokoll. Ein System, das sich durch einzelne fehlerhafte Eingangsdaten
selbst umlernt, ist nach drei Monaten nicht mehr zu gebrauchen.

*Zurücknehmen statt löschen — auch in der Adresse.* `POST …/withdraw` und nicht
`DELETE`: Die Regel bleibt stehen, ihr Zustand ändert sich. Sonst ließe sich
später nicht mehr erklären, warum ein alter Lauf etwas zugeordnet hat.

*Ersetzte Werte werden ausgewiesen.* Ein still ersetzter Wert ist im Ergebnis
nicht mehr von einem zu unterscheiden, der so geliefert wurde — und dann
streiten zwei Leute darüber, ob die Quelle „Frankfurt am Main" geschrieben hat.

**Offen in dieser Etappe:** die Vorschau (SPEC-09 §11) hat ihre Schnittstelle
(`POST /api/mappings/preview`), aber noch keinen eigenen Platz in der
Oberfläche — sie gehört in den Schritt „Daten konsolidieren" des Workflows, und
den gibt es erst mit Etappe 5. Ebenso offen: Zusammenführen und Aufteilen von
Feldern (SPEC-09 §9) sowie Transformationen (SPEC-09 §8).

### Etappe 4 — Regeln und Qualität ✔ gebaut

**Specs:** SPEC-04 §2, §4, §5, §9 · SPEC-08 §5 bis §9.

```
src/domain/quality/Normalisierung.ts       vereinheitlichen, ohne zu deuten
src/domain/quality/Konvertierung.ts        in den Zieltyp — oder als Konflikt
src/domain/quality/Regeln.ts               fachliche Regeln, vier Stufen
src/application/quality/QualityService.ts  die Reihenfolge, der Bericht
src/interface/http/routes/QualityRoutes.ts /api/quality/check, /api/quality/rules
```

*Die Reihenfolge ist keine Geschmacksfrage.* Erst normalisieren, dann
konvertieren, dann prüfen. Andersherum liefe die Prüfung gegen Werte, die noch
ein Leerzeichen tragen, und meldete Fehler, die sie selbst gleich behoben hätte
— ein Test hält genau das fest.

*Normalisierung endet vor der Auslegung.* `" 4711 " → "4711"` ist eine
Schreibweise; `"471l" → "4711"` ist eine Vermutung. Bei der E-Mail wird deshalb
nur der Teil hinter dem `@` kleingeschrieben, und bei `+49 (0) 30 …` bleibt die
Klammer stehen: Ob die Null zur Nummer gehört, hängt an der Landesvorwahl.

*Kürzen ist kein Dienst.* `1.234,56 → Integer` ist ein Konflikt und keine
Rundung. Über 2^53 wird abgebrochen statt gerundet — eine Kundennummer, die
sich beim Einlesen um eins ändert, findet niemand.

*Vier Stufen, und nur eine hält an.* Ein Konflikt trennt **einen** Datensatz ab
und lässt die übrigen laufen (SPEC-08 §8). Jeder Befund nennt **Ursache und
Auswirkung getrennt** — ein einzelnes Textfeld füllt sich mit
„Validierungsfehler in Feld 3".

*Ein fehlendes Pflichtfeld ist eine Feststellung über den Bestand, keine über
jede Zeile* — gefunden durch einen Test. Sonst meldete eine Artikelliste ohne
Kundennummer bei zehntausend Zeilen zehntausendmal dasselbe.

*Das Original bleibt unangetastet.* Ergebnis, Befunde und die Liste der
Veränderungen stehen daneben. Eine Verarbeitung, die die Eingangsdaten
überschreibt, nimmt sich die einzige Möglichkeit, hinterher nachzusehen.

**Sichtbar in:** „Daten finden" → *Qualität prüfen*.

**Nachgeholt in Etappe 5:** Referenzdaten und Referenzabgleich (SPEC-04 §6)
sowie die automatische Ergänzung fehlender Werte aus vergleichbaren Datensätzen
(SPEC-08 §5). Beides setzt voraus, dass mehrere Quellen nebeneinanderliegen.

### Etappe 5 — Mehrere Quellen ✔ gebaut

**Specs:** SPEC-06 · SPEC-02 §26 bis §32 · SPEC-04 §6, §7 und §8 · SPEC-08 §5.

```
src/domain/consolidation/Quellen.ts          Quelle, Datensatz, Datenstand, Blattwahl
src/domain/consolidation/Schluessel.ts       Konsolidierungsschlüssel, Vergleichswert
src/domain/consolidation/Prioritaet.ts       wer gewinnt — und warum
src/domain/consolidation/Zusammenfuehren.ts  feldweise zu einem Datensatz
src/domain/consolidation/Dubletten.ts        wer bleibt, wohin mit den übrigen
src/domain/consolidation/Referenz.ts         Nachschlagen, nur lesend
src/domain/consolidation/Ergaenzung.ts       fehlende Werte aus Nachbarn
src/domain/consolidation/Aehnlichkeit.ts     ähnlich ist nicht gleich
src/application/consolidation/ConsolidationService.ts   der Lauf und sein Bericht
src/interface/http/routes/ConsolidationRoutes.ts        /api/consolidation/preview
web/src/screens/MergeScreen.tsx              der Prüflauf auf dem Bildschirm
```

*Zwei Einstellungen, nicht eine.* `art` sagt, ob Datensätze einer Gruppe
**ineinander** (Merge) oder **nebeneinander** (Append) landen; `betriebsart`
sagt, ob eine Quelle **führt**. Nur beim Anreichern ist ein Datensatz ohne
Bezug zur Hauptdatei ein Konflikt (SPEC-02 §30) — beim Sammeln gibt es keine
Datei, auf die er sich beziehen müsste.

*Der Vergleichswert verlässt sein Modul nicht.* „Müller GmbH", „Mueller GmbH"
und „MÜLLER GMBH" finden über eine gefaltete Form zueinander. Diese Form ist ein
Hilfsmittel und niemals ein Datenwert: Wer sie in den Bestand schreibt, hat aus
einem Firmennamen Kleinbuchstaben gemacht.

*Ein zusammengesetzter Schlüssel wird nicht kürzer, sondern ungültig.* Fehlt ein
Teil, gibt es keinen Schlüssel — ein aus zwei von drei Feldern gebildeter trifft
auf mehr Datensätze zu, als gemeint waren, und niemand sieht es. Getrennt wird
mit einem Steuerzeichen: Mit einem Bindestrich wäre „Meier" + „Hof" derselbe
Schlüssel wie „Meierh" + „of".

*Die Schwelle greift selten, und das ist ihr Zweck.* Ohne konfigurierte Regel
darf Unikom nach der Häufigkeit entscheiden (SPEC-06 §5, SPEC-09 §7) — bei zwei
Quellen mit zwei Werten steht es 1 : 1, bei dreien 2 : 1. Erst weit darüber
werden die 97 % aus SPEC-02 §5 erreicht. Eine Schwelle, die im Alltag ständig
erreicht wird, ist keine.

*Eine eingestellte Priorität gilt — und wird nicht stillschweigend angewendet.*
Spricht ein jüngerer Datenstand dagegen, entsteht **zusätzlich** ein Prüffall
(SPEC-04 §8). Beide anderen Wege wären falsch: sie zu verwerfen übergeht den
erklärten Willen des Benutzers, sie kommentarlos anzuwenden unterschlägt eine
bekannte Gegeninformation. „Unbekannt" ist dabei nicht „älter" — ein Vergleich
ohne beide Zeitpunkte sagt nichts.

*Haupt- und Zusatzdatensatz sind keine Dublette, sondern der Zweck* — gefunden,
weil der erste Bericht den Normalfall als Befund auswies. Doppelt ist, was auf
**derselben Stufe** doppelt ist: beim Sammeln jeder zweite Datensatz der Gruppe,
beim Anreichern ein zweiter Datensatz der Hauptdatei. Mehrere aus derselben
Zusatzdatei sind ein Mehrfachtreffer und haben ihre eigene Regel.

*Verworfen ist nicht verschwunden.* Jede zurückgetretene Dublette steht mit
Quelle, Zeile und Grund im Bericht (SPEC-06 §6).

*Referenzdaten werden nur gelesen* — nicht als Vorsatz, sondern als
eingefrorenes Objekt: Ein Schreibversuch wirft. Ein Treffer darf übernommen
werden, mehrere niemals; und ein vorhandener Wert, der von der Referenz
abweicht, wird nicht überschrieben, sondern vorgelegt.

*Ein Schlüsselfeld wird nicht ergänzt.* Ein ergänzter Schlüssel schöbe den
Datensatz still in eine andere Gruppe. Ergänzt wird nur, wo alle vergleichbaren
Datensätze einig sind und es mindestens zwei davon gibt — ein Einzelfall ist
keine Konsistenz (SPEC-08 §5).

*Der Prüflauf ist dieselbe Rechnung wie der Lauf* und verändert nichts. Eine
Vorschau, die anders rechnet, führt genau die Entscheidungen herbei, die sie
verhindern soll.

*Jeder Konflikt nennt sieben Dinge* (SPEC-06 §10): Quelle, Blatt, Zeile, Feld,
erwarteten und vorgefundenen Zustand, Ursache und nächste Schritte.

#### Fuzzy Matching (SPEC-04 §6 und §7)

*Ähnlichkeit gruppiert nicht.* „Ähnlichkeit allein berechtigt nicht zu einer
automatischen Zusammenführung" — die Suche führt deshalb nichts zusammen,
sondern stellt Fragen. Beide Datensätze bleiben im Ergebnis, daneben steht ein
Prüffall. Das ist der Unterschied zum Vergleichswert: Dort ist „Müller"
**gleich** „Mueller", weil jemand eine Faltungsregel eingerichtet hat; hier ist
„Meier" **ähnlich** „Maier", und das ist eine Beobachtung.

*Gemeldet werden Paare, keine Gruppen.* Aus „A ähnelt B" und „B ähnelt C" folgt
nicht „A ähnelt C" — bei 0,85 kann A zu C beliebig weit weg sein. Drei
Datensätze ergeben drei Fragen.

*Buchstabendreher zählen einmal.* Gemessen wird mit Levenshtein plus Vertauschung
benachbarter Zeichen: „Mülelr" ist von „Müller" eine Änderung entfernt. Ohne
diese Erweiterung fiele der häufigste Tippfehler überhaupt unter die Schwelle,
während ein beliebiger anderer sie hielte.

*Das Minimum, nicht der Durchschnitt.* Bei „Nachname + Vorname + Geburtsdatum"
glättete ein Durchschnitt ein völlig anderes Geburtsdatum mit zwei passenden
Namen — und genau daran erkennt man zwei Personen.

*0,85 ist für kurze Kennungen zu hoch* — gefunden durch einen Test über
Postleitzahlen: Bei fünf Zeichen lässt diese Schwelle rechnerisch **keine
einzige** Änderung zu. Sie steht deshalb an jeder Regel und nicht nur als
Voreinstellung; die Oberfläche rechnet vor, wie viele Abweichungen der gewählte
Wert durchgehen lässt.

*Ein Rundungsfehler saß in einer Zeile, die richtig aussah:* `(1 − 0,8) × 5` ist
in Gleitkomma 0,9999999999999998 und abgerundet null. Seitdem prüft der Aufrufer
`> 0` statt `>= schwelle` — die Schwelle wird an **einer** Stelle geprüft, in
ganzen Änderungen statt in Bruchzahlen.

*Jeder mit jedem hat einen Preis.* Bei 2000 Datensätzen sind es zwei Millionen
Vergleiche. Darüber wird abgebrochen **und gesagt**, dass abgebrochen wurde; ein
Lauf, der eine halbe Stunde rechnet, ohne dass jemand weiß warum, ist schlimmer
als eine Meldung. Eine Längenvorauswahl macht den Rest schnell — sie ist keine
Näherung, sondern eine gültige Abkürzung, und ein Test hält sie gegen die
vollständige Rechnung.

*Die Referenz sagt, was naheliegt, und nimmt es nicht.* „Kein Eintrag" ist
richtig und nutzlos; „kein Eintrag, am nächsten liegt 53111" ist dieselbe
Meldung mit dem nächsten Schritt darin. Übernommen wird trotzdem nichts — ob der
Wert ein Tippfehler oder eine neue Postleitzahl ist, weiß die Referenz nicht.

**Sichtbar in:** „Daten konsolidieren" → *Zusammenführen* → *Ähnliche
Datensätze suchen*.

**Offen in dieser Etappe:** Die Reihenfolge mehrerer Konsolidierungs**schritte**
(SPEC-06 §7) ist mit Etappe 15 gebaut. Die blockweise Verarbeitung großer Mengen
(SPEC-06 §15) ist mit Etappe 11 gebaut, die Wiederherstellung früherer
Ergebnisstände (SPEC-06 §14) mit Etappe 7.

### Etappe 6 — Konflikte ✔ gebaut

**Specs:** SPEC-07 vollständig.

```
src/domain/conflicts/Konfliktfall.ts       UUID, Status, Lebenszyklus
src/domain/conflicts/Historie.ts           nur anfügen, nie ändern
src/domain/conflicts/Entscheidung.ts       was ein Mensch wählen kann
src/domain/conflicts/Sperre.ts             Sperre und Fassung
src/domain/conflicts/Auswahl.ts            suchen, filtern, gruppieren
src/domain/conflicts/Fortschritt.ts        wo jemand stehengeblieben ist
src/application/conflicts/ConflictService.ts             der ganze Ablauf
src/infrastructure/persistence/sqlite/SqliteConflictRepository.ts
src/interface/http/routes/ConflictRoutes.ts
web/src/screens/ConflictScreen.tsx
```

*Der Bestand liegt in der Datenbank, die Dateien sind Ausleitungen.* Konfliktdatei
und Konfliktzieldatei tragen die UUID mit; wird eine nach Frist fortgeräumt,
bleiben Fall, Entscheidungen und Historie. Die Nachvollziehbarkeit hängt nicht an
einer Datei, die irgendwann verschwindet.

*Die Sperre ist kein Status.* Ein Fall ist **offen und gesperrt**, nicht
„gesperrt statt offen" — sonst ginge beim Entsperren verloren, was er vorher war,
und ein abgebrochener Browser hinterließe Fälle in einem Zustand, den keine Regel
mehr verlässt.

*Zwei Sicherungen, weil eine nicht reicht.* Die Sperre verhindert, dass zwei
Leute anfangen, und muss ablaufen können. Genau deshalb reicht sie nicht: Danach
säßen wieder zwei am selben Fall. Die **Fassung** fängt das auf — wer entscheidet,
nennt die Nummer, die er vor sich hatte.

*Die Vorschau ist die Entscheidung ohne Speichern.* Dieselbe Funktion, zwei
Adressen. Ein Schalter `dryRun` im selben Aufruf wäre kürzer und der gefährlichere
Weg: ein `false` statt `true`, und aus einer Ansicht wird eine Entscheidung.

*Fachregeln gelten auch für Menschen.* Wer in ein Ganzzahlfeld `1.234,56` tippt,
bekommt denselben Konflikt wie die Automatik (SPEC-07 §7). Die manuelle
Bearbeitung ist ein anderer Weg zur Entscheidung und kein Weg an den Regeln vorbei.

*Ein Feld ohne Auswahl wird nicht stillschweigend gefüllt.* Das wäre genau die
automatische Entscheidung, die dieser Bildschirm vermeiden soll.

*Der Konflikt trägt seine Werte einzeln* — gefunden, als der erste Testlauf durch
die Schnittstelle keinen Wert zum Auswählen fand. `vorgefunden` liest sich für
einen Menschen; Knöpfe baut man daraus nicht. Etappe 5 gibt die Angebote deshalb
strukturiert mit, statt sie später aus dem eigenen Fließtext zurückzugewinnen.

*Nichts wird überschrieben.* Jede Änderung ist ein Schritt in der Historie, und
die Historie kennt kein `UPDATE` und kein `DELETE` — im Typ nicht und in der
Tabelle nicht. Zwei Schritte mit derselben Nummer scheitern hart am
Primärschlüssel, statt sich gegenseitig zu verlieren.

*Wer entscheidet, kommt aus der Sitzung.* Wäre der Name ein Feld in der Anfrage,
hielte die Historie fest, was jemand behauptet hat — nicht, wer es war.

*Ein Filter blendet kein Hindernis weg.* Die Zahlen zur Freigabe gelten für den
Bestand und nicht für die Ansicht; sonst sähe die Freigabe möglich aus, weil
gerade nur die Warnungen angezeigt werden.

*Bereinigt ist noch nicht fertig.* `OFFEN → BEREINIGT → ERNEUT VERARBEITET →
ERFOLGREICH VERARBEITET`: Erst wenn der Folgelauf durch ist, gilt ein Fall als
erledigt. Entsteht dabei ein neuer Konflikt, ist es ein **neuer Fall mit einem
Faden zum alten** und kein neuer Status am alten.

**Sichtbar in:** „Daten konsolidieren" → *Konflikte*.

**Offen in dieser Etappe:** Die Bereinigung der Ausleitungen nach Aufbewahrungs-
frist (SPEC-07 §5) — sie hängt am Dateimodell der Ausleitungen, und die gibt es
noch nicht. Die Wiederherstellung eines früheren Ergebnisstandes (SPEC-06 §14)
ist mit Etappe 7 gebaut.

### Etappe 7 — Validierung und Freigabe ✔ gebaut

**Specs:** SPEC-08 §10 bis §13 · SPEC-06 §14 · SPEC-01 §14.

```
src/domain/result/Ergebnispruefung.ts   neun Prüfungen auf dem Ergebnis
src/domain/result/Freigabe.ts           darf das hinaus, und warum
src/domain/result/Ergebnisstand.ts      ein Stand je Lauf, keiner wird geändert
src/application/result/ResultService.ts prüfen, beurteilen, freigeben
src/infrastructure/persistence/sqlite/SqliteResultRepository.ts
src/interface/http/routes/ResultRoutes.ts
web/src/screens/ResultScreen.tsx
```

*Ein fehlerfreier Ablauf ist keine Aussage über die Daten.* Genau so sieht ein
Lauf aus, der eine ganze Spalte verloren hat, weil eine Zuordnung nicht mehr
passte. Deshalb neun Prüfungen auf dem **Ergebnis** und nicht auf dem Ablauf.

*Die Abweichung zum Eingang ist die, um derentwillen der Abschnitt existiert.*
Ein Feld, das im Eingang zu 98 % gefüllt war und im Ergebnis zu 12 %, findet
keine Typprüfung — denn die zwölf Prozent sind alle richtig.

*Nur eine Prüfung blockiert: die Vollständigkeit.* Alles andere lässt sich
ansehen und entscheiden; verschwundene Datensätze nicht, denn niemand weiß, was
fehlt. Dafür trägt der Konsolidierungsbericht jetzt eine Liste
`nichtVerarbeitet` — jeder gelesene Datensatz hat einen Verbleib, und ein Test
rechnet es nach.

*Warum es überhaupt eine automatische Freigabe gibt:* Ein geplanter Lauf um zwei
Uhr nachts hat keinen Benutzer, der freigeben könnte. Ohne diese Regel wäre jeder
Nachtlauf am Morgen ein Stapel Arbeit — und nach zwei Wochen klickte jemand alles
ungelesen durch, die schlechteste aller Freigaben.

*Im Vermerk stehen die Bedingungen, die die Freigabe **getragen** haben* — nicht
nur die gescheiterten und schon gar kein Häkchen. Wer in einem Jahr fragt, warum
ein Lauf durchging, findet dort die Antwort.

*Ein Mensch darf über offene Punkte hinweggehen, aber nicht wortlos.* Sonst wäre
die manuelle Freigabe sinnlos — sie kommt gerade dann zum Zug, wenn etwas dagegen
spricht. Über einen blockierenden Fehler geht auch er nicht hinweg: Eine
Begründung wäre dort eine Behauptung über etwas, das niemand gesehen hat.

*Ein nicht freigegebenes Ergebnis ist kein Ergebnis.* `istGueltig` fragt nach dem
**Vermerk** und nicht nach dem Status: Ein Lauf kann technisch `COMPLETED` heißen
und trotzdem warten.

*Wiederherstellen heißt kopieren, nicht zurückspulen* (SPEC-06 §14). Es entsteht
ein neuer Stand mit Verweis auf den alten; der alte bleibt, und der verworfene
dazwischen auch — sonst verschwände aus der Geschichte, dass jemand zurückgehen
musste, und das ist meist die interessanteste Zeile darin.

**Sichtbar in:** „Daten konsolidieren" → *Ergebnis*.

*Die Übergabe an Modul 3 ist die einzige Tür* (`GET /api/results/:id/handover`).
In fremde Datenbanken schreibt ausschließlich Modul 3, und der endgültige Export
ebenso — Modul 2 endet beim freigegebenen Ergebnisstand. Die Prüfung steht dabei
auf **dieser** Seite: Wer die Zusage von der Seite abhängig macht, die sie
einhalten soll, hat keine Zusage. Ein Test liest den Quelltext von Modul 2 und
schlägt an, sobald dort etwas auftaucht, das schreiben könnte (siehe
Entscheidungsprotokoll, Runde 3).

**Offen in dieser Etappe:** nichts. Die Zieldatei selbst schreibt Modul 3.

### Etappe 8 — Hintergrundbetrieb ✔ gebaut

**Specs:** SPEC-01 §13, §15, §17 bis §22 · SPEC-02 §49 bis §52.

```
src/worker.ts                                    der eigenständige Prozess
src/domain/background/Heartbeat.ts               Lebenszeichen und Frist
src/domain/background/Benachrichtigung.ts        drei Stufen, vier Kanäle
src/domain/background/Prozessrollen.ts           wer schreibt was
src/application/background/BackgroundService.ts  Abbrucherkennung, Meldungen
src/interface/http/EventStream.ts                SSE aus dem Bestand
src/interface/http/routes/BackgroundRoutes.ts    Prozesse und Meldungen
web/src/components/Meldungen.tsx                 das Benachrichtigungscenter
```

*Beide Prozesse schreiben in dieselbe Datenbank.* Die Vorbedingung ist damit
entschieden (Entscheidungsprotokoll, Runde 5). „Nur der Server schreibt" wäre
die aufgeräumtere Zeichnung und die schlechtere Lösung: Der Worker schreibt am
laufenden Band, und ginge das über den Server, hinge die nächtliche
Verarbeitung an dessen Verfügbarkeit — genau das schließt SPEC-01 §13 aus. Die
eine Regel, die dafür gelten muss: **keine Transaktion über eine Wartezeit
hinweg.**

*Der Prozess, der den Fehler eintragen müsste, ist der verschwundene.* Ein Lauf,
dem der Strom ausging, kann sich nicht selbst auf `FAILED` setzen. Deshalb
schreibt der Worker ein Lebenszeichen, und **ein anderer** liest es. Geprüft
wird nicht, *ob* sich jemand für den Lauf gemeldet hat, sondern ob die Meldung
noch frisch ist — sonst rettete das letzte Lebenszeichen eines gestorbenen
Workers genau den Lauf, an dem er starb.

*Die Frist ist großzügig, und das mit Absicht.* Vier Schläge: Ein Worker, der
eine große Datei entschlüsselt, schreibt eine Weile nichts. Ihn dafür für tot zu
erklären, während er weiterarbeitet, wäre der schlimmere Fehler — danach stünden
zwei Wahrheiten über denselben Lauf im Bestand.

*Ein ordentliches Ende räumt sein Lebenszeichen fort.* Genau daran erkennt der
andere Prozess, dass es kein Absturz war; ohne diesen Abschied sähe jeder
geplante Neustart aus wie ein Abbruch.

*Eine erfolgreiche Verarbeitung meldet sich im Center und sonst nirgends*
(SPEC-01 §21). Wer jeden Erfolg als Popup bekommt, klickt auch das
Konfliktfenster weg, ohne es gelesen zu haben. Die Kanäletabelle kommt vom
Server und steht nicht zweimal geschrieben da.

*Gesehen und bestätigt sind zweierlei.* Ein geschlossenes Popup ist gesehen;
erledigt ist ein Fall erst, wenn jemand es sagt. Der erste Bestätiger bleibt der,
der im Bestand steht.

*SSE liest aus dem Bestand, statt gemeldet zu werden.* Die Ereignisse entstehen
im Worker, angezeigt werden sie vom Server — ein Meldeweg dazwischen wäre ein
weiterer Bestandteil, der ausfallen kann. Der Preis sind zwei Sekunden
Verzögerung; der Gewinn ist, dass es keine zweite Wahrheit gibt: Was auf dem
Bildschirm steht, stand vorher in der Datenbank, nie umgekehrt.

*Der Strom meldet nur Unterschiede.* Beim ersten Blick wird gemerkt, nicht
gemeldet — sonst wären beim Öffnen der Seite alle Läufe der letzten Woche
„gerade gestartet" und jede offene Meldung frisch.

**Sichtbar in:** der Glocke im Kopf, auf jedem Bildschirm.

**Die drei offenen Punkte dieser Etappe sind erledigt** (20.08.2026) — siehe
Etappe 9.

---

# Etappe 9 — Die Kette schließt sich ✔ gebaut

Drei Punkte standen offen, und der dritte war der, an dem die anderen acht
Etappen hingen.

## 1. Die Konsolidierung läuft im Worker

**Gebaut:** `application/workflow/WorkflowExecutionService.ts`,
`application/workflow/Eingang.ts`, `application/workflow/Dateiablage.ts`,
`infrastructure/filesystem/NodeDateiablage.ts`,
`infrastructure/formats/CsvSchreiben.ts`,
`domain/transfer/Konsolidierungsschritt.ts`.

```text
Daten übertragen  →  Daten konsolidieren  →  Ergebnisstand
     Modul 1               Modul 2             in der Datenbank
```

**Der Dienst legt sich um die Übertragung, statt sie zu ersetzen.** Er ruft sie
auf, sieht sich an, was sie gebracht hat, und macht damit weiter. Zeitplan,
Doppellaufsperre, Lauf-Eintrag und Historie bleiben, wo sie waren — der
Orchestrator weiß von der Konsolidierung nichts.

**Ein Workflow trägt jetzt seine Regeln.** Bis hierher sagte der
Konsolidierungsschritt nur „eingeschaltet"; das ließ sich anzeigen und nicht
ausführen. Ein Lauf um drei Uhr nachts hat keinen Menschen, den er fragen kann,
also steht am Schritt, was er tun soll. **Nicht** dort stehen die
Mindestkonfidenz — die kommt aus der Hierarchie, und wer sie am Workflow senken
dürfte, könnte sich eine automatische Entscheidung bestellen, die im Prüflauf
noch ein Konflikt war — und die Referenzbestände: eine Datenmenge gehört nicht
in einen Workflow kopiert.

**Am vorangehenden Schritt gelten die Dateien dieses Laufs**, nicht der Inhalt
des Zielverzeichnisses. Dort liegen auch die von gestern, und sie jede Nacht
mitzunehmen ergäbe ein Ergebnis, das um einen Tag zu groß ist — und das sähe man
ihm nicht an.

**Die Ergebnisdatei entsteht nur aus einem freigegebenen Stand.** Ein Ergebnis,
das auf eine Entscheidung wartet, darf nicht schon im Verzeichnis liegen: Von
dort holt es der Nächste ab, und die Freigabe wäre eine Formalität über etwas,
das längst unterwegs ist.

**Was hier schiefgeht, wird ein Lauf mit Begründung** und eine kritische
Meldung — keine Ausnahme, die der Orchestrator zu „fehlgeschlagen" ohne Text
macht. Genau diese Textlosigkeit macht Ferndiagnose unmöglich.

**Die Sperre in der Übertragung ist gefallen.** `unbuiltStages` hielt jeden
Workflow mit eingeschaltetem Konsolidierungsschritt an — richtig, solange es die
Maschine nicht gab. Jetzt steht dort nur noch das Ausliefern. Und ein Workflow
ohne Übertragungsschritt endet nicht mehr im Fehler, sondern in
`SUCCESS_NO_FILES`: „Konsolidiere die Datei, die schon in Verzeichnis X liegt"
ist ein vollständiger Workflow und kein Rumpf.

## 2. Der E-Mail-Kanal

**Gebaut:** `domain/background/Postausgang.ts`,
`infrastructure/mail/SmtpPostbote.ts`, `application/background/Postfach.ts`,
Einstellungen am Mandanten.

SMTP von Hand, sieben Befehle. Eine Fremdbibliothek wäre bequemer gewesen und
wäre eine Abhängigkeit mehr, die im Haus des Kunden eingespielt, geprüft und
aktualisiert werden muss.

**Der Bestand ist die Wahrheit, der Versand eine Zustellung, die scheitern
darf.** Ein Postfach, das nicht antwortet, hält keine Verarbeitung an und
verliert keine Meldung — was misslingt, steht mit seinem Grund im Protokoll.

**Ein Erfolg geht nur hinaus, wenn ihn jemand bestellt hat.** Wer jede Nacht
eine Erfolgsmeldung bekommt, richtet sich eine Regel im Posteingang ein — und
sieht danach auch die kritische nicht mehr.

**Das Kennwort steht in einem Zugang, nicht in den Einstellungen** — und in
keiner Fehlermeldung: Nach `AUTH LOGIN` sind die nächsten Zeilen Benutzer und
Kennwort in Base64, und Protokolle werden mit Kunden geteilt.

**Die Einstellung hängt am Mandanten.** Empfänger sind je Kunde verschieden, und
bei einem Dienstleister ist es auch der Server.

## 3. Der Notification Agent

**Gebaut:** `domain/background/Desktopmeldung.ts`, `src/agent.ts`
(`npm run agent`), dazu das Popup, das sich in der Oberfläche von selbst zeigt.

```text
npm run serve    Oberfläche, HTTP
npm run worker   Läufe, Meldungen entstehen
npm run agent    Meldungen erscheinen auf dem Bildschirm
```

**Warum ein dritter Prozess:** Ein Windows-Dienst läuft in Sitzung 0, und
Sitzung 0 hat keinen Bildschirm. Der Worker **kann** keine Blase zeigen, gleich
wie er programmiert ist. Das ist der ganze Grund, und deshalb steht in SPEC-01
„läuft in der Benutzer-Session".

**Er liest die Datenbank und fragt nicht den Server.** Über HTTP zu fragen hieße,
eine Anmeldung ohne Benutzer zu erfinden: ein Dauertoken, das auf der Platte
liegt und nie abläuft.

**Der Meldungstext geht nie über die Befehlszeile.** In einem Titel steht ein
Workflowname, den ein Mensch getippt hat; in einer PowerShell-Zeile wäre das die
Erlaubnis, beliebige Befehle auszuführen. Er geht als Base64 durch eine
Umgebungsvariable, und das Skript ist eine Konstante ohne eine einzige
eingesetzte Stelle.

**Der Agent setzt gesehen und niemals bestätigt.** Eine Blase, die eine Meldung
abhaken würde, wäre die zuverlässigste Art, einen Konfliktbestand zu verlieren:
Sie erscheint, wenn niemand am Platz ist, und verschwindet nach fünf Sekunden
von selbst.

**Die drei offenen Punkte dieser Etappe sind erledigt** (20.08.2026) — siehe
Etappe 10.

---

# Etappe 10 — Die Ränder ✔ gebaut

## 1. Das Fenster nach vorn

**Gebaut:** `vordergrundBefehl` in `domain/background/Desktopmeldung.ts`, im
Agenten hinter der Blase.

Eine Webseite kann sich nicht selbst nach vorn holen; kein Browser erlaubt das,
und aus gutem Grund. Es geht nur von außen — aus dem Prozess, der ohnehin schon
in der Sitzung des Benutzers läuft.

**Nach der Blase und nicht davor.** Die Blase ist der Teil, der immer gelingt;
sie erst zu zeigen, nachdem ein Fenster gefunden wurde, hieße, sie bei einem
geschlossenen Browser zu verlieren.

**Findet sich kein Fenster, geschieht nichts** — ausdrücklich kein Öffnen eines
neuen. Der Agent liefe sonst nachts um drei auf einem Rechner, an dem niemand
sitzt, und öffnete Browser. Wer nicht hinsieht, wird über die Blase und die
E-Mail erreicht. „Kein Fenster" ist deshalb ein eigener Rückgabewert und kein
Fehler: Sonst stünde jede Nacht ein Fehler im Protokoll, und der eine echte
ginge darin unter.

**Der Titel wird wörtlich gesucht** (`Contains`, nicht `-like`). Mit einem
Suchmuster holte ein Sternchen im Fenstertitel irgendein Fenster nach vorn.

**Nur die beiden dringenden Stufen.** Bei „Information" steht in der Tabelle ein
Nein, und das ist keine Nachlässigkeit: Ein Fenster, das sich vordrängt, während
jemand tippt, ist eine Zumutung.

## 2. Erwartete Verarbeitung nicht erfolgt

**Gebaut:** `domain/scheduling/Ausbleiben.ts`,
`BackgroundService.meldeAusbleiben`, angeschlossen an jeden Tick des Laufs.

**Die einzige Meldung, die aus einem Nicht-Ereignis entsteht** — und deshalb die
schwerste: Ein Lauf, der fehlschlägt, meldet sich. Ein Lauf, der gar nicht erst
anfängt, meldet gar nichts, und niemand vermisst um drei Uhr nachts eine
Nachricht, die nie kam.

**Zuerst nachsehen, dann arbeiten.** Der Tick holt versäumte Termine gleich
darauf nach und stellt `nextExecutionAt` weiter. Danach wäre die Spur fort, und
ein Ausfall der ganzen Nacht sähe aus wie ein Lauf, der ein bisschen spät war.

**Ein Termin meldet sich einmal.** Solange etwas das Nachholen verhindert — eine
abgelaufene Lizenz —, sieht jeder Tick denselben versäumten Termin. Zwölf
gleiche Meldungen pro Stunde sind der Grund, warum jemand die Glocke nicht mehr
ansieht. Das Gedächtnis liegt im Arbeitsspeicher: Nach einem Neustart weiß
niemand, ob die erste Meldung jemanden erreicht hat.

**Ein Fehler der Wache hält den Zeitplan nicht auf.** Sie zum Anlass zu nehmen,
auch die übrigen Läufe ausfallen zu lassen, wäre grotesk.

**Der Zeitpunkt steht in der Zeitzone des Zeitplans**, nicht in UTC und nicht in
der des Servers. Ein Nachtlauf um 02:00 in Berlin steht als `00:00Z` im Bestand;
wer das um acht Uhr morgens liest, sucht nach einem Lauf um Mitternacht.

## 3. Die feineren Regeln am Workflow

**Gebaut:** Prioritäten, Ergänzung, Ähnlichkeitssuche und Mehrfachtreffer im
Workflow-Editor; die Maschine dahinter stand seit Etappe 5.

**Was im Workflow steht, sind Dateinamen; im Auftrag stehen Quellenkennungen.**
Bei einer CSV dasselbe, bei einem Blatt einer Arbeitsmappe nicht
(`Filialen.xlsx#Nord`). Ohne Übersetzung liefe jede Rangfolge, die auf eine
Mappe zeigt, ins Leere — und zwar stillschweigend: Eine Quelle, die in keiner
Reihenfolge vorkommt, ist einfach die letzte.

**Die Mindestkonfidenz ist am Workflow nicht mehr darstellbar.** Sie steht als
`Omit` aus dem Regeltyp heraus und wird auch dann verworfen, wenn ein von Hand
bearbeiteter Datensatz sie trägt: Wer sie senken dürfte, könnte sich eine
automatische Entscheidung bestellen, die im Prüflauf noch ein Konflikt war.

**Referenzbestände bleiben draußen.** Ein Referenzbestand ist eine Datenmenge
und keine Einstellung; ihn in jeden Workflow zu kopieren ergäbe so viele Stände
wie Workflows, und beim nächsten Umzug wüsste niemand, welcher gilt.

**Offen in dieser Etappe:** siehe Etappe 11.

---

# Etappe 11 — Mengen und Einstellungen ✔ gebaut

Drei Dinge, von denen zwei aus einer **Messung** kamen und nicht aus einer
Vermutung.

## 1. Die Ebene, die gewinnt, war nicht erreichbar

```text
ALLGEMEIN  ──▶  PROFIL  ──▶  MANDANT      ← gewinnt
                                 ↑
                        schrieb niemand
```

`Tenant.consolidation` wurde an neun Stellen **gelesen** und nirgends
geschrieben: keine Route, kein Dienst, kein Bildschirm. Die Spitze der
Hierarchie war damit immer leer, und es galt überall die Voreinstellung.

Praktisch hieß das: Ein Kunde, dessen Dateien `keine Angabe` für „leer"
schreiben, konnte das nicht hinterlegen. Der Wert zählte als Inhalt, landete im
Ergebnis und ließ die Vollständigkeitsprüfung bestehen, wo sie hätte anschlagen
müssen.

**Gebaut:** `domain/consolidation/Einstellungspruefung.ts`, Route und Dienst am
Mandanten, ein Bereich im Mandantenformular.

**Geprüft wird, bevor gespeichert wird — und alles auf einmal.** Ein Zahlendreher
hier wirkt auf jeden Lauf jedes Workflows dieses Kunden, und er fällt nicht auf:
Eine Stichprobe von drei liefert Typen, nur eben geratene. Halb gespeichert wäre
schlimmer als gar nicht — dann stünde der neue Name im Bestand und die alte
Stichprobe daneben.

**Die Vorschläge in den leeren Feldern kommen vom Server.** Eine zweite Abschrift
der Voreinstellungen wäre an einer Stelle irgendwann veraltet, und dann zeigte
das Formular etwas anderes, als der Lauf verwendet.

**Eine gesenkte Mindestkonfidenz lockert nur die Typerkennung.** Ob Unikom einen
Wertekonflikt selbst entscheiden darf, bleibt bei 0,97 — gleich, was dort steht.

## 2. Was der Speicher wirklich kostet

Gemessen statt geschätzt, zwei Quellen, MERGE über einen Schlüssel, acht Felder:

```text
   20.000 Datensätze     60 MB     1,1 s
  100.000 Datensätze    266 MB     2,9 s
  600.000 Datensätze  1.317 MB    25   s
1.200.000 Datensätze  2.431 MB    75   s
```

**Rund zwei Kilobyte je Datensatz, und die Zeit wächst schneller als die Menge.**
Auf einem Server mit 8 GB, auf dem auch eine Datenbank läuft, ist bei etwa einer
Million Schluss.

Die zweite Messung war die überraschende — sie zeigte, **wo** der Speicher
hingeht:

```text
Quellen (roher Text)         112 MB
+ Datensätze (Map je Satz)   230 MB
+ fertiger Bericht           793 MB   ← 563 MB allein für den Bericht
```

Darin: 600 000 Feldbegründungen für 225 000 Ergebniszeilen — je ein deutscher
Satz, und fast alle lauteten sinngemäß „alle Quellen liefern denselben Wert".

**Einen Wert zu nehmen, den alle anbieten, ist keine Entscheidung, sondern eine
Abschrift.** Der Filter dafür stand längst da, traf aber nicht, was er meinte:
Bei Einigkeit stehen die übrigen Quellen mit **demselben** Wert in `uebergangen`,
und damit ging jede Abschrift als Entscheidung durch. Jetzt entscheidet
`wurdeAbgewogen` — und der Bericht schrumpfte von 563 auf 309 MB, ohne dass eine
einzige echte Begründung verlorenging.

**Und eine Schranke davor.** `domain/consolidation/Menge.ts`: Ein Lauf über mehr
Datensätze, als diese Installation trägt, bricht mit Begründung ab, statt am
Speicher zu sterben. Ein Prozess, dem unterwegs der Speicher ausgeht,
verschwindet **ohne Protokolleintrag** — erkannt wird er dann von der
Herzschlagüberwachung, die sagen kann, dass er fort ist, aber nicht warum. Die
Grenze hängt an der Installation (`UNIKOM_HOECHSTMENGE`), nicht am Mandanten:
Sie beschreibt den Rechner, und zwei Mandanten auf derselben Maschine teilen
sich denselben Arbeitsspeicher.

## 3. Blockweise Verarbeitung (SPEC-06 §15)

**Gebaut:** `domain/consolidation/Blockplan.ts`,
`domain/consolidation/Zwischenstand.ts`,
`application/consolidation/BlockweiseKonsolidierung.ts`, Tabelle
`consolidation_blocks`.

```text
Plan          wie viele Schritte, wie groß
Aufteilen     jeder Schlüssel in genau einen Schritt
je Schritt    konsolidieren → Zwischenstand speichern → Fortschritt melden
am Ende       Teilberichte zu einem Bericht zusammenfassen
```

**Der Schlüssel bestimmt den Block, nicht die Reihenfolge.** Nach den ersten
150 000 Zeilen zu schneiden wäre naheliegend und falsch: Ein Kunde mit Sätzen in
Block 1 und Block 4 würde zweimal verarbeitet und käme zweimal ins Ergebnis.

**Die Streuung ist fest verdrahtet** (FNV-1a) und ausdrücklich keine eingebaute:
Ein fortgesetzter Lauf muss dieselbe Aufteilung wiederfinden, sonst wäre der
Zwischenstand von Block 2 beim nächsten Mal der von etwas anderem.

**Die Zeilennummern gehen mit.** Ein Block enthält nur einen Teil der Zeilen;
ohne die ursprünglichen Nummern zeigte jede Herkunftsangabe auf die falsche
Zeile — plausibel aussehend und falsch.

**Der Normalfall bleibt unberührt.** Bei einem Block läuft genau der Weg von
vorher: kein Aufteilen, kein Zwischenstand, kein Zusammenfassen.

**Was ein Block nicht sehen kann**, steht im Bericht: Ergänzung und
Ähnlichkeitssuche sehen nur den eigenen Schritt und finden weniger als ein Lauf
in einem Zug. Stillschweigend eingeschränkt wäre das ein Ergebnis, dem niemand
ansieht, dass etwas fehlt.

### Was die blockweise Verarbeitung **nicht** leistet

Gemessen, mit dem Bestand auf der Platte:

```text
in einem Zug   112 → 448 MB
blockweise     112 → 606 MB   (Spitze während der Schritte 481 MB)
```

**Der Spitzenspeicher sinkt nicht.** Der Grund steht oben: Der zusammengefasste
Bericht ist der Brocken, und der entsteht so oder so vollständig im
Arbeitsspeicher. Was die Aufteilung bringt, sind die drei anderen Zusagen aus
SPEC-06 §15 — abgegrenzte Schritte, gespeicherte Zwischenstände, Fortschritt und
Fortsetzbarkeit —, nicht die vierte.

Der erste Anlauf war sogar **teurer** als der Lauf in einem Zug: Alle
Teilberichte wurden auf einmal gelesen und dann zusammengefasst, lagen also
doppelt da. Der Bestand trennt deshalb jetzt Auskunft von Inhalt: Welche
Schritte vorliegen, beantwortet eine Abfrage ohne die Berichte; die Berichte
kommen einzeln.

**Offen in dieser Etappe:** Damit der Spitzenspeicher wirklich sinkt, müsste das
**Ergebnis** den Arbeitsspeicher verlassen — der Ergebnisstand hält heute alle
Zeilen in einem JSON-Feld, und die Oberfläche zeigt sie daraus an. Das ist ein
eigenes Stück Arbeit am Ergebnisbestand, an der Anzeige und an der Übergabe zu
Modul 3.

---

# Etappe 12 — Transformationen und Felder ✔ gebaut

SPEC-09, Abschnitt 8 und 9. Das Mapping konnte bis hierher nur **umbenennen** —
und das ist das Erste, wonach ein Kunde im Erstgespräch fragt: „Vorname" und
„Nachname" sind bei uns ein Feld, bei Ihnen zwei.

**Gebaut:** `domain/mapping/Umformung.ts`,
`application/mapping/Umformungslauf.ts`, der Plan am Konsolidierungsschritt, ein
Bereich im Workflow-Editor.

```text
1. Felder putzen      trimmen, Schreibweise, Datum, Zahl
2. Aufteilen          ein Feld wird mehrere
3. Zusammenführen     mehrere Felder werden eines
```

## Vorher und nicht nachher

Ein Schlüssel über „ Meier" und „Meier" findet zwei Kunden, wo einer ist — und
die Zusammenführung, die das hätte heilen sollen, findet dann gar nicht erst
statt. Deshalb läuft die Umformung **vor** dem Konsolidieren.

Die Reihenfolge der drei Schritte steht fest und ist nicht einstellbar: Geputzt
wird zuerst, weil ein Wert mit Leerzeichen am Rand sich anders teilt als einer
ohne; aufgeteilt vor dem Zusammenführen, weil ein Zusammenführen die eben
entstandenen Felder benutzen können soll. Eine freie Reihenfolge verlangte von
jedem eine Entscheidung über etwas, das nur eine sinnvolle Antwort hat.

## Die Zusage, um die es geht

„Bei Transformationen dürfen keine Quellinformationen unbeabsichtigt verloren
gehen." Daraus folgt alles Weitere:

**Es wird nie abgeschnitten.** Zerfällt „Bert von der Heide" in vier Teile und
gibt es zwei Zielfelder, wird der Fall **vorgelegt** und nichts übernommen. Wer
den Rest im letzten Feld will, stellt das ausdrücklich ein. Abgeschnitten sähe
das Ergebnis untadelig aus, und der Kunde hieße von da an anders.

**Was sich nicht umformen lässt, bleibt stehen.** Ein Datum, das kein Datum ist,
wird nicht zu einem leeren Feld — ausgerechnet die Zeile, die nicht ins Schema
passt, ist die interessante.

**Ein leeres Feld bleibt leer.** `VORANSTELLEN` fasst es nicht an; sonst würde
aus einem leeren Feld eines, das „Herr " enthält, und die
Vollständigkeitsprüfung zählte es als gefüllt. Und ein leerer Teil zieht beim
Zusammenführen keinen Trenner nach sich — „ Meier" mit führendem Leerzeichen ist
für jede Gruppierung ein anderer Wert.

**Ein Prüffall ist ein Konflikt und kein Nebensatz.** Er landet in der
Konfliktbearbeitung, hält die Freigabe auf und trägt dieselben Felder wie jeder
andere. Ein Prüffall, der nur im Protokoll steht, wird niemandem vorgelegt.

## Nichts geschieht eigenmächtig

„Mehrdeutige oder nicht ausreichend begründbare Transformationen dürfen nicht
eigenmächtig angewendet werden." Es gibt deshalb **keine** Erkennung, die von
selbst entscheidet, dass eine Spalte „Name" aus Vor- und Nachname besteht. Was
läuft, ist eingestellt.

Aus demselben Grund sucht `ERSETZEN` **wörtlich** und nicht als Muster: Wer „."
eingibt, meint einen Punkt, und niemand rechnet damit, dass sein Ersetzen jedes
Zeichen trifft.

## Was am echten Lauf herauskam

```text
Kunden.csv: 3 Wert(e) in „name" umgeformt
Kunden.csv: „name" in nachname, vorname aufgeteilt (3 Zeile(n))
Kunden.csv: strasse + ort zu „anschrift" zusammengeführt (3 Zeile(n))

4711 | Meier              | Anna | Hauptstr. 1, Bonn
4712 | Schulz             | Bert | Bahnhofstr. 2, Köln
4713 | Von Der Heide Carl |      | Ring 3, Ulm
```

Die dritte Zeile zeigt zweierlei ehrlich: Ohne Komma zerfällt sie nicht, also
steht alles im ersten Zielfeld — kein Prüffall, denn verloren ging nichts.

## Die Vorschau (SPEC-09, Abschnitt 11)

**Gebaut:** `application/workflow/Umformungsvorschau.ts`,
`POST /api/consolidation/transform-preview`, ein Bereich im
Konsolidierungsschritt des Editors.

```text
DATEI Kunden.csv — 3 von 4 Zeilen
FELDER kdnr | name * | strasse | ort | nachname (neu) | vorname (neu) | anschrift (neu)
  Zeile 1: „meier, anna"        → nachname „Meier",  vorname „Anna"
  Zeile 2: „SCHULZ, BERT"       → nachname „Schulz", vorname „Bert"
  Zeile 3: „Bert von der Heide" → nachname „Bert Von Der Heide", vorname „"
```

**Die Vorschau ist der Lauf, nur ohne Folgen.** Sie liest mit demselben Leser,
formt mit derselben Maschine und bricht an denselben Stellen ab. Eine Vorschau,
die anders rechnet als der Lauf, führt genau die Entscheidungen herbei, die sie
verhindern soll: Jemand sieht ein sauberes Ergebnis, schaltet den Workflow
scharf, und nachts kommt etwas anderes heraus.

**Gerechnet wird über die ganze Datei, gezeigt wird der Anfang.** SPEC-09,
Abschnitt 11, nennt „mögliche Datenverluste" ausdrücklich — und der Prüffall
steckt selten in Zeile drei. Eine Aufteilung, die bei neunzehn von zwanzig
Zeilen aufgeht, sähe ohne diese Rechnung vollkommen in Ordnung aus.

**Der Server liest die Datei, nicht der Browser.** Sie liegt im Verzeichnis, das
der Workflow benutzt. Eine hochgeladene Kopie hätte mit der nächtlich
verarbeiteten nur den Namen gemein.

**Dieselbe Mandantengrenze wie überall.** Eine Vorschau liest nur — und wäre
damit der bequemste Weg in den Ordner eines anderen Mandanten.

**Und was der Leser anmerkt, steht dabei.** Bei lauter Textspalten kann er die
Kopfzeile nicht von den Daten unterscheiden und sagt es. Wer diese Anmerkung
erst im Nachtlauf liest, hat den Workflow längst scharf geschaltet.

## Namenspartikel ✔ nachgetragen

„Wortanfänge groß" machte aus „Bert von der Heide" ein „Bert Von Der Heide". Das
ist kein Name, den jemand so schreibt.

```text
BERT VON DER HEIDE    →  Bert von der Heide
anna van den berg     →  Anna van den Berg
LUDWIG VAN BEETHOVEN  →  Ludwig van Beethoven
```

`NAMENSPARTIKEL` deckt das Deutsche und seine Nachbarn ab (von, van, de, der,
du, di, zu, la …). **Steht ein Partikel allein, wird es groß** — ein Feld, in
dem nur „von" steht, ist kein Name mit Vorsatz, sondern ein Wert für sich.

Die Liste ist eine Voreinstellung und keine Wahrheit. Sie ist an jedem Schritt
austauschbar, und ein Häkchen im Editor schaltet sie ganz ab — für Felder, in
denen keine Namen stehen und jedes Wort groß gehört.

**Sie ist auch nicht überall richtig,** und das steht dabei: Im Niederländischen
wird das Tussenvoegsel groß geschrieben, sobald der Vorname fehlt („van der
Berg, Anna" gegenüber „Van der Berg"). Das hängt am Zusammenhang und nicht am
Wort; eine Regel, die es erriete, läge bei jedem zweiten Datensatz daneben.

**Offen in dieser Etappe:**

1. **Vorschläge** (SPEC-09 §8, §9: „soll möglichst automatisch"). Der Platz
   dafür ist jetzt da: die Vorschau.

   **Die naheliegende Regel ist falsch.** „Eine Spalte, deren Werte durchweg ein
   Komma tragen, ist ein Kandidat fürs Aufteilen" — das trifft jede Zahlenspalte,
   die nicht in der Region des Mandanten geschrieben ist. Gemessen an
   `recogniseField`:

   | Spalte | unter de-DE | unter en-US |
   | --- | --- | --- |
   | `1,234` `12,345` (US-Ganzzahl) | `DECIMAL` | `INTEGER` |
   | `1,234.56` `12,345.67` (US-Dezimal) | **`STRING`** | `DECIMAL` |
   | `1.234,56` `12.345,67` (DE-Dezimal) | `DECIMAL` | **`STRING`** |
   | `meier, anna` `schulz, bert` | `STRING` | `STRING` |

   **Beim erkannten Feldtyp anzufangen genügt darum nicht.** Eine amerikanische
   Betragsspalte landet unter deutscher Region in derselben Schublade wie
   „meier, anna": `STRING`. Jede Regel, die auf „`STRING` und Komma" zeigt,
   schlägt vor, Beträge in Vor- und Nachnamen zu zerlegen — und erzieht dazu,
   Vorschläge wegzuklicken. Umgekehrt gilt dasselbe: `1.234,56` unter en-US.

   **Die Zeile mit dem Tausendertrennzeichen ist zugleich das Gegenmittel.**
   Bevor eine `STRING`-Spalte als Kandidat gilt, wird sie gegen die **fremden**
   Trennzeichensätze gelesen (`separatorsOf` gibt sie zu jeder Region her). Geht
   sie dort durchweg als Zahl auf, ist sie kein Fall fürs Aufteilen, sondern ein
   Hinweis auf die falsch eingestellte Region — und das ist der weit nützlichere
   Vorschlag. Dieselbe Prüfung, die den falschen Vorschlag verhindert, erzeugt
   den richtigen.

   **Zeile eins bleibt als eigene Warnung stehen.** `1,234` ist unter de-DE eine
   gültige Zahl und wird als 1,234 gelesen statt als 1234. Der falsche Vorschlag
   ist damit abgewendet, der Wert aber um den Faktor tausend daneben — und zwar
   geräuschlos, weil eine ganze Spalte davon wie saubere deutsche Dezimalzahlen
   aussieht. Das ist die Mehrdeutigkeit aus „Was zuerst weh tut", Punkt 1; sie
   entscheidet sich an der Region und nirgends sonst.

2. **Die Zuordnungsvorschau** — mit Etappe 13 gebaut.

---

---

# Etappe 13 — Die Zuordnungsvorschau ✔ gebaut

**Specs:** SPEC-09 §11 · SPEC-02 §15, §16.

Die erste von fünf Etappen, nach denen die Konsolidierung **als eigenes Modul**
steht — also ohne Modul 3 zu betreiben ist.

## Die andere Frage an dieselbe Datei

```text
Umformungsvorschau    Was geschieht mit den WERTEN?
                      „meier, anna"  →  „Meier" + „Anna"

Zuordnungsvorschau    Welchem internen Feld entspricht die SPALTE?
                      „Kd-Nr.", „KdNr", „Kundennummer"  →  Kundennummer
```

**Gebaut:** `application/workflow/Zuordnungsvorschau.ts`,
`POST /api/consolidation/mapping-preview`, ein Bereich im
Konsolidierungsschritt des Editors — über der Feldvorbereitung, weil die Frage
„welche Spalte ist das?" vor der Frage „was mache ich mit dem Wert?" kommt.

```text
DATEI Kunden.csv — 3 Spalten, 2 Zeilen
  Kundennr   4711 · 4712    →  Kundennummer      [sicher]
  E-Mail     anna@… · b…    →  E-Mail-Adresse    [sicher]
  Bemerkung  Stammkunde     →  — keins —         [offen]
```

## Warum es diesen Bildschirm geben musste

Die Erkennung gibt es seit Etappe 3. Sie ordnet zu, sie begründet, sie stuft
Mehrdeutiges zurück — **gesehen hat sie nie jemand.** Ohne Bildschirm kann
niemand eine falsche Vermutung berichtigen und keine unsichere bestätigen, und
ohne Bestätigung entsteht keine dauerhafte Regel (SPEC-02, Abschnitt 15). Eine
Erkennung, die niemand korrigieren kann, lernt nichts: Derselbe Lieferant wird
beim tausendsten Mal genauso gefragt wie beim ersten.

Der Weg dahin ist mit einem Test über die Naht festgenagelt: Vorschau →
`POST /api/mappings` → Vorschau. Vorher „unbekannt", nachher „Regel".

## Zwei Schritte bis zur Regel

Auswählen und dann **Merken**. Eine Auswahl, die sofort eine Regel schriebe,
wäre bequemer und ginge beim Verrutschen still in den Bestand — wo sie ab da
jede Erkennung schlägt. Der zusätzliche Klick ist der Unterschied zwischen einer
Entscheidung und einem Versehen.

Ebenso trennt die Anzeige **„sicher"** von **„Regel"**: Sicher heißt, die
Erkennung ist sich einig und wendet es für diesen Lauf an; Regel heißt, ein
Mensch hat entschieden, und es gilt dauerhaft.

## Beide Vorschauen zeigen dieselbe Datei

Die Dateiwahl liegt jetzt an einer Stelle (`Vorschaudatei.ts`) und die
Mandantenprüfung der Routen ebenso. Zeigten die beiden Vorschauen verschiedene
Dateien, wäre die eine die Antwort auf eine Frage, die die andere nicht gestellt
hat — und niemand käme darauf, dass es daran liegt. Ein Test hält beide
zusammen.

## Was die Werte entscheiden

Der Name allein ordnet nicht zu. Eine Spalte „E-Mail" ohne E-Mail-Adressen
darin ist ein falsch beschrifteter Export, und ein Vorschlag mit
widersprechenden Werten ist eine Einladung zum Durchwinken. Dafür müssen die
Werte bis zur Zuordnung durchkommen und nicht nur bis zur Typerkennung — eine
Stichprobe in derselben Größe, die auch die Typerkennung nimmt, damit es im
Produkt eine Zahl gibt und nicht zwei.

**Leere Werte werden dagegen über die ganze Datei gezählt.** Eine Zahl aus der
Stichprobe sähe aus wie eine Aussage über die Datei, und eine Spalte, die ab
Zeile 101 leer läuft, wäre unauffällig.

**Offen in dieser Etappe:** Die Bezeichnungsliste ist ausgeliefert und noch
nicht je Mandant erweiterbar (SPEC-02, Abschnitt 19, sieht das vor). Solange
gilt: Was nicht in der Liste steht, wird von Hand zugeordnet — einmal, dann
steht es als Regel.

---

# Etappe 14 — Ausleitungen und Bereinigung ✔ gebaut

**Specs:** SPEC-01 §23 · SPEC-07 §5 und Dateimodell.

Die zweite der fünf Etappen bis zum eigenständigen Modul.

```text
Konfliktbestand (SQLite)  ──┬──► Konfliktdatei      zur Ansicht, zur Weitergabe
  UUID, Status,             │
  Entscheidungen,           └──► Konfliktzieldatei  zur erneuten Verarbeitung
  Historie
```

**Gebaut:** `domain/conflicts/Ausleitung.ts`,
`application/conflicts/Ausleitungsdienst.ts`, Tabelle `conflict_exports`,
`POST /api/conflicts/export`, `GET /api/conflicts/exports`, ein Bereich im
Konfliktbildschirm — und die tägliche Bereinigung im Laufwerk, neben der
Aufbewahrung der Protokolle.

## Eine Ausleitung führt den Bestand nicht

Sie ist eine **Abschrift**. Genau deshalb darf sie nach Ablauf der Frist
fortgeräumt werden, ohne dass etwas verloren geht: „Die Nachvollziehbarkeit
hängt damit nicht an einer Datei, die irgendwann fortgeräumt wird."

Umgekehrt heißt das: Eine Ausleitung darf nie die einzige Stelle sein, an der
etwas steht. Sie trägt die UUIDs mit, damit ein Fall auch außerhalb von Unikom
wiedererkennbar bleibt — nicht, damit er dort weiterlebt.

## Drei Bedingungen fürs Forträumen

1. Die Frist ist um. **Null Tage räumt nichts fort, sondern schaltet ab** —
   abschalten und „sofort löschen" dürfen nicht dieselbe Eingabe sein.
2. Sie liegt noch da.
3. **Der Lauf ist erfolgreich abgeschlossen.** „Für nicht erfolgreich
   abgeschlossene oder noch in Bearbeitung befindliche Läufe dürfen …
   erforderliche Dateien nicht vorzeitig gelöscht werden." Eine Aufräumung, die
   nur auf das Datum sieht, nimmt genau dem die Unterlagen weg, der gerade
   einen misslungenen Lauf untersucht.

Ein **unbekannter** Lauf zählt als nicht abgeschlossen, und ohne Auskunft über
die Läufe wird gar nichts fortgeräumt, was zu einem Lauf gehört. Das ist die
unbequemere Antwort und die richtige: Eine Frist, die im Zweifel löscht, löscht
irgendwann das, was jemand gebraucht hätte.

**Der Eintrag bleibt stehen,** wenn die Datei fort ist, und trägt den Zeitpunkt.
Wer im März wissen will, warum eine Datei vom Januar nicht mehr da ist, findet
die Antwort und nicht eine Lücke, die nach einem Fehler aussieht.

**Was sich nicht löschen lässt, wird gemeldet und nicht verbucht.** Sonst hielte
der Eintrag die Datei für fortgeräumt, und sie läge noch jahrelang da.

## Wer den Bestand anfasst und wer nicht

Der `ConflictService` führt den Bestand: entscheiden, sperren, Status ändern,
Historie schreiben. Der `Ausleitungsdienst` macht **Abschriften** und fasst
davon nichts an. Zusammengelegt wäre die Ausleitung eine Handlung, die nebenbei
den Bestand verändert — und niemand wüsste mehr, ob ein Fall den Status
wechselte, weil jemand entschieden hat oder weil jemand eine Datei wollte.

Deshalb baut die **Konfliktzieldatei** der Ausleitungsdienst auch nicht selbst:
Die Fälle auf `ERNEUT_VERARBEITET` zu setzen ist eine fachliche Handlung und
gehört dorthin, wo die Historie entsteht. Von dort kommen Felder und Zeilen
fertig her.

## Kein Pfadfeld in der Oberfläche

Die Datei landet im Verzeichnis des Mandanten, in `Konfliktausleitungen`. Wer
eine Konfliktdatei weitergeben will, soll sich keinen Pfad ausdenken müssen, und
wer sie später sucht, soll wissen, wo sie liegt. Die Schnittstelle nimmt
trotzdem ein Verzeichnis entgegen — geprüft gegen die Mandantengrenze, denn eine
Ausleitung **schreibt** und ist damit ein bequemerer Weg in fremde Ordner als
eine Vorschau, die nur liest. Hat der Mandant kein eigenes Verzeichnis, sagt die
Antwort das, statt über einen Schreibfehler zu stolpern.

**Offen in dieser Etappe:** Die Aufbewahrungsfrist ist eine Konstante von
30 Tagen und noch keine Einstellung am Mandanten — dorthin gehört sie.
**Zurückgestellt ans Ende von Modul 2**, zusammen mit den übrigen
Mandanteneinstellungen; bis dahin gelten 30 Tage. Und die Konfliktzieldatei entsteht nur
auf Wunsch: Die Freigabe schreibt sie, wenn ein Verzeichnis genannt ist, und
liefert sonst weiter die Daten.

---

# Etappe 15 — Mehrere Durchgänge in Folge ✔ gebaut

**Specs:** SPEC-06 §7.

Die dritte der fünf Etappen bis zum eigenständigen Modul.

```text
Daten konsolidieren
  ├─ Durchgang 1  Filialen sammeln   /eingang  →  /arbeit
  └─ Durchgang 2  anreichern         /arbeit   →  /ergebnis
```

**Gebaut:** `domain/transfer/Schrittfolge.ts`, `Konsolidierungsdurchgang` und
`durchgaenge()` in `WorkflowStages.ts`, die Schleife im
`WorkflowExecutionService`, ein Bereich im Konsolidierungsschritt des Editors.

## Ein Glied, mehrere Durchgänge

Der Workflow behält ein Glied „Daten konsolidieren". Wie oft es rechnet, ist
seine eigene Sache und keine Frage an die Nummerierung der Glieder oder an die
Lizenz. Glieder tragen Namen als Identität — dürfte eines mehrfach vorkommen,
wäre der Name keine mehr.

## Die Reihenfolge ist die Liste

„Sie kann durch den Benutzer explizit festgelegt oder über definierte
Abhängigkeiten und Prioritäten bestimmt werden." Unikom nimmt das erste: Die
Reihenfolge, in der die Durchgänge dastehen, **ist** die Reihenfolge. Damit ist
sie eindeutig, ohne dass etwas hergeleitet werden muss.

**Umgeordnet wird nichts.** „Eine automatisch ermittelte Reihenfolge darf keine
fachliche Entscheidung ersetzen." Ein Programm, das selbst sortiert, hätte genau
das getan — und beim nächsten Öffnen stünde etwas anderes da, als jemand
eingetragen hat.

## Was trotzdem mehrdeutig sein kann

Die Abfolge ist eindeutig, die **Verkettung** nicht unbedingt. Drei Fälle stehen
vor dem ersten Durchgang im Protokoll:

```text
liest vom Vorgänger, der nichts ablegt
    → er liest, was er im Vorlauf vorfindet: nichts oder Altes

zwei Durchgänge schreiben in dasselbe Verzeichnis
    → der spätere überschreibt den früheren, und welcher das ist,
      entscheidet die Reihenfolge und nicht die Bedeutung

liest ein Verzeichnis, in das ein späterer erst schreibt
    → beim ersten Lauf leer, bei jedem weiteren der Vorlauf darin
```

Der dritte ist der tückischste: Er **funktioniert** — ab dem zweiten Lauf. Ein
Ergebnis, das an den Resten des Vortages hängt, sieht monatelang richtig aus.

## Je Durchgang ein eigener Stand

Jeder Durchgang legt seinen Ergebnisstand und seine Konfliktfälle an, alle am
selben Lauf. Nur den letzten zu führen wäre schlanker und verschwiege, welcher
Durchgang einen Konflikt verursacht hat.

**Weiter geht es nur aus einem freigegebenen Stand.** Ein Ergebnis, das auf eine
Entscheidung wartet, darf nicht schon der Eingang des nächsten Durchgangs sein —
die Freigabe wäre sonst eine Formalität über etwas, das längst
weiterverarbeitet ist. Ein Durchgang ohne Quellen beendet die Folge ebenfalls:
Den nächsten trotzdem laufen zu lassen hieße, ihn auf dem zu rechnen, was
zufällig noch in seinem Verzeichnis liegt.

## Der Verzeichnisbrowser ist herausgelöst ✔ nachgetragen

Er steckte im Job-Editor fest, und damit hing an ihm auch die Regel, dass
**jedes** Verzeichnisfeld einen Auswahlknopf bekommt: Wer außerhalb des Editors
ein Verzeichnis brauchte, hatte die Wahl zwischen Abtippen und einem zweiten,
ähnlichen Fenster. Zwei Fenster, die dasselbe fragen, werden sich früher oder
später darüber uneins, was ein eingetippter Pfad bedeutet.

`components/Verzeichniswahl.tsx` trägt jetzt beides:

```text
Verzeichnisfenster   der Baum, die Brotkrumen, „schon benutzt", Ordner anlegen
Verzeichnisfeld      das Feld mit dem quadratischen Knopf rechts daneben
```

**Was dort nicht steht, ist der Server.** Welchen es fragt, reicht der Aufrufer
als `lies` herein — eine lokale Quelle, eine Freigabe mit hinterlegtem Zugang,
ein SFTP-Ziel. Das Fenster zeigt nur, was zurückkommt, und nicht, was es für
wahrscheinlich hält. `lege` ist freiwillig: Ohne die Möglichkeit, einen Ordner
anzulegen, verschwindet die Zeile dafür — ein Knopf, der nichts kann, ist
schlimmer als keiner.

Der Editor behält seine drei Seiten (Quelle, Archiv, Ziel) und ein Fenster für
alle drei; die Verzeichnisfelder der weiteren Durchgänge haben ab jetzt ihren
Knopf.

**Offen in dieser Etappe:** Die Mehrdeutigkeiten stehen bisher nur im Protokoll
des Laufs; im Editor gehörten sie neben die Liste, bevor gespeichert wird —
sonst erfährt man vom Ringschluss erst nach der ersten Nacht.

---

# Etappe 16 — Referenzquellen verwalten ✔ gebaut

**Specs:** SPEC-04 §6 und §8 · SPEC-06 §13.

Die vierte der fünf Etappen bis zum eigenständigen Modul.

## Der Befund: gebaut und unerreichbar

Der Referenzabgleich steht seit Etappe 5 — er prüft, ergänzt, legt mehrdeutige
Treffer einem Menschen vor. **Aufgerufen hat ihn nie ein Workflow.** Der Lauf
übergab keinen Referenzbestand, weil es keine Stelle gab, an der einer steht;
erreichbar war er nur über den Prüflauf, dem man die Daten mitschickt.

```text
Referenzquelle              der Eintrag: Name, Datei, Version
     │
     ▼  wird zum Lauf gelesen
Referenzbestand             die Daten, eingefroren
```

**Gebaut:** `domain/consolidation/Referenzquelle.ts`,
`application/consolidation/Referenzquellendienst.ts`, Tabelle
`reference_sources`, `/api/reference-sources`, ein Reiter „Referenzen" unter
„Daten konsolidieren" — und der Verweis am Konsolidierungsdurchgang, der die
Lücke schließt.

## Der Verweis, nicht die Datenmenge

Am Workflow steht die **Kennung** einer verwalteten Quelle samt der Regel, wie
nachgeschlagen wird. Die Kundenliste selbst bleibt, wo sie ist: Sie in jeden
Workflow zu kopieren ergäbe so viele Stände wie Workflows, und beim nächsten
Umzug wüsste niemand, welcher gilt.

**Die Regel gehört zum Durchgang und nicht zur Quelle.** Dieselbe Kundenliste
wird im einen Workflow über die Kundennummer nachgeschlagen und im anderen über
die Postleitzahl.

## Die Version ist keine Zierde

„Ein Lauf, der sich nicht auf eine Version berufen kann, ist nicht
reproduzierbar" (SPEC-06, Abschnitt 13). Wer im März wissen will, warum ein
Datensatz im Januar durchging und heute ein Prüffall ist, muss sagen können,
welcher Stand damals galt. Jeder Lauf schreibt Name und Version der benutzten
Referenz ins Protokoll.

Ohne eigene Angabe gilt das Änderungsdatum der Datei — genau und nichtssagend,
aber eine **Tatsache**, und die lässt sich nachprüfen. Kennt niemand das
Änderungsdatum, bleibt die Version leer: Ein „unbekannt", das wie eine Version
aussieht, wäre die schlechtere Auskunft.

## Nachsehen ist eine eigene Handlung

Der Knopf liest die Datei **jetzt** und schreibt fest, was darin stand: Felder,
Zeilen, Änderungsdatum, die Anmerkungen des Lesers. Damit sieht man beim
Einrichten, ob die Referenz die Felder hat, über die man nachschlagen will —
statt es im Nachtlauf zu erfahren, wenn kein Treffer zustande kommt und niemand
weiß, warum.

## Eine fehlende Referenz hält den Lauf nicht an

Sie unterbleibt, **und das steht im Protokoll**. Still ohne Referenz
weiterzurechnen hieße, dass niemand mehr sieht, warum kein einziger Wert ergänzt
wurde. Dasselbe gilt, wenn eine Installation den Referenzdienst gar nicht hat.

## Übernehmen ist nicht dasselbe wie prüfen

Ohne ausdrückliche Angabe wird nur nachgeschlagen. Erst wenn Zielfelder
eingetragen sind, schreibt die Referenz etwas in den Datensatz — „Dies muss
ausdrücklich im Profil definiert sein" (SPEC-04, Abschnitt 6). Eine Referenz,
die ungefragt Werte ergänzt, wäre eine zweite Datenquelle, die niemand
ausgewählt hat.

**Offen in dieser Etappe:** Das Entfernen einer Referenzquelle prüft nicht, ob
ein Workflow noch auf sie verweist. Der Lauf meldet den Fehltritt dann sauber
und rechnet ohne Abgleich weiter — aber gewarnt wird beim Entfernen nicht, und
das gehörte dorthin.

---

# Etappe 17 — Feste Feldbreiten und JSON Schema ✔ gebaut

**Specs:** SPEC-03 §6 und §7 · SPEC-08 §2.

Die fünfte und letzte Etappe bis zum eigenständigen Modul.

## Feste Feldbreiten schreiben

```text
Feldbeschreibung          Zeile
kdnr   1–5   rechts, 0    00042Meier          Bonn
name   6–20  links
ort   21–30  links
```

**Weil die Gegenseite es so liest.** Wer an ein Hostsystem liefert, liefert
keine CSV — und ohne diese Möglichkeit endet das Ergebnis in einem
Zwischenschritt, den jemand von Hand baut.

**Zu lange Werte werden nicht heimlich gekürzt.** Aus „Meiersheimer-Krüger"
würde „Meiersheimer-Kr", und das sähe der Empfänger als vollständigen Namen an;
aus einer Kundennummer würde eine andere Kundennummer. Das Feld bleibt leer, und
der Wert steht im Protokoll. Wer wirklich kürzen will, sagt es **je Feld** —
dann steht es in der Feldbeschreibung und nicht im Verhalten des Schreibers.

**Ohne Feldbeschreibung wird nicht geschrieben** und auch nicht auf CSV
ausgewichen: Ein Empfänger, der eine Datei fester Breite erwartet und eine CSV
bekommt, liest sie als eine einzige, sehr breite Spalte — das sieht nach
kaputten Daten aus und nicht nach einer falschen Einstellung.

**Die Probe, die zählt:** Was der Schreiber schreibt, liest der vorhandene Leser
wieder ein. Ein Schreiber, der seine eigene Beschreibung anders auslegt als der
Leser, ergibt eine Datei, die erst beim Empfänger auffällt — und dort als
Datenfehler, nicht als Formatfehler.

## Die Prüfung gegen ein JSON Schema

**Ein Ausschnitt, und er sagt welcher.** Geprüft werden `type`, `required`,
`properties`, `items`, `enum`, `const`, `minimum`/`maximum`, `minLength`/
`maxLength`, `pattern`, `additionalProperties`.

**Was nicht verstanden wurde, steht im Ergebnis.** `$ref`, `allOf`, `if/then` —
ein Schlüsselwort, das diese Prüfung nicht kennt, wird nicht übergangen, sondern
gemeldet. Ein halbes JSON Schema, das sich für vollständig ausgibt, ist
schlimmer als keines: Es sagt „gültig" zu einer Datei, deren Schema es nicht
verstanden hat. `gueltig: true` heißt hier deshalb nicht „das Schema ist
erfüllt", sondern „was geprüft werden konnte, war in Ordnung".

**Alle Verstöße, nicht der erste.** Wer eine Datei mit dreißig Fehlern bekommt,
will sie einmal überarbeiten und nicht dreißigmal hochladen. Jeder Verstoß trägt
seinen Pfad (`kunden[3].kdnr`).

**Zwei Pfade, weil zwei Fragen:** Ein Verstoß gehört zu einem Datensatz, ein
nicht verstandenes Schlüsselwort zu einer Stelle im Schema. Über hundert
Listeneinträge wäre dasselbe `$ref` sonst hundertmal gemeldet.

## Die Prüfung hängt am Lauf ✔ nachgetragen

Nicht später, sondern gleich: Genau diese Verdrahtung hat beim Referenzabgleich
jahrelang gefehlt, und das Ergebnis war eine gebaute, geprüfte, unerreichbare
Funktion.

**Vor der Verarbeitung.** Der Durchgang trägt `schema: { datei, bei }`; geprüft
wird jede Eingangsdatei, bevor der Leser sie zerlegt.

**Geprüft wird das Dokument, nicht die Zeilen.** Ein JSON Schema beschreibt die
Struktur der Datei — verschachtelte Objekte, Listen, Pflichtfelder. Der Leser
macht daraus flache Zeilen; was danach geprüft würde, wäre nicht mehr das, was
das Schema beschreibt.

**Voreingestellt wird eine verletzende Datei nicht verarbeitet.** Wer sich die
Mühe macht, ein Schema zu hinterlegen, will nicht, dass sie trotzdem durchläuft.
Die verarbeitete Datei ließe sich nicht mehr zurückholen; ein ausgelassener Lauf
schon. Wer es anders braucht, stellt „Trotzdem verarbeiten und warnen" ein.

**Drei Fälle, die nicht als Datenfehler durchgehen:**

```text
Schema nicht lesbar  →  Daten laufen, Hinweis ins Protokoll
                        (ein Konfigurationsfehler ist kein Datenausfall)
CSV statt JSON       →  Daten laufen, „wurde nicht geprüft" ins Protokoll
                        (stillschweigend übergehen wäre schlimmer)
kein gültiges JSON   →  Datei wird ausgelassen
```

## Der Browser kennt jetzt auch Dateien ✔ nachgetragen

Er listete Verzeichnisse und **zählte** die Dateien darin — nennen konnte er sie
nicht. Für ein Feld, in dem eine Datei steht, blieb damit nur das Abtippen, und
ein Tippfehler dort meldet sich erst im Nachtlauf, wenn niemand mehr hinsieht.

```text
entries   die Ordner        → Verzeichnisfeld
files     die Dateien       → Dateifeld
```

**Getrennt und nicht daruntergemischt.** Wer ein Verzeichnis aussucht, soll
nicht durch tausend Dateien scrollen; wer eine Datei aussucht, soll sie nicht
zwischen Ordnern suchen. `filesFound` bleibt daneben stehen — die Zahl gilt auch
dort, wo die Liste nicht gebraucht wird.

**Dasselbe Fenster, ein anderer Ausgang.** `waehle="DATEI"` blendet die
Dateiliste ein, nimmt dem Verzeichnis die Vorauswahl (sonst übernähme der Knopf
einen Ordner, wo eine Datei erwartet wird), blendet „Ordner anlegen" aus und
sperrt den Knopf, bis wirklich eine Datei angeklickt ist. Gewandert wird
weiterhin durch die Ordner — eine Datei liegt schließlich in einem.

**Offen in dieser Etappe:**

1. **Die Datei einer Referenzquelle** bleibt ein Textfeld. Dort steht kein
   voller Pfad, sondern ein Dateiname **innerhalb** des schon gewählten
   Verzeichnisses — und leer heißt dort „die erste lesbare". Ein Wähler, der
   einen vollen Pfad zurückgibt, passte nicht dazu.
2. **XSD.** SPEC-03 führt es ausdrücklich als optional. Es ist ein eigenes Stück
   Arbeit — Namensräume, Importe, Typhierarchien —, und der Wert ist zu wägen:
   Viele Kunden haben gar kein XSD. Als Halbes gebaut wäre es dieselbe Falle wie
   ein halbes JSON Schema, nur größer.

## Was zuerst weh tut

Drei Stellen, an denen der Aufwand erfahrungsgemäß unterschätzt wird:

1. **Datum und Zahl.** Nicht das Erkennen, sondern das *Nicht*-Erkennen: die
   Fälle, in denen beide Lesarten gelingen. Dafür ist die Region da, und dafür
   muss sie durch die ganze Kette getragen werden.
2. **Die Bezeichnungsliste.** Sie entscheidet, ob SPEC-09 hält, was es verspricht.
   Sie zu pflegen ist Produktarbeit, keine Programmierarbeit.
3. **Die Konfliktoberfläche.** Sie ist kein Formular, sondern ein Arbeitsplatz:
   suchen, filtern, gruppieren, sperren, morgen an derselben Stelle weitermachen.

## Vorschlag für den Anfang

Etappe 1, und darin zuerst **CSV und Excel** — die beiden Formate, mit denen
Kunden tatsächlich ankommen. Fixed-Width, JSON und XML kommen in derselben
Etappe hinterher, ohne dass sich am Gerüst etwas ändert.

Erstes sichtbares Ergebnis: eine Datei auswählen und sehen, was UniCom darin
erkennt — Felder, Typen, Beispielwerte, Konfidenz. Das ist wenig Code und viel
Antwort auf die Frage, ob die Erkennung taugt.
# Etappe 18 — Die Quelle des Konsolidierens ✔ gebaut · ⚠ eine Prüfung offen

**Specs:** SPEC-01 §14 · SPEC-06 §7.

Das Konsolidieren hatte kein Panel „Quelle", sondern zwei Zeilen mitten in den
Einstellungen: eine Auswahl und ein Textfeld, in das man einen Pfad tippt. Beim
Übertragen steht an derselben Stelle eine eigene Fläche mit Art, Anmeldung und
Verzeichniswahl. Zweimal dasselbe entscheiden und zweimal anders bedienen — das
war der Anlass.

## Nur örtlich und Freigabe

Die Konsolidierung liest auf dem Dateisystem dieses Rechners. Ein UNC-Pfad ist
ein solcher Pfad, nur einer über das Netz; SFTP und FTPS wären eine Abholung,
und die gehört dem Übertragen. Beide hier anzubieten hieße, dem Kunden eine
Einstellung zu geben, bei der der Nachtlauf nichts findet — dieselbe Falle wie
beim Referenzabgleich und bei der Schemaprüfung, die beide gebaut und von keinem
Lauf erreichbar waren.

## Die Sitzung umschließt den ganzen Durchgang

Nicht nur das Auflisten. Sonst entstünde eine Liste von Dateien, die sich danach
nicht mehr öffnen lassen — und der Lauf scheiterte an einer Stelle, die mit der
Freigabe nichts zu tun zu haben scheint. Eine Mutation, die die Sitzung auf das
Auflisten verkürzt, wird von einem Test gefangen, der die Reihenfolge prüft und
nicht das Ergebnis.

Fehlt die Verdrahtung oder der Zugang, läuft der Durchgang trotzdem — und sagt
es im Protokoll. Manche Freigaben stehen dem Dienstkonto offen; still darüber
hinwegzugehen wäre der Fehler, den niemand findet.

## Die Freigabe gehört an den Zugang

Kein zweiter Bestand „bekannte Freigaben". Der wäre eine halbe Kopie der
Zugangsverwaltung, und an dem Tag, an dem jemand dort das Kennwort ändert, wäre
die andere veraltet. Also ein Feld am Zugang, und wer ein Verzeichnis darunter
aussucht, bekommt ihn von selbst eingetragen.

Zwei Regeln darin sind nicht selbstverständlich:

* **Der genauere gewinnt.** Zwei Zugänge auf demselben Server sind der
  Regelfall — einer darf auf der ganzen Freigabe alles, einer nur in einen
  Unterordner sehen. Gewänne der gröbere, liefe der Nachtlauf mit den weiteren
  Rechten.
* **Verglichen wird an der Grenze eines Gliedes.** `…\Austausch` ist kein Anfang
  von `…\Austausch-alt`, auch wenn die Zeichen es nahelegen.

## Die Vorbelegung ist ein Startwert und keine Verbindung

Wer von „Übernimmt, was Daten übertragen ablegt" auf ein eigenes Verzeichnis
umschaltet, bekommt Verzeichnis und Zugang aus dem Ziel des Übertragens
**einmalig sichtbar eingetragen** — und nur in ein leeres Feld. Ein dauerhaft
abgeschriebener Pfad wäre so lange richtig, bis jemand das Übertragen ändert,
und ab dann still falsch. Wer die Verbindung will, nimmt die Übernahme: Das ist
ein Verweis und wandert mit.

## ⚠ Was noch niemand gemessen hat

Der ganze Freigabepfad ist **gegen Attrappen** geprüft, nicht gegen Windows.
Offen bleiben drei Fragen:

1. Verbindet `net use` wirklich mit einem **fremden** Konto — und nicht mit dem,
   unter dem der Dienst läuft?
2. Liest die Konsolidierung die Dateien über UNC noch, wenn die Liste längst
   steht?
3. Hält die Annahme „je Server nur eine Sitzung" (Systemfehler 1219)? Sie ist im
   Code ausdrücklich als *angenommen, nicht gemessen* vermerkt.

**Der Plan dafür** — zurückgestellt am 21.08.2026, weil eine Bühne, die nur die
halbe Zusage prüft, den Aufwand nicht wert ist:

Eine Freigabe auf diesem Rechner und ein lokales Konto, das nur dafür da ist.
Adressiert als `\\127.0.0.1\UnikomTest` — **nicht** `\\localhost\...`: Windows führt
eine SMB-Sitzung je Servernamen, und zu diesem Rechner besteht unter dem eigenen
Konto längst eine. Zwei Schreibweisen desselben Rechners zählen für den
Redirector als zwei Server, also bleibt `\\localhost\UnikomTest` dem
Matrix-Test mit dem eigenen Konto und `\\127.0.0.1\UnikomTest` bekommt das
fremde. Wer 1219 *absichtlich* auslösen will, nimmt zweimal denselben Namen —
dann ist es ein Befund und kein Zufall.

Einrichtung einmal als Administrator, Kennwort vom Skript gewürfelt und in die
gitignorierte `testserver.local.json` geschrieben; ein Rücknahme-Skript gehört
dazu, weil ein Konto angelegt wird. Ein NAS oder ein zweiter Rechner wäre die
bessere Bühne und bräuchte hier keine Administratorrechte — der Test liest nur
den einen Eintrag aus `testserver.local.json` und taugt für beides.

**Ungeprüft bleibt so oder so** ein Datei-Server in einer Domäne: Kerberos, DFS,
Gruppenrechte, Richtlinien. Das kann nur eine Kundenumgebung beantworten.
# Etappe 19 — Der Stapel: erst vollständig, dann verarbeiten ✔ gebaut

**Specs:** SPEC-06 §2.

Für die Eingangsdateien eines Durchgangs stand ein einziges Textfeld: ein
Namensmuster. Der Einwand des Betreibers traf: „Es gibt nichts, was
kanalisiert, wenn mehrere Dateien zusammengeführt werden sollen."

## Was gemessen wurde, bevor entschieden wurde

| Eingabe | was hineinlief |
|---|---|
| *(leer)* | jede lesbare Datei — auch `Notizen.txt` und `Backup_alt.csv` |
| `Filiale_*.csv, Umsatz_*.csv` | **nichts** |
| `Filiale_*.csv` | die beiden Filialdateien |

Die zweite Zeile ist die schlimmere: Das Komma wurde wörtlich genommen, es
passte nichts, und der Lauf endete mit `SUCCESS_NO_FILES` und der Zeile
„keine Quelle gefunden, nichts zu tun" — als **INFO**. Eine naheliegende
Eingabe, die stillschweigend jede Nacht nichts tat.

Dazu ein Widerspruch im eigenen Haus: `Eingang.ts` zitiert SPEC-06 §2 —
„Ein Muster ist eine solche Regel. Ein Verzeichnis ist keine" — und
fünfundzwanzig Zeilen darunter gab `passt(name, '')` ein `true` zurück.

## Das Modell, das der Betreiber gesetzt hat

Das Quellverzeichnis ist ein **reines Abholverzeichnis**. Was darin liegt,
wartet auf Verarbeitung; danach wandert es fort, gelungen oder nicht. Wer
etwas erneut verarbeiten will, legt es wieder hinein. Damit wird „alles, was
drin liegt" zu einer zulässigen Regel — das Verzeichnis wird geleert, es
lingert nichts. Und die Dubletten über Läufe erledigen sich mit dem
Verschieben.

## Vollständigkeit: zwei Bedingungen, die verschiedene Fehler fangen

**Plätze** — je Beteiligtem ein Name und ein Muster. **Anzahl** — wie viele
Dateien insgesamt. Beide zusammen:

| Lage | Plätze | Anzahl | Ergebnis |
|---|---|---|---|
| Nord, Süd, West je einmal | ✓ | ✓ | läuft |
| Nord zweimal, Süd fehlt | ✗ | ✓ | wartet |
| Nord zweimal, alle anderen einmal | ✓ | ✗ | wartet, meldet „mehrfach geliefert" |

Der Name der Plätze ist keine Zierde: „es fehlt ‚Filiale Süd'" beantwortet
die Frage, die um sieben Uhr morgens gestellt wird. „2 von 3" nicht.

## Vier Regeln, die nicht auf der Hand liegen

1. **Eine Datei, die noch geschrieben wird, zählt nicht** — und startet die
   Frist nicht. Wer 400 MB hineinkopiert, legt den endgültigen Namen sofort
   an; ohne Reifezeit verarbeitete der Lauf ein abgeschnittenes Stück, und
   ohne die zweite Hälfte bräuchte eine große Datei ihre eigene Frist auf,
   während sie kopiert wird.
2. **Die Frist rechnet ab der ersten Datei**, nicht ab einer Uhrzeit — wer um
   22:00 liefert und wer um 03:00 liefert, bekommt dieselbe Spanne.
3. **Ein vollständiger Stapel läuft nie ab.** Sonst würfe eine knappe Frist
   einen Stapel fort, der gerade fertig geworden ist.
4. **Ein unvollständiger Stapel gibt gar keine Dateien heraus.** Es gibt
   nichts zu holen, was halb wäre.

## Das Verschieben ist der Zugriff

```text
vollständig erkannt → genau diese Dateien ins Arbeitsverzeichnis
                    → von dort lesen → Erledigt bzw. Gescheitert
```

Was danach im Abholverzeichnis ankommt, gehört zum nächsten Stapel und kann
nicht halb mitkommen. Eine Datei ohne Platz bleibt liegen — sie mitzuräumen
hieße, sie verschwinden zu lassen, ohne sie verarbeitet zu haben.

Das Aufräumen liegt **um** den ganzen Durchgang und nicht an jedem Ausgang
einzeln: Ein Ausgang, den später jemand hinzufügt, ist genau der, an dem es
vergessen wird. Ein Teilerfolg zählt nicht als gelungen.

Verstreicht die Frist, wird der Stapel gemeldet und nach *Gescheitert*
geräumt — mit eigenem Meldeanlass `STAPEL_VERWORFEN` und nicht als
„Lauf fehlgeschlagen": Unikom hat sich richtig verhalten. Zu melden ist eine
ausgebliebene Lieferung, und darum kümmert sich ein anderer Mensch.

## Die Marke im Dateinamen

Gebraucht, sobald **zwei Stapel gleichzeitig** im Abholverzeichnis liegen
können — die verspätete Lieferung von gestern neben der heutigen. Ohne
Merkmal würden beide zu einem verrührt: Die Plätze wären besetzt, und das
Ergebnis enthielte zwei Tage.

**Erst gebaut, dann verworfen:** Die erste Fassung las den Wert aus einer
*Spalte*. Der Betreiber hat widersprochen, und zu Recht — sie verlangte, jede
Datei aufzumachen, **bevor** entschieden ist, ob sie überhaupt verarbeitet
wird, und dass jede Zeile denselben Wert trägt.

Jetzt steht das Merkmal im Namen, an der Stelle, die das Muster bezeichnet:

```text
Filiale_Nord_{stapel}.csv   →  Filiale_Nord_2026-08-21.csv gehört zu „2026-08-21"
```

Ein eigener Schalter daneben wäre eine zweite Angabe gewesen, die dem Muster
widersprechen kann. So sagt das Muster selbst, **ob** gruppiert wird und
**welcher Teil** des Namens das Merkmal ist. Der Name trägt die Zugehörigkeit
ohnehin: Wer Tageslieferungen bekommt, hat das Datum darin, weil er die
Dateien sonst gar nicht auseinanderhalten könnte.

Drei Entscheidungen darin:

* **Je Lauf ein Stapel**, der älteste vollständige. Zwei in einem Lauf zu
  nehmen hieße, sie doch zusammenzulegen. Älteste zuerst, weil sich sonst ein
  Stapel, der nie fertig wird, immer wieder vor die fertigen drängte.
* **Jede Gruppe hat ihre eigene Frist.** Sonst risse der alte Stapel den
  neuen mit: Seine Uhr läuft länger.
* **Verworfen wird dieser Stapel, nicht das Verzeichnis.** Sonst nähme ein
  alter, nie fertig gewordener Stapel jede Nacht einen frischen mit.

Tragen manche Plätze die Marke und andere nicht, ist bei deren Lieferungen
nicht zu sagen, wohin sie gehören. Das ist ein Einrichtungsfehler: eine
Warnung im Protokoll, und der Punkt an der Überschrift steht auf rot.

## Das Komma trennt

`Filiale_*.csv, Umsatz_*.csv` sind **zwei Muster**; es genügt, wenn eines
trifft. Vorher wurde das Komma wörtlich genommen — gesucht wurde eine Datei,
deren Name ein Komma enthält.

Die Begründung ist die des Betreibers: „Ein Komma hat in einem Dateinamen
nichts verloren, zumindest sicher nicht in Dateien, die derart verarbeitet
werden." Damit ist es als Trenner frei — und zwar in **jedem** Feld, das
Dateinamen aufnimmt. Auch „Dateiname/n" beim Übertragen trug das Plural-n im
Namen und nahm trotzdem genau einen.

## Die Oberfläche

Eine eigene Fläche „Welche Dateien" zwischen Quelle und Verarbeitung: Muster,
Reifezeit, der Schalter für den Stapel, die erwarteten Lieferungen als Liste,
Anzahl, Schlüsselfeld, Frist, die drei Verzeichnisse. Dazu die Vorschau **„Was
trifft das gerade?"** — sie liest das Abholverzeichnis und zeigt in zwei
Spalten, was mitkommt und was draußen bleibt. Das ist die einzige Antwort auf
„wie schließe ich anderes aus", die man vor dem Speichern glauben kann.

Der Erklärtext des Musterfeldes sagt, dass das Komma trennt; der der Plätze
erklärt die Marke `{stapel}`.

## Belegt

33 Tests (20 auf der Regel, 13 auf dem Lauf), **27 von 27 Mutationen
gebissen**. Die scharfen darunter prüfen die Reihenfolge und nicht das
Ergebnis: dass aus dem Arbeitsverzeichnis gelesen wird und nicht aus dem
Abholverzeichnis, dass fremde Dateien liegen bleiben, und dass beim Verwerfen
nur der betroffene Stapel geht.

## Was offen bleibt

* Ein **Zeitfenster** („nur zwischen 22:00 und 02:00") gibt es nicht. Die
  Frist relativ zur ersten Datei deckt den Bedarf, den der Betreiber genannt
  hat; ein Fenster wäre eine zweite Zeitregel neben dem Zeitplan des
  Workflows, und zwei Uhren an einer Sache sind eine zu viel.
* **Ausschlussmuster** (`~$*` für die Sperrdateien von Excel) sind nicht
  gebaut. Mit benannten Plätzen fällt der Bedarf meist fort — eine Datei ohne
  Platz kommt ohnehin nicht mit.
* Die **Ausnahme, die der Betreiber gelten lässt** — ein Merkmal in einer
  eindeutigen Überschrift, die nicht zu einer Tabelle oder Liste gehört — ist
  nicht gebaut. Unikom hat keinen Begriff von einem Vorspann: `Feststellungen`
  beschreibt Formatfakten wie Trennzeichen und Kodierung, sonst nichts. Das
  auf die Schnelle danebenzubauen wäre geraten.

## Nachtrag: der Punkt an der Pille zeigt den Zustand

Zuerst stand ein orangefarbener Streifen am linken Rand einer Fläche, in der
etwas Vollständiges steht. Er ist wieder fort; den Zustand trägt jetzt der
Punkt neben der Überschrift:

```text
grau   nichts eingetragen
gelb   angefangen, etwas Nötiges fehlt
rot    eingetragen und in sich falsch
grün   vollständig
```

**Warum am Punkt.** Von einer zugeklappten Fläche ist die Pille zu sehen, und
der Punkt gehört zu ihr. Ein Dutzend Pillen untereinander ergibt eine Spalte
von Punkten, die man in einem Blick abliest. Ein Streifen kann außerdem „hier
steht etwas" sagen, aber nicht vier Zustände: Vier Farben als schmale Linien
zu unterscheiden verlangt Vergleichen — als Punkt sind sie eine Farbe an einer
Stelle.

**Rot wird sparsam vergeben.** Eine Freigabe ohne Zugang ist *unvollständig*,
nicht falsch; rot bleibt dem vorbehalten, was so nicht laufen kann — ein
Laufwerkspfad als Freigabe, gemischte Stapelmarken. Wer rot für Fehlendes
vergibt, dem fällt der echte Fehler nicht mehr auf.

Die Regel je Fläche steht in `web/src/screens/job/feldstand.ts` — vorher
`belegt.ts`, was ein Ja/Nein war und nicht mehr beschrieb, was darin steht.

# Etappe 20 — Der Dateityp neben dem Namensmuster ✔ gebaut

Im Abholverzeichnis liegt nicht nur, was der Durchgang lesen soll. Bisher gab
es dafür genau eine Regel: das Namensmuster. Wer nach Format trennen wollte,
schrieb `*.csv` — und sobald es drei Formate waren oder zusätzlich der Name
zählte, stand jede Endung hinter jedem Namen.

**Welche Namen und welche Formate sind zwei Fragen.** Deshalb ein eigenes
Feld: `Dateiwahl.endungen`. Ohne Angabe bleibt alles wie bisher — was ein
Leser öffnen kann, kommt mit.

## Die Regel steht in der Domäne

`passtEndung` in `domain/consolidation/Namensmuster.ts`, neben `passt`. Sie
vergleicht so, wie ein Anwender es meint: `csv`, `.csv` und `.CSV` sind
dieselbe Endung. Ein Filter, der am vergessenen Punkt scheitert, nähme jede
Nacht nichts mit — und im Protokoll stünde nur, dass nichts zu tun war.

Die Endung wird **am Ende** verlangt, mit ihrem Punkt: `csv_Archiv.zip` ist
keine CSV, und `Umsatz.csv.gz` auch nicht.

## Der Grund steht im Protokoll

Übergangene Dateien wurden bisher mit „kein lesbares Format" gemeldet, auch
wenn das Muster der Grund war. Der Satz nennt jetzt die Gründe, die
eingetragen sind:

```text
7 Datei(en) in „C:\Eingang" wurden übergangen: Sie sind nicht csv, xlsx
  oder passen nicht zu „Filiale_*.csv" oder haben kein lesbares Format
```

Ohne diesen Unterschied schickt eine Ferndiagnose in die falsche Ecke: Eine
CSV, die nur nicht zur Auswahl gehört, hat sehr wohl ein lesbares Format.

## Nur beim eigenen Abholverzeichnis

Das Feld erscheint, wenn die Quelle ein eigenes Verzeichnis ist. Wer
übernimmt, was der Schritt davor abgelegt hat, bekommt eine Liste dieses Laufs
und keine Momentaufnahme eines Verzeichnisses — dort ist längst entschieden,
was mitkommt.

Eine getroffene Auswahl bleibt beim Umschalten stehen. Sie ist dann nicht tot,
sondern ruht: Wer zurückschaltet, findet sie wieder, und der Lauf liest sie in
diesem Zweig gar nicht erst.

## Ein Bedienelement für drei Stellen

Die Endungsliste zum Anhaken stand im Bildschirm des Übertragungsschritts und
kannte genau dessen zwei Felder. Sie ist jetzt `components/Endungsfeld.tsx`
und trägt alle drei: übernommene Dateitypen, Endungen unfertiger Uploads, und
die Dateitypen des Konsolidierens. Dreimal dasselbe Fenster nachzubauen hieße,
jede spätere Änderung dreimal zu machen — und die dritte Stelle zu vergessen.

## Nebenbei repariert: die Vorschau log beim Komma

„Was trifft das gerade?" nahm das ganze Feld als **ein** Muster. Bei
`Filiale_*.csv, Umsatz_*.csv` traf damit nichts, und die Vorschau zeigte alles
unter „bleibt draußen" — während der Lauf beide Muster mitnahm. Sie zerlegt
jetzt am Komma wie der Lauf und prüft dieselben drei Stufen: lesbares Format,
gewählter Dateityp, Namensmuster.

Eine Vorschau, die weniger prüft als der Lauf, sagt genau an der Stelle etwas
Falsches, an der man sie fragt.

## Angegriffen

Acht Mutationen, acht Bisse: die leere Auswahl, die leeren Einträge, die
Endung mitten im Namen, der fehlende Punkt, der getippte Punkt, die
Schreibweise — und zweimal die Verdrahtung im Lauf.

# Etappe 21 — Zwei Betriebsarten, zwei Flächen ✔ gebaut

„Welche Dateien" trug beides: das Namensmuster für die einzelne Lieferung und
die erwarteten Plätze eines Stapels. Beides nebeneinander sind zwei Antworten
auf dieselbe Frage — welche Dateien mitkommen —, und offen bleibt, welche gilt.

Der Schalter steht jetzt unten in der Fläche **Quelle**, nach dem
Quellverzeichnis: **Mehrere Dateien zusammenführen**. Erst steht fest, woher
gelesen wird; dann, ob eine einzelne Lieferung genügt.

```text
aus →  Welche Dateien    Dateityp/en, Namensmuster, Wartezeit,
                         Arbeitsverzeichnis, Erledigt, Gescheitert, Vorschau

an  →  Mehrere Dateien   Primär-Datei, Erwartete Dateien insgesamt, Frist,
                         Arbeitsverzeichnis, Erledigt, Gescheitert
```

## Der Schalter ist die Bedingung selbst

Kein zweites Merkmal am Auftrag. `Dateiwahl.stapel` entscheidet, welche Fläche
steht — einschalten legt eine leere Bedingung an, ausschalten nimmt sie fort.
Zwei Schalter für eine Sache stünden früher oder später gegeneinander, und
dann wäre eine Einstellung in Kraft, die niemand sieht.

Aus demselben Grund ist die Checkbox *„Erst beginnen, wenn ein vollständiger
Stapel vorliegt"* im Panel wieder fort: Sie konnte gar nicht ausgeschaltet
sein — die Fläche gibt es nur, solange die Bedingung steht. Ein Kästchen, das
immer angehakt ist, fragt bloß ein zweites Mal, was oben schon entschieden
wurde. Was es erklärte, steht beim Schalter in der Quelle.

## Was im Stapelbetrieb nicht mehr zu sehen ist

Dateityp/en, Namensmuster und Wartezeit stehen nur in „Welche Dateien". Ihre
gespeicherten Werte **wirken weiter**: Der Lauf filtert damit vor, bevor er die
Plätze prüft. Das ist so entschieden und kein Versehen — wer von einer
Betriebsart in die andere wechselt, verliert seine Eingaben nicht.

Sichtbar bleibt es im Protokoll: Übergangene Dateien werden mit ihrem Grund
gemeldet („Sie passen nicht zu …"), also auch dann, wenn das Muster aus der
anderen Fläche stammt.

## Die Vorschau nur ohne Stapel

„Was trifft das gerade?" beantwortet, was da liegt und mitkäme. Im
Stapelbetrieb ist die Frage eine andere — welcher Platz besetzt ist —, und die
beantwortet der Lauf mit Namen.
