# FR_006 — Entscheidungsprotokoll zur Konsolidierung

> **Kein Anforderungsdokument.** Gebaut wird ausschließlich nach den Specs.
> Hier steht, *warum* sie so lauten — und gegen welchen Widerspruch.
>
> Alle Zitate stammen aus den Fassungen **1.0**, also aus dem Stand vor der
> Überarbeitung. Wer daraus implementiert, baut die Widersprüche nach.
>
> Bei der nächsten Prüfrunde wird angehängt, nicht überschrieben.

## Runde 10 — Das Archiv, und was es deckt (25.08.2026)

### Erst das Archiv, dann der Zugriff

Der Lauf nimmt die Lieferung aus dem Abholverzeichnis, teilt sie auf und legt
abgeleitete Dateien nach Erledigt und Gescheitert. Das ist nur zu verantworten,
solange das Original unverändert woanders liegt.

**Entschieden:** Das Archivpaket entsteht, **bevor** eine Datei angefasst wird.
Andersherum lägen die Dateien schon im Arbeitsverzeichnis, wenn das Sichern
fehlschlägt — aus dem Abholverzeichnis genommen, nirgends gesichert, und der
nächste Lauf fände sie nicht mehr. Schlägt es fehl, bleibt der Stapel liegen,
wo er ist.

**Ein Paket je Lauf**, nicht je Datei: Drei Filialdateien desselben Tages sind
eine Lieferung. Einzeln abgelegt ließe sich später nicht mehr sagen, welche
zusammengehörten.

**Der Schlüssel ist der Hauptschlüssel der Installation** und nicht einer je
Ziel. Ein Ziel bekommt einen eigenen, weil der Empfänger die Datei öffnen
können muss; das Archiv soll niemand öffnen können außer dem Betreiber selbst.

### Ein Rückweg, den nur der Quelltext kennt, ist keiner

Zwischenstand war: Das Archiv war eine Einbahnstraße. Verschlüsselt abgelegt,
nie wieder aufzumachen.

**Entschieden:** `decryptBytes` als Gegenstück, `readZip` zum Entpacken — das
gab es schon für XLSX —, und drei Türen über die Schnittstelle:

```text
packages  welche Pakete liegen da       ohne eines zu öffnen
open      was steckt in diesem Paket    Namen und Größen, kein Inhalt
file      diese eine Datei, bitte       der Inhalt, als Base64
```

Ein Verzeichnis mit dreihundert Paketen entschlüsselte sonst dreihundert
Archive, nur um eine Liste zu zeigen. Und wer wissen will, ob die Lieferung von
Dienstag drei Dateien hatte, braucht dafür keine Kundendaten.

**Base64 und nicht Text:** Im Archiv liegt auch eine Arbeitsmappe. Als
Zeichenkette geschickt wäre sie kaputt, und zwar unbemerkt.

### Die Reihenfolge war nicht beliebig

Gebaut wurde in dieser Folge: Archiv schreiben → Rückweg → Ansicht → Leeren.

Der Grund steht in der Mitte: Das Löschen im Arbeitsverzeichnis ist durch das
Archiv gedeckt — aber nur, solange sich das Archiv auch öffnen lässt. Zwischen
„Archiv geschrieben" und „Archiv lesbar" lag ein Zustand, in dem das Löschen
eine Zusage ohne Deckung gewesen wäre. Bis dahin wurde nur der **leere Ordner**
fortgenommen, keine einzige Datei.

### Was gelöscht wird, und was nie

**Entschieden:** Fortgenommen wird, was dieser Lauf hineingelegt hat und was
nach dem Wegräumen noch daliegt — und nur, wenn das Archivpaket geschrieben
wurde. Ohne Paket bleibt jede Datei liegen: lieber ein volles Verzeichnis als
ein Bestand, den es nirgends mehr gibt.

Was **nicht** aus diesem Lauf stammt, wird nie angefasst, auch nicht bei
geschriebenem Archiv. Es steht in keinem Paket, und wer es dort abgelegt hat,
hatte einen Grund.

Ins Protokoll kommt der Pfad des Pakets. Eine Zeile „gelöscht" ohne die Angabe,
wo die Daten jetzt liegen, ist keine Nachvollziehbarkeit, sondern eine
Behauptung.

### Zwei Schranken um denselben Handgriff

Hier liegt der eine Griff, der einen ganzen Bestand kostet:

* Der Ordner muss auf die **Laufkennung** enden — verglichen wird das letzte
  Glied und nicht das Ende der Zeichenkette. `raeumeAus` wird auch mit dem
  Abholverzeichnis gerufen, und ein Leeren dort träfe das Verzeichnis, in das
  der Lieferant schreibt.
* `rmdir` und nicht `rm -r`: Es scheitert von selbst, sobald noch etwas darin
  liegt.

### Offen

Eine **Aufbewahrungsfrist** für das Archiv gibt es nicht. FR_009 §2 nennt
keine — obwohl dasselbe Dokument Bestände ohne Frist verbietet, und das Archiv
hält per Definition Originaldaten. Dieselbe Lücke betrifft Erledigt und
Gescheitert.

---

## Runde 9 — Zwei Schalter, und sie beantworten Verschiedenes (25.08.2026)

### Der Lauf liest das Schema — und was daraus folgt

Man konnte ein Schema anlegen, ihm Regeln geben und es im Workflow auswählen,
und es passierte nichts: Der Lauf fragte nur nach der alten JSON-Datei. Auf dem
Bildschirm stand eine Prüfung, die nicht stattfand.

**Entschieden:** Es gilt die **letzte** Fassung des Profils und nicht die, die
beim Einrichten galt. Eine Fassung festzuhalten wäre die vorsichtigere Wahl —
und die falsche: Wer eine Regel korrigiert, will sie heute Nacht wirksam haben
und nicht erst, wenn jemand den Workflow anfasst.

### `bei` und `auslieferung` regeln nicht dasselbe

Zwei Einstellungen berühren denselben Fall, und wer sie verwechselt, baut
Widersprüche:

```text
bei (am Durchgang)         ist ein Verstoß überhaupt ein Problem?
auslieferung (am Mandant)  wenn ja — ganz stehen lassen oder teilen?
```

**Entschieden:** `bei: WARNEN` gewinnt. Es sagt ausdrücklich, dass die Lieferung
so laufen soll, wie sie ist; dann gibt es nichts zu teilen. Erst wenn ein
Verstoß ein Problem **ist**, entscheidet der Mandant, was daraus folgt.

Die Alternative wäre gewesen, den Mandanten immer gewinnen zu lassen (SPEC-02
§40). Das gilt für Konsolidierungsängaben, die dieselbe Frage auf zwei Ebenen
beantworten — hier sind es zwei verschiedene Fragen.

### Voreingestellt bleibt die Lieferung ganz

Nicht, weil es besser wäre, sondern weil es das ist, was bisher geschah. Eine
Teillieferung ist eine fachliche Entscheidung: Wer aus dreitausend Zeilen 2.983
bekommt und es nicht weiß, bucht einen Monatsabschluss auf unvollständigen
Daten. Das darf nicht jemandem zustoßen, der nichts eingestellt hat.

### Ohne Ablage kein Teilen

Zum Teilen braucht der Durchgang ein Verzeichnis für Gescheitertes. Fehlt es —
oder schlägt das Schreiben fehl —, bleibt die Lieferung **ganz stehen**.

Zeilen herauszunehmen und nirgends abzulegen wäre Datenverlust, und zwar der
leiseste: Das Ergebnis sähe vollständig aus.

### Die Ablehnungsdatei ist zum Zurückgeben gemacht

Sie trägt die Spalten der Ursprungsdatei unverändert, davor zwei eigene:
`Unikom_Zeile` und `Unikom_Grund`. Beide weichen aus, falls es sie im
Kundenbestand schon gibt — sonst überschriebe ausgerechnet die Datei, die
jemand zum Fehlersuchen liest, einen echten Wert.

Die Zeilennummer ist die der **Lieferung** und nicht die Stelle in der Liste.
Bei blockweiser Verarbeitung trägt ein Block nur einen Teil der Zeilen; wer die
Stelle zählt, schreibt „Zeile 3", während der Fehler in Zeile 2003 steht — und
das sieht plausibel aus.

### Nebenbefund: eine Regel über eine Spalte, die es nicht gibt

Besteht eine Datei nur aus Text, lässt sich nicht erkennen, ob die erste Zeile
eine Kopfzeile ist; die Spalten heißen dann „Spalte 1", „Spalte 2". Eine Regel
für „kdnr" fände ihr Feld in keiner einzigen Zeile.

**Entschieden:** Solche Regeln bleiben außen vor, und der Lauf sagt welche.
Angewandt wäre jede Zeile gescheitert und die ganze Lieferung abgewiesen —
wegen fehlender Überschriften, nicht wegen der Daten.

Die saubere Lösung liegt beim Schema selbst: `Strukturvorgabe` kennt die
Spaltennamen, der Lauf benutzt sie noch nicht zum Benennen der Felder. Offen.

### Was weiter offen ist

Der **Prüfbedarf** hat noch keinen Abnehmer. Zeilen mit einem Konflikt laufen
vorerst mit — ein Konflikt ist eine Frage an einen Menschen und kein Fehlschlag,
und der Weg in den Konfliktbestand ist nicht gebaut. Sie zu Gescheitertem zu
erklären, wäre die bequeme Rechnung und der Verlust der Zusage.

---

## Runde 8 — Was um zwei Uhr nachts mit einem Konflikt geschieht (24.08.2026)

### Die Frage

Ein Konflikt entsteht in der Nachtverarbeitung. Niemand sitzt davor. Was dann?

Drei Antworten sind vertretbar, und sie widersprechen einander:

* Der Fall hängt dem Benutzer am Morgen vor der Nase, bis er entschieden ist.
* Er meldet sich einmal und wartet danach in der Glocke.
* Er meldet sich nach einer Frist erneut.

Welche richtig ist, hängt am Betrieb des Kunden — nicht an Unikom.

### Entschieden: am Mandanten, wie Meldewege und Aufbewahrungsfrist

`Tenant.konflikte` mit drei Angaben: **Vorlageart**, **Frist der Wiedervorlage**
und **ob ein Fall hingenommen werden darf**. Derselbe Ort und dieselbe
Begründung wie bei `benachrichtigung` und `ausleitungenTage`: Ein Dienstleister
betreut mehrere Kunden auf einer Maschine, und eine Einstellung für alle wäre
für niemanden die richtige.

**Voreingestellt ist die Wiedervorlage nach 24 Stunden** und nicht das lauteste.
Ein Fenster, das bei jedem Klick wiederkommt, wird nach der dritten Woche
weggeklickt, ohne gelesen zu werden — und dann ist auch das eine weg, auf das es
ankam. Wer es trotzdem so will, stellt es ein; das ist eine bewusste
Entscheidung und keine, in die jemand hineinrutscht.

### Der Mülleimer war schon da und hieß anders

Gesucht war ein Weg, einen Konflikt wegzulegen. Der Lebenszyklus aus SPEC-07
kennt ihn seit jeher: **`AKZEPTIEREN`** — „den Konflikt sehenden Auges
hinnehmen", mit Name, Zeitpunkt und Bemerkung in der Historie.

**Entschieden:** Kein neuer Zustand, sondern eine **Erlaubnis**. Der Mandant
sagt, ob weggelegt werden darf. Ist es verboten, bleibt jeder Fall offen, bis
ihn jemand bereinigt — genau das ist der Zweck.

Wer gar keine Konflikte sammeln will, braucht dafür ebenfalls keinen Schalter:
Er stellt seine Regeln auf **Fehler** statt Konflikt, dann geht die Zeile nach
Gescheitert. Dieselbe Entscheidung, an der richtigen Stelle getroffen.

### Durchgesetzt wird auf dem Server, nicht im Browser

Der Knopf verschwindet in der Oberfläche, wo das Hinnehmen verboten ist. Das
allein wäre eine Bitte und keine Einstellung: Die Prüfung sitzt in `wendeAn` —
also in der **einen** Rechnung, an der Vorschau, Entscheidung, Massenvorschau
und Massenentscheidung gleichermaßen hängen. Eine Prüfung an nur einer der vier
Türen wäre an den anderen dreien nicht vorhanden.

Ebenso die Vorlage: Welche Meldung sich von selbst zeigt, entscheidet der
Server. Der Browser vergisst beim Wechsel der Ansicht nur, was er schon gezeigt
hat — **ob** etwas kommt, sagt ihm die Antwort auf `pending`.

### Die Einstellung gilt Konflikten und sonst nichts

Wer einstellt, dass ein offener Konflikt ihm vor der Nase hängt, hat über
Konflikte entschieden — nicht darüber, wie oft ein gescheiterter Lauf sich
meldet. Zwei Dinge, zwei Adressaten. `LAUF_FEHLER` und
`VERARBEITUNG_AUSGEBLIEBEN` verhalten sich unverändert.

### Was **nicht** gebaut wurde, und warum

Gefragt war auch: „Ob nur als eine Datei ausgeliefert werden darf oder in
Teilen." Diese Einstellung wirkt erst, wenn der Lauf die Zeilen aufteilt — und
diese Naht ist noch nicht gelegt.

`Einstellungen.ts` hält dafür eine Hausregel bereit:

> Bewusst nur das, was heute auch wirkt. Ein Feld für „Verhalten bei Dubletten"
> ließe sich in fünf Minuten hinzufügen und wäre bis Etappe 6 eine Einstellung
> ohne Wirkung — also eine Behauptung auf dem Bildschirm, die niemand einlöst.

**Entschieden:** Der Schalter kommt zusammen mit der Zeilenaufteilung im Lauf.
Ein Schalter „nur vollständig ausliefern", der nichts tut, ist schlimmer als
keiner — er sieht aus wie eine Zusage.

### Nebenbefund: ein Knopf, der immer scheiterte

`moeglich()` bot einem **akzeptierten** Fall „Zurückstellen" und „Akzeptieren"
an. Der Lebenszyklus lässt von `AKZEPTIERT` nur nach `OFFEN`, `BEREINIGT` oder
`ERNEUT_VERARBEITET` — beide Knöpfe endeten in einer Absage des Servers.
Korrigiert, weil in derselben Funktion steht, warum: „Ein Knopf, der beim
Drücken einen Fehler bringt, ist schlechter als kein Knopf."

Ebenso: Die Massenentscheidung war auf **Akzeptieren** vorbelegt. Wer hundert
Fälle markiert und einmal zu schnell klickt, hätte hundert Entscheidungen
getroffen, die er nicht getroffen hat. Sie steht jetzt auf Zurückstellen.

---

## Runde 6 — Wo Unikom läuft, worin es geschrieben ist, und wer die Schemata macht (24.08.2026)

### Unikom läuft beim Kunden. Punkt.

FR_010 beschreibt einen zweiten Betriebsweg: zentrale Anwendung beim Hersteller,
ein Local Connector beim Kunden. Er ist **zurückgestellt** — nicht verworfen,
aber nicht gebaut.

**Warum:** Er bricht den Satz, der in FR_009, Abschnitt 1, verbindlich steht:
„Unikom sendet von sich aus nichts nach außen." Aus diesem Satz folgt heute,
dass es beim Hersteller nichts zu verarbeiten gibt — kein AV-Vertrag, kein
Verzeichnis von Verarbeitungstätigkeiten, keine Unterauftragnehmer, keine
Standortfrage. Mit einer zentralen Anwendung wird der Hersteller
Auftragsverarbeiter, und die Entscheidung aus FR_009, Abschnitt 10 („die
Datenbank bleibt unverschlüsselt, die Platte ist Sache des Kunden") ist nicht
mehr haltbar.

Das ist eine Produktentscheidung mit laufenden Kosten und kein Bauteil. Sie
wird getroffen, wenn ein Kunde sie verlangt — nicht vorher, und nicht nebenbei.

**Bleibt gültig für den Fall, dass sie kommt:** Zugänge und Schlüssel liegen
immer dort, wo ausgeführt wird. Eine Regel, keine Ausnahme, in jedem Betriebsweg
dieselbe.

### TypeScript bleibt

**Erwogen:** ein Neubau in Python, weil pandas Zusammenführen, Dubletten,
Typerkennung und Formatleser mitbringt.

**Entschieden: nein.** Ersetzbar wäre rund ein Fünftel von 78.000 Zeilen. Die
übrigen vier Fünftel — Übertragung, Stapel, Mandanten, Rechte, Lizenz,
Datenschutz, Verschlüsselung, Konflikte, Protokoll, Zeitplan, Oberfläche — kennt
pandas nicht. Und im ersetzbaren Fünftel liegt der Wert nicht in der Rechnung,
sondern in der Regel: `drop_duplicates` gibt es geschenkt, „Müller GmbH und
Mueller GmbH sind derselbe Kunde, aber die gefaltete Form verlässt dieses Modul
nicht" nicht.

Dazu der Maßstab, den FR_009, Abschnitt 10, schon einmal angelegt hat: Eine
SQLite-Erweiterung wurde abgelehnt, weil sie „Fremdcode in das Haus des Kunden"
gebracht hätte. numpy und pandas sind ein Vielfaches davon, kompiliert,
plattformabhängig, mit eigenem Schwachstellenstrom — in einer Installation mit
heute **drei** Abhängigkeiten.

**Die Bedingung, unter der neu entschieden wird:** ein echter Kundendatensatz,
bei dem die heutige Maschine messbar zu langsam ist. Dann wird gemessen und über
einen Beiprozess für genau diese Rechnung geredet — nicht über einen Neubau.

### Schemata entstehen aus einer Datei, nicht aus einem Formular

**Verworfen:** das JSON Schema als Eingangsprüfung. Niemand schreibt es von
Hand, und wer es täte, bekäme für `$ref`, `allOf` und `if/then` ohnehin nur die
Meldung, dass Unikom sie nicht prüft.

**Entschieden:** Was es ersetzt, gibt es schon — das **Eingangsprofil** am
Mandanten, benannt, versioniert, unveränderlich. Es bekommt eine Oberfläche mit
fünf Reitern (Allgemein, Aufbau, Spalten, Werte, Schlüssel) und wird im
Konsolidierungsschritt ausgewählt, wo heute nach einer Datei gefragt wird.

Der Reiter „Spalten" trägt, was das JSON Schema trug — Pflicht, Typ, Wertebereich,
Länge, Muster, erlaubte Werte —, aber als Tabelle und **vorbefüllt aus der
Erkennung einer Beispieldatei**. Das ist der Punkt: Ein Profil entsteht daraus,
dass ein Mensch eine erkannte Struktur bestätigt, und nicht daraus, dass er sie
tippt.

Die alte JSON-Prüfung bleibt stehen, bis der Reiter dasselbe leistet. Ein
Ersatz, der erst hinterher gebaut wird, ist kein Ersatz.

### Ohne Schema wird gerechnet, aber nicht geraten

Wird kein Schema gewählt, kommen **alle** Spalten mit. Bei mehreren Dateien wird
ein verbindendes Merkmal gesucht: eine Spalte, die in allen Dateien vorkommt, in
jeder eindeutig ist und deren Werte sich tatsächlich überschneiden. **Genau ein
Kandidat** heißt eindeutig; keiner oder mehrere heißt: alle Dateien nach
Gescheitert, mit Nennung der Kandidaten im Protokoll.

Das steht nicht gegen SPEC-04, Abschnitt 7 („Unikom darf fachliche
Dublettenschlüssel nicht eigenmächtig als verbindliche Wahrheit bestimmen"),
sondern erfüllt es: Unikom entscheidet nichts, es findet entweder genau eine
Antwort oder weigert sich.

### Das Archiv trägt kein Passwort

**Verworfen:** das passwortgeschützte ZIP. ZIP legt nicht fest, in welchen Bytes
ein Passwort verarbeitet wird — ein Umlaut ergibt beim einen Werkzeug einen
anderen Schlüssel als beim anderen —, und die Dateinamen bleiben darin lesbar,
weil das zentrale Verzeichnis nie mitverschlüsselt wird.

**Entschieden:** ein schlichtes ZIP, als Ganzes mit AES-256-GCM eingeschlagen,
mit dem Umschlag, den Unikom überall benutzt. Damit liegen auch die Namen innen.
Der Preis: Das Archiv öffnet kein Fremdwerkzeug mehr.

Das Archiv ist zugleich die Rechtfertigung dafür, dass das Arbeitsverzeichnis
hinterher geräumt werden darf. **Was nicht archiviert ist, wird nicht gelöscht** —
und geräumt wird nur, was der Lauf selbst hineingelegt hat, nie das Verzeichnis.
Ein Tippfehler im Pfad soll keine fremden Daten kosten.

### Offen: drei Bestände ohne Frist

FR_009, Abschnitt 2, sagt: „ein Bestand, der hier fehlt, darf nicht entstehen."
Abschnitt 4: „Eine Frist ohne Voreinstellung ist keine."

**Es fehlen: Archiv, Erledigt und Gescheitert.** Gescheitert liegt schon heute
unbefristet da — Eingangsdateien mit vollem Personenbezug, auf die die
Voreinstellung „nach Verarbeitung entfernen" nicht greift, weil sie nie
verarbeitet wurden. Erledigt bekommt ab jetzt zusätzlich abgeleitete
Zeilendateien, Archiv die vollständigen Originale.

Das ist vor dem Archiv-Bau zu schließen, nicht danach.

---

## Runde 5 — Beide Prozesse schreiben (20.08.2026)

**Entschieden:** Server und Worker schreiben beide in Unikoms eigene SQLite.
Nicht in fremde Datenbanken — das bleibt Modul 3 (Runde 3); hier geht es um den
eigenen Bestand.

```text
[Server]  Einstellungen, Mandanten, Benutzer, Profile,     ──┐
          Zuordnungen, Konfliktentscheidungen, Freigaben     ├──> unikom.db
[Worker]  Läufe, Dateien, Protokoll, Herzschlag,           ──┘
          Benachrichtigungen, Ergebnisstände
```

**Warum nicht „nur der Server schreibt":** Das wäre die aufgeräumtere Zeichnung
und die schlechtere Lösung. Der Worker schreibt am laufenden Band — jede
Protokollzeile, jeder Fortschritt, jeder Statuswechsel. Ginge das über den
Server, hinge die Verarbeitung an dessen Verfügbarkeit, und SPEC-01, Abschnitt
13, verlangt einen Worker, der **vollständig unabhängig** arbeitet. Ein
Nachtlauf, der abbricht, weil jemand die Oberfläche neu gestartet hat, wäre
genau das Gegenteil.

SQLite lässt im WAL-Modus einen Schreiber gleichzeitig zu; Leser stören nicht.
`busy_timeout` steht bereits. Die Aufteilung oben ist keine Sperre, sondern eine
Zuständigkeit: Beide dürfen technisch überall schreiben, die Regel sagt, wer es
tut. Wo beide dieselbe Zeile anfassen könnten, entscheidet die Fassung am
Datensatz — dasselbe Mittel wie in der Konfliktbearbeitung.

**Die eine Regel, die dafür gelten muss:** *Keine Transaktion über eine
Wartezeit hinweg.* Wer eine Transaktion offen hält, während er auf einen
SFTP-Server, eine Datei oder einen Benutzer wartet, sperrt den anderen Prozess
für die ganze Dauer aus — bei einem Zeitüberlauf sind das dreißig Sekunden, in
denen die Oberfläche nichts speichern kann. Schreiben heißt deshalb: sammeln,
dann in einem kurzen Zug schreiben.

**Folgen:** `npm run worker` startet den zweiten Prozess. Er räumt beim Start
zuerst auf — Läufe, die auf `RUNNING` stehen, ohne dass sich jemand für sie
meldet — und beginnt dann sein Lebenszeichen. Der Server tut dasselbe; wer
zuerst hochkommt, darf keine Rolle spielen.

---

## Runde 4 — Ausliefern ist ein Schritt, nicht zwei (20.08.2026)

**Entschieden:** „Daten importieren" und „Daten konvertieren" sind **ein**
Kettenglied mit einer Verzweigung:

```text
Daten exportieren/importieren
  ├─ in eine Datenbank importieren        Lizenz „Daten importieren"
  └─ als Datei exportieren                Ergebnis-Verzeichnis
       └─ optional: vorher konvertieren   Lizenz „Daten konvertieren"
```

**Warum:** Die beiden waren als zwei aufeinander folgende Glieder modelliert,
und das ergibt keine Kette. Wer in eine Datenbank importiert, konvertiert davor
keine Datei; wer eine Datei ausliefert, importiert nichts. Nebeneinander
gestellt, las das Konvertieren aus dem Import — der Tabellen füllt und **keine
Datei hinterlässt**. Bei voller Lizenz stand also im Editor eine Kette, die so
nie laufen konnte.

SPEC-01, Abschnitt 32, führt Modul 3 ohnehin als *ein* Modul: „Daten
exportieren/importieren" mit Zielstrukturen, Zielformaten, Datenbankimport und
Exportformaten.

**Ein Schritt, zwei Lizenzen.** Der Zweig entscheidet, welche gilt. Ein
unveränderter Export verlangt **eine von beiden** — er ist selbst weder
Konvertierung noch Datenbankimport, aber ganz ohne Modul 3 dürfte keine Datei
hinausgehen (Runde 3). Dafür gibt es `eineGenuegt`: Aus dem Oder darf keine
Und-Prüfung werden, sonst könnte ein Kunde mit nur einer Hälfte nichts
ausliefern.

**Ergebnis-Verzeichnisse.** Wo nach einem Glied nichts mehr folgt, verlangt es
ein eigenes Verzeichnis — auch die Konsolidierung. Ein Kunde, der nur Modul 2
gekauft hat, muss an sein Ergebnis kommen. Der Datenbankimport ist die einzige
Ausnahme: Er schreibt in Tabellen.

**Folgen:**

1. **Ein Fehler fiel dabei auf und ist behoben.** Ein Kunde ohne „Daten
   übertragen" konnte **gar keinen Workflow anlegen**: Beim Übertragen heißt
   „fehlt" = *an* — eine Regel für Workflows aus der Zeit, als das Glied noch
   nicht abschaltbar war —, und das Speichern verlangte daraufhin ein Modul, das
   er nie gekauft hatte. Ein neuer Workflow setzt jedes Glied jetzt ausdrücklich.

2. **Gespeicherte Workflows werden beim Lesen übersetzt**, nicht in einer
   Migration: Ein Workflow wird weit öfter gelesen als geschrieben, und einer,
   der nie wieder gespeichert wird, behielte sonst für immer seine alte
   Schreibweise. War beides eingeschaltet, gewinnt der Datenbankimport — er ist
   der Zweig, der ein fremdes System berührt.

3. **Voreinstellung: alle gekauften Module angehakt.** Ein Kunde, der drei
   Module besitzt und nur eines angehakt sieht, hält die anderen leicht für
   nicht vorhanden. Der Preis sind mehrere Schritte ohne Verzeichnis — das ist
   der bessere Preis: Ein sichtbar leeres Feld fordert zum Ausfüllen auf, ein
   Modul, das man nicht sieht, fordert zu gar nichts auf.

4. **Der Zweig ist voreingestellt die Datei**, auch bei voller Lizenz. Ein
   Export legt eine Datei ab, die man ansehen und wegwerfen kann; ein
   Datenbankimport berührt ein fremdes System und soll ausdrücklich gewählt
   werden.

**Verworfen: das Log-Verzeichnis.** Kurz erwogen, ein Protokollverzeichnis an
jeden Workflow zu hängen — und wieder fallengelassen.

Das Protokoll liegt in der Datenbank und übersteht dort den Neustart. Wer es aus
dem Haus geben oder über die Aufbewahrungsfrist hinaus behalten will, holt es
sich auf Knopfdruck als Datei und bestimmt **in diesem Augenblick**, wohin
(`GET /api/runs/:id/protokoll`, Knopf „Protokoll speichern" in der Laufansicht).

Ein eingestelltes Verzeichnis wäre die schlechtere Lösung, und zwar zweifach:
Es schriebe von jedem Lauf eine Datei, die niemand angefordert hat — auch von
den tausend, bei denen nichts passiert ist —, und es machte aus dem Protokoll
einen zweiten Bestand neben der Datenbank, mit der Frage, welcher im Zweifel
gilt. Genau diese Frage hat SPEC-07 für die Konflikte schon einmal beantworten
müssen (Version 1.1); sie ein zweites Mal aufzumachen, wäre ein Rückschritt.

Der Speicherknopf lädt die Datei über den Browser herunter. Wo sie landet,
entscheidet dessen Einstellung — entweder der Download-Ordner oder ein
Speichern-Dialog. Das ist die Stelle, an der der Benutzer den Pfad angibt.

**Offen:** Modul 3 selbst — Verbindung, Zieltabelle und Schreibstrategie
(SPEC-10 §2 und §3). Der Zweig steht im Editor, die Verarbeitung dahinter folgt
später.

---

## Runde 3 — Nur Modul 3 schreibt hinaus (20.08.2026)

**Entschieden:** In fremde Datenbanken schreibt ausschließlich Modul 3, und der
endgültige Export beziehungsweise Import ebenso. Die Konsolidierung endet beim
**freigegebenen Ergebnisstand**; was danach kommt, holt sich Modul 3 über eine
einzige Übergabe.

**Warum:** Es ist keine Zuständigkeitsfrage, sondern eine Sicherung. Ein Modul,
das mitten in der Verarbeitung schon in die Zieldatenbank schreiben *könnte*,
schreibt irgendwann bei einem halben Ergebnis hinein — und dann steht dort ein
Bestand, den niemand freigegeben hat und den niemand zurücknehmen kann. Mit der
Trennung gibt es diesen Weg nicht: Modul 2 hat gar keine Möglichkeit, etwas
hinauszuschreiben.

Die Specs sagten es bereits — SPEC-03, Abschnitt 9 („Innerhalb der
Konsolidierung ist eine Datenbank ausschließlich Quelle"), SPEC-10, Abschnitt 1
(„Modul 2 schreibt nur seinen eigenen Ergebnisbestand"). Im Code hielt das aber
nichts fest. Ein Satz in einer Spec hält niemanden auf, der in Eile ist.

**Nachgeschärft am selben Tag — die Regel gilt nach Art der Daten:**

```text
Unikom-intern           Einstellungen, Regeln, Bedingungen, Profile,
(Verarbeitungsablauf)   Zuordnungen, Konfliktentscheidungen
                        →  immer und überall schreibbar

Migration und Export    Daten verlassen das Haus
                        →  nur, wenn Modul 3 gekauft **und** angehakt ist
```

Die Trennung ist die zwischen **Verwalten** und **Ausliefern**. Wer keine
Auslieferung gekauft hat, soll trotzdem einrichten, prüfen und entscheiden
können — sonst wäre eine Installation ohne Modul 3 nicht bedienbar, obwohl die
Konsolidierung, die sie gekauft hat, vollständig arbeitet. Und wer vor dem Kauf
schon vorbereiten will, was danach laufen soll, muss das können.

Zwei Bedingungen, nicht eine: **gekauft** steht an der Installation (Lizenz),
**angehakt** am Workflow (der eingeschaltete Schritt). Ein gekauftes, aber
abgeschaltetes Modul ist eines, das der Benutzer für diesen Lauf ausdrücklich
nicht wollte. Beides bildet Unikom schon ab — `FeatureSet` und `stageIsActive`;
die Übergabe fragt jetzt beides.

Modul 3 hat zwei Hälften, die getrennt gekauft und getrennt angehakt werden:
*Daten importieren* (in Tabellen laden) und *Daten konvertieren* (in ein anderes
Format schreiben). Für die Übergabe genügt **eine** von beiden — es geht darum,
ob überhaupt jemand da ist, der die Daten annimmt.

**Folgen:**

1. **Eine Tür, und sie ist verschlossen.** `GET /api/results/:id/handover`
   liefert einen freigegebenen Stand oder eine Begründung, warum nicht. Die
   Prüfung steht in Modul 2 und nicht in Modul 3: Wer die Zusage von der Seite
   abhängig macht, die sie einhalten soll, hat keine Zusage. Ohne `jobId` lässt
   sich das Häkchen nicht prüfen; dann prüft die Übergabe nur die Lizenz und
   **sagt das** im Feld `geprueft`. Stillschweigend „angehakt" anzunehmen hieße,
   eine Bedingung wegzulassen und trotzdem zu behaupten, sie sei geprüft worden.

2. **Die Übergabe reicht Kopien heraus**, keine Referenzen auf den Bestand.
   Sonst könnte Modul 3 einen historischen Ergebnisstand von außen verändern —
   und dann wäre er keiner mehr.

3. **Ein Test hält die Grenze.** `src/domain/result/Modulgrenze.test.ts` liest
   den Quelltext der zwölf Verzeichnisse von Modul 2 und schlägt an, sobald dort
   ein Dateischreibzugriff, ein Datenbankzugriff, ein Ziel-Adapter aus Modul 1
   oder eine schreibende SQL-Anweisung auftaucht. Nicht, weil heute jemand das
   vorhätte — sondern weil in zwei Jahren jemand „nur schnell" eine Zieltabelle
   füllen will und die Stelle, an der es auffällt, sonst erst beim Kunden liegt.

**Offen bleibt** die Frage, die diese Entscheidung nicht beantwortet: Welcher
**Prozess** darf in Unikoms eigene SQLite schreiben, sobald mit Etappe 8 ein
zweiter dazukommt? Das ist eine Frage der Nebenläufigkeit und nicht der
Modulgrenze — sie steht weiter als Vorbedingung an Etappe 8.

---

## Runde 2 — Kein Zugriff auf Postfächer (19.08.2026)

**Entschieden:** Unikom holt keine Nachrichten aus Postfächern. Eine Regel im
Mailsystem des Kunden legt sie als Datei in ein Verzeichnis; von dort holt
Unikom sie mit der vorhandenen Abholung.

**Warum:** Ein Postfachzugang berechtigt zu allem, was darin liegt. Technisch
ließe sich auf einen Ordner beschränken — die Zugangsdaten tun es nicht. Damit
lägen Kennwörter fremder Postfächer in Unikoms Verwahrung, und der Zugriff auf
Nachrichten Dritter wäre jederzeit möglich. Mit der Regel im Mailsystem
entscheidet der Kunde in seinem eigenen System, was Unikom überhaupt sieht.

**Folgen:** FR_007 Abschnitt 11 und 12 sind angepasst (Version 1.1). Der
IMAP-Client entfällt ersatzlos; die Erkennung selbst ändert sich nicht. Offen
ist, ob `.msg` — das Format, das beim Ziehen aus Outlook entsteht — gelesen
werden soll oder ob der Kunde als `.eml` speichert.

**Daraus entstanden:** FR_009 — Datenschutz und Datenhaltung. Die Frage hinter
der Entscheidung war größer als die Entscheidung: Was speichert Unikom
eigentlich, wie lange, und wie wird man es wieder los. Die Antwort fehlte, und
die dafür nötige Funktion — ein Löschauftrag über alle Bestände — gibt es bis
heute nicht.

---

## Runde 1 — Widerspruchsprüfung SPEC-01 bis SPEC-09

Geprüft am 19.08.2026. Gegenstand: die neun Konsolidierungs-Specs SPEC-01 bis
SPEC-09, alle im Status FINAL. SPEC_00 (UX-Grundregel) war nicht Gegenstand der
Prüfung.

Aufgenommen ist nur, wo zwei Aussagen **einander ausschließen** oder wo eine
Aussage etwas voraussetzt, das eine andere verbietet. Unschärfen, Lücken und
Wiederholungen stehen nicht darin, außer sie sind die Ursache eines
Widerspruchs.

Zitate sind wörtlich; die Abschnittsnummern sind die der jeweiligen Spec und
beziehen sich auf die **Fassung 1.0** — also den Stand vor der Überarbeitung.

---

## Bearbeitungsstand (19.08.2026)

| Punkt | Stand |
| --- | --- |
| A1 — KI ohne Architektur | **erledigt.** KI ist nicht Bestandteil von V1; Ausbaustufe in SPEC-11. Geändert: 01, 04, 08, 09; neu: SPEC-11 |
| A2 — Datenbank als Ziel | **erledigt.** SPEC-03 §10–12 wörtlich nach SPEC-10 (Modul 3) umgezogen |
| A3 — Freigabe des Nachtlaufs | **erledigt.** Automatische Freigabe, wenn nichts blockiert; Status WAITING_FOR_RELEASE. Geändert: 01, 02, 08 |
| A4 — zwei Mapping-Vorrangketten | **erledigt.** Mandant vor Profil vor Allgemein; Feststellungen sind nicht überschreibbar. Geändert: 01, 02, 03 |
| A5 — Lernen gegen Versionierung | **erledigt.** Wertmapping lernt frei, Feldmapping wird bestätigt; Anwenden ist nicht Regel werden. Geändert: 02, 05, 09 |
| A6 — Hauptdatei gegen Append | **erledigt.** Anreichern mit führender Quelle, Sammeln ohne. Geändert: 02, 06 |
| A7 — Konflikte: Datenbank oder Datei | **erledigt.** SQLite führt, Dateien sind Ausleitungen. Geändert: 01, 02, 07 |
| B2 — Konfliktdatei bereinigen/erhalten | **erledigt** als Folge von A7 |
| B1 — Originaldatei löschen | **erledigt.** Die Konsolidierung fasst sie nicht an; Aufbewahrung ist Sache von Modul 1. Geändert: 07 |
| B3 — Stichprobe | **erledigt.** Regelfall 100, Erweiterung bis 1.000, danach gilt die Erkennung als unsicher. Geändert: 02 |
| B4 — die 97 % | **erledigt.** Untergrenze, nach oben konfigurierbar. Geändert: 02, 05 |
| B5 — konkurrierende Werte | **erledigt.** Automatisch bei erreichter Schwelle und festgehaltener Begründung, sonst Konflikt. Geändert: 06 |
| B6 — Quellenpriorität | **erledigt.** Die eingestellte Priorität gilt; Widerspruch erzeugt einen Prüffall. Geändert: 04, 09 |
| B7/B8 — Benachrichtigungen | **erledigt.** Eine verbindliche Stufen- und Kanaltabelle in SPEC-01 §21. Geändert: 01, 02, 03 |
| B9 — was die Konfliktbearbeitung erzeugt | **erledigt.** Immer ein neuer Verarbeitungslauf mit eigener Kennung. Geändert: 06, 07 |
| B10 — Lauf-Kennung | **erledigt.** RUN-JJJJ-MM-TT-NNNNNN, ein Begriff: Verarbeitungs-ID. Geändert: 01, 03 |
| C — Begriffe | **erledigt.** Begriffstabelle in SPEC-01 §34 |
| D1 — Freigaberecht | **erledigt.** Bestätigen ist Arbeit, Freigeben einer Version ist Administratorsache. Geändert: 05 |
| D2 — Verzeichnisstruktur und Datenbankname | **erledigt.** SPEC-01 §12 beschreibt das einstellbare Datenverzeichnis samt Aufbau; neu §12.1 (lokale Platte) und §12.2 (Sicherung) |

Geänderte Specs tragen Version 1.1 und am Ende ein Änderungsverzeichnis, das
Änderung und Grund nennt.

---

## A — Widersprüche, die die Architektur betreffen

### A1. KI trägt SPEC-08 und SPEC-09, kommt in der Architektur nicht vor — und kollidiert mit der On-Premise-Zusage

**SPEC-09**, Grundprinzip: „Das Mapping in UniCom soll **intelligent statt
regelintensiv** funktionieren." UniCom soll u. a. aus „KI-gestützter Analyse"
selbstständig ein Mapping erzeugen; §3 nennt „KI-gestützte semantische
Erkennung" als Erkennungsgrundlage.

**SPEC-08** §4: „Hierzu kann KI-gestützte Erkennung eingesetzt werden."
§9 stuft Warnungen und Fehler u. a. anhand „KI-gestützter Erkennung" ein.

**SPEC-01** nennt KI mit **keinem Wort** — weder in §2 (Architekturbild) noch in
§3 (Komponenten der lokalen Umgebung: Application, Processing Worker,
Notification Agent, SQLite, JSON, Logs, temporäre Dateien, Archive) noch in §33
(verbindliche Architekturgrundsätze).

**SPEC-01** §3: „Die Kundendaten verlassen die lokale Umgebung nicht, sofern der
Kunde selbst eine externe Datenquelle oder ein externes Datenziel
konfiguriert." §30: „Die Architektur setzt nicht voraus, dass Kundendaten in
einer externen Cloud-Datenbank gespeichert werden."

**SPEC-04** §9 verweist auf „die bereits definierten Modi" (KI AUS / Nur
Vorschläge / Automatisch). Diese Modi sind in SPEC-01, SPEC-02 und SPEC-03
**nirgends definiert** — der Verweis geht ins Leere.

**Warum das ein Widerspruch ist:** Semantische Erkennung braucht ein Modell.
Läuft es lokal, fehlt es in SPEC-01 §3 als Komponente samt Ressourcenbedarf
(SPEC-06 §15 steuert Ressourcen, ohne ein Modell zu kennen). Läuft es entfernt,
verlassen Feldnamen und Werte das Haus — und das schließt SPEC-01 §3/§30 aus,
ohne dass der Kunde eine externe Quelle konfiguriert hätte.

**Zu entscheiden:** (1) KI als Komponente in SPEC-01 aufnehmen, (2) die drei
Modi an einer Stelle definieren, (3) festlegen, ob und welche Daten das Haus
verlassen dürfen — Feldnamen allein, Feldnamen mit Stichprobe, oder nichts.

---

### A2. Die Datenbank als **Ziel** steht in der Konsolidierungs-Spec, gehört nach der Architektur aber zu Modul 3

**SPEC-03** (Modul: Daten konsolidieren) §10 „Datenbank als Ziel", §11
Schreibstrategien INSERT/UPDATE/UPSERT, §12 Abgleichsschlüssel für vorhandene
Datensätze, §19 Preflight prüft „Ziel vorhanden bzw. anlegbar,
Schreibberechtigung vorhanden".

**SPEC-01** §4.3: „Die endgültige Zieldatenstruktur gehört zum Modul Daten
exportieren/importieren und **nicht** zur Eingangsstruktur des
Konsolidierungsmoduls." §32 ordnet „Zielstrukturen, Zielformate,
Datenbankimport, Exportformate" ausdrücklich Modul 3 zu.

**Warum das ein Widerspruch ist:** Entweder schreibt Modul 2 selbst in
Zieldatenbanken — dann ist die Modultrennung durchbrochen und ein Kunde, der
nur Modul 2 lizenziert hat, bekommt die Fähigkeit von Modul 3 geschenkt. Oder
SPEC-03 §10–§12 gehören in die Modul-3-Spec.

---

### A3. Die Zieldatei braucht eine Benutzerfreigabe — der geplante Nachtlauf hat keinen Benutzer

**SPEC-08** §13: „Die endgültige Zieldatei darf erst nach Erfüllung der
definierten Freigabebedingungen als gültiges Ergebnis freigegeben werden." Die
Freigabe ist zu dokumentieren „einschließlich: Verarbeitungslauf,
Ergebnisstand, Zeitpunkt, **Benutzer**, zugrunde liegende Validierungsergebnisse".

**SPEC-01** §24: geplante Verarbeitung, Beispiel „Erwarteter Start: 02:00".
§18: „Das Schließen des Browsers darf eine laufende Verarbeitung nicht
beenden." **SPEC-02** §50: „Die Verarbeitung darf niemals von einem geöffneten
Browser abhängig sein." **SPEC-03** §22: Background-Betrieb ohne Oberfläche.

**Warum das ein Widerspruch ist:** Um zwei Uhr nachts ist kein Benutzer da, der
freigibt. Das Ergebnis bleibt bis zum Morgen ungefreigegeben — für diesen
Zustand hat der Statuskatalog **SPEC-01 §14** keinen Namen (weder
WAITING_FOR_RELEASE noch RELEASED; COMPLETED würde eine Freigabe behaupten, die
es nicht gibt). Zugleich verlangt **SPEC-02 §38**, dass Modul 3 nicht mit einem
unvollständigen Ergebnis von Modul 2 startet — darf es ein ungefreigegebenes
abholen?

**Zu entscheiden:** Freigabe automatisch, sobald keine blockierenden Fälle offen
sind, und nur bei Vorbehalt auf einen Menschen warten. Dann ist SPEC-08 §13 zu
präzisieren und SPEC-01 §14 um den Wartestatus zu ergänzen.

---

### A4. Mapping hat zwei Heimaten und zwei Vorrangketten

| Quelle | Ebenen | Vorrang |
| --- | --- | --- |
| SPEC-01 §27 | global, mandantenspezifisch | Mandant vor global |
| SPEC-02 §16 (Mapping) | mandantenspezifisch, allgemein | Mandant vor allgemein, **kein Profil** |
| SPEC-02 §40 | Allgemein → Mandant → **Profil** | die spezifischere Ebene gewinnt, also Profil vor Mandant |
| SPEC-03 §21 | Mandant, Allgemein | Mandant vor Allgemein, **kein Profil** |
| SPEC-04 §11 / SPEC-05 | Mapping ist Bestandteil des versionierten **Profils** bzw. eine eigenständige versionierte Definition | — |

Das Wort „Profil" kommt in **SPEC-01 kein einziges Mal** vor.

**Warum das ein Widerspruch ist:** Liegt für einen Mandanten ein Mapping vor und
im verwendeten Profil ein anderes, sagt SPEC-02 §16 „Mandant gewinnt" und
SPEC-02 §40 „Profil gewinnt". Beides steht in derselben Spec.

---

### A5. Selbstlernende Mappings gegen unveränderliche, freigabepflichtige Versionen

**SPEC-02** §17: „UniCom darf aus Benutzerentscheidungen lernen." Mappings
entstehen u. a. durch „ausreichend sichere automatische Entscheidungen" und
speichern „Confidence, Anzahl der Bestätigungen" — beides ändert sich mit jedem
Lauf. §19 gibt dem Benutzer eine Verwaltung dieser lernenden Regeln.

**SPEC-05** §3: „Änderungen an bereits verwendeten Definitionen erzeugen eine
neue Version." §9: „Bereits verwendete oder freigegebene Versionen sind
unveränderlich"; Erstellen, Ändern, Freigeben, Aktivieren und Deaktivieren sind
rechtegesteuert. §10: „Für neue produktive Verarbeitungsläufe darf ausschließlich
eine eindeutig gültige und aktive Version verwendet werden."

**Warum das ein Widerspruch ist:** Entweder erzeugt jede Lernbewegung eine neue,
freizugebende Version — dann lernt das System nicht mehr selbst, sondern legt
Anträge vor. Oder es schreibt am aktiven Bestand weiter — dann ist die
Versionskette und mit ihr SPEC-05 §13 (Revisionssicherheit) gebrochen.

**Zusätzlich zur Ablage:** SPEC-02 §47 legt Mapping-Konfigurationen in **JSON**
ab und Benutzerentscheidungen in **SQLite**. Der Bestätigungszähler eines
gelernten Mappings ist beides zugleich, und SPEC-01 §11 zieht die Grenze
ausdrücklich: „JSON beschreibt, wie UniCom arbeiten soll. SQLite beschreibt, was
tatsächlich passiert ist."

---

### A6. Die Hauptdatei ist Pflicht (SPEC-02) und in der Mehrdateien-Spec verschwunden (SPEC-06)

**SPEC-02** §26: „Für jede Dateigruppe wird **genau eine Hauptdatei** definiert."
§27: „Die Hauptdatei darf nicht automatisch durch UniCom erraten werden. Sie muss
in der Mandanten-/Profildefinition eindeutig festgelegt sein." §30: „Existiert
für einen Datensatz der Zusatzdatei kein Referenzdatensatz in der Hauptdatei,
darf UniCom standardmäßig keinen neuen Hauptdatensatz erzeugen. Standardverhalten:
Fehlender Referenzdatensatz → Konflikt."

**SPEC-06** — die Spec, die genau diesen Fall regelt — enthält das Wort
„Hauptdatei" **nicht**. §3 arbeitet mit einem Konsolidierungsschlüssel, §4
unterscheidet Append und Merge: „Beim Append werden Datensätze mehrerer Quellen
in einen gemeinsamen Datenbestand übernommen."

**Warum das ein Widerspruch ist:** Append ist genau das Erzeugen von Datensätzen
ohne Referenz in einer Hauptdatei. Nach SPEC-02 §30 wäre jeder solche Datensatz
ein Konflikt — ein Append über zwei gleichartige Dateien erzeugte damit
ausschließlich Konflikte.

---

### A7. Konflikte liegen in der Datenbank **und** in Dateien — welcher Bestand führt, steht nirgends

**In SQLite:** SPEC-01 §11.2 („Konflikte, Benutzerentscheidungen"), SPEC-02 §47,
SPEC-03 §17.

**In Dateien:** SPEC-01 §12 (Verzeichnis `conflicts\`) und §23 („Konfliktdatei"),
SPEC-02 §25 („die eindeutige Zuordnung muss auch über … das automatisch erzeugte
**Dateinamensschema** gewährleistet sein"), SPEC-07 Dateimodell mit
**Konfliktdatei** und **Konfliktzieldatei**, die die Konflikt-UUID tragen.

**Warum das ein Widerspruch ist:** SPEC-07 §9 verlangt Suchen, Filtern und
Gruppieren über Konflikt-UUID, Quelle, Konfliktart, Status, betroffene Felder,
Kritikalität und Zeitinformationen; §10 verlangt einen gespeicherten
Bearbeitungsfortschritt je Benutzer, der einen Neustart übersteht; §11 verlangt
Bearbeitungssperren. Das ist Datenbankarbeit. Ein Dateibestand kann das nur mit
einem Index — und dann gibt es dieselbe Information zweimal, ohne Angabe,
welche im Zweifel gilt.

---

## B — Punktuelle Widersprüche

**B1. Originaldatei löschen.**
SPEC-02 §21: „Eine Originaldatei darf von UniCom niemals verändert, überschrieben
oder **gelöscht** werden. Dies ist eine unveränderliche Grundregel." — und §42
führt sie unter den Regeln, die Mandanten und Profile nicht außer Kraft setzen
dürfen.
SPEC-07 §5: „Die Originaldatei **kann abhängig von der Konfiguration** ebenfalls
aufbewahrt werden." Das räumt der Konfiguration das Gegenteil ein.

**B2. Konfliktdatei aufbewahren oder bereinigen — innerhalb von SPEC-07.**
§5: „Arbeitsdateien, **Konfliktdateien**, Konfliktzieldateien und sonstige
Zwischen-Dateien werden nach erfolgreichem Abschluss des Verarbeitungslaufs
gemäß einer konfigurierbaren Aufbewahrungsfrist automatisch bereinigt."
§13: „Die ursprüngliche Konfliktdatei und ihre Bearbeitungshistorie bleiben als
nachvollziehbarer Bestand erhalten." §12 verlangt dazu eine **unveränderbare**
Dokumentation über den gesamten Lebenszyklus des Konfliktfalls.

**B3. Stichprobengröße — innerhalb von SPEC-02 §4.**
„Die maximale Stichprobengröße beträgt: 100 Datensätze" gegen „Umgekehrt muss
UniCom die Stichprobe **erweitern**, wenn die bisherige Datenbasis keine
ausreichend sichere Aussage erlaubt." Ein Maximum, das überschritten werden
muss, ist keines. Zu klären: Obergrenze der Erweiterung.

**B4. Die 97 %.**
SPEC-02 §5: „Die zentrale Schwelle beträgt: 97 % Konfidenz. … Alles darunter wird
grundsätzlich dem Benutzer zur Entscheidung vorgelegt bzw. als Konflikt
behandelt." Die Zahl steht in allen neun Specs genau einmal.
SPEC-04 §9: die KI darf automatisch entscheiden, „wenn die **konfigurierte**
Confidence-Schwelle erreicht ist". SPEC-05 §5: „explizit konfigurierte
Schwellenwerte" beim Fuzzy Matching. SPEC-08 §4 und SPEC-09 arbeiten mit
„eindeutig / wahrscheinlich / mehrdeutig" ganz ohne Zahl.
Zu klären: Ist 97 % eine Untergrenze, die keine Konfiguration unterschreiten
darf, oder eine Voreinstellung?

**B5. Konkurrierende Werte ohne konfigurierte Regel.**
SPEC-06 §5: „Bei konkurrierenden Werten aus mehreren Quellen entscheidet UniCom
**nicht eigenständig** über die fachliche Priorität. … Ohne eine eindeutige
konfigurierte Entscheidungsregel wird ein Konflikt erzeugt."
SPEC-09 §7: UniCom bewertet u. a. „Häufigkeit der Werte" und „Datenqualität";
„Kann daraus eine ausreichend sichere und nachvollziehbare Entscheidung
abgeleitet werden, soll UniCom die Werte **möglichst automatisch
konsolidieren**." Derselbe Fall, zwei entgegengesetzte Anweisungen.

**B6. Quellenpriorität.**
SPEC-04 §8 legt eine feste Rangfolge fest: explizite Benutzerregel →
feldspezifische Regel → Quellenpriorität → Aktualitätsregel → Standardregel →
Konflikt.
SPEC-09 §6: „Eine definierte Quellenpriorität darf **nicht blind angewendet**
werden, wenn andere verfügbare Informationen eindeutig gegen deren Verwendung
sprechen." Damit schlägt Aktualität die Quellenpriorität — in SPEC-04 steht sie
darunter.

**B7. Benachrichtigung bei erfolgreichem Lauf.**
SPEC-01 §21, Stufe Information („Verarbeitung erfolgreich abgeschlossen"):
„Keine aufdringliche Popup-Anzeige erforderlich."
SPEC-02 §51: „Eine erfolgreiche Verarbeitung **kann optional** ebenfalls per
E-Mail gemeldet werden."
SPEC-03 §23: „Der Benutzer **muss** aktiv informiert werden, wenn: … ein Lauf
abgeschlossen wurde" — und „soll … das UniCom-Fenster automatisch
angezeigt/geöffnet werden".

**B8. E-Mail bei Konflikten.**
SPEC-01 §21, Stufe „Aktion erforderlich": „optional E-Mail".
SPEC-02 §51 für „neu entstandener Konfliktbestand": „Die Benachrichtigung
erfolgt **mindestens** über: E-Mail, lokale System-/Desktop-Benachrichtigung."

**B9. Was eine Konfliktbearbeitung erzeugt.**
SPEC-01 §9, SPEC-02 §24, SPEC-03 §15: einen **neuen Verarbeitungslauf mit
eigener Processing-ID**, die ursprüngliche referenziert.
SPEC-07 §13: „Ein erneuter Verarbeitungslauf erzeugt einen neuen
**Verarbeitungsschritt**."
SPEC-06 §14: eine gezielte Korrektur einzelner Werte oder Datensätze erzeugt
„einen neuen **Ergebnisstand** bzw. eine dokumentierte Korrektur" — dem steht
SPEC-02 §24 entgegen: „Bearbeitete Konfliktdatensätze werden nicht rückwirkend in
den ursprünglichen Verarbeitungslauf eingefügt."

**B10. Format und Name der Lauf-Kennung.**
SPEC-01 §8: „Processing-ID … Beispiel: `UC-2026-000123`".
SPEC-03 §14/§24: „Verarbeitungs-ID … Beispiel: `RUN-2026-08-18-000471`".
SPEC-02 §39 führt zusätzlich eine „übergeordnete Workflow-ID" ein.

---

## C — Dieselbe Sache, verschiedene Wörter

Kein Widerspruch im Wortsinn, aber die häufigste Ursache dafür, dass am Ende
zwei Dinge gebaut werden:

| Sache | Benennungen |
| --- | --- |
| Kennung eines Laufs | Processing-ID (01), Verarbeitungs-ID (02, 03), Workflow-ID (02 §39) |
| Bestand der Konflikte | Konfliktbestand (01, 02), Konfliktdatei (01 §23, 03, 07) |
| Arbeitsstand | Arbeitsbestand (01, 02), Arbeitsdatei (07) |
| Regelwerk einer Quelle | Eingangsprofil (02), Profil (03, 04), Konsolidierungsprofil (06), Mapping-Definition (05) |
| vorzulegender Fall | Konflikt (02, 03), Prüffall (07, 08, 09) — SPEC-07 §2 unterscheidet beide, SPEC-02 und SPEC-03 kennen nur den Konflikt |

---

## D — Wo die Specs die laufende Implementierung kreuzen

Nicht Gegenstand der Prüfung, aber beim Lesen aufgefallen:

1. **SPEC-05 §9** verlangt, dass „Erstellen, Ändern, Freigeben, Aktivieren und
   Deaktivieren … entsprechend den Benutzerrechten steuerbar" sind, und
   SPEC-04 §11 kennt einen Freigabestatus. Mit den beiden festgelegten Stufen
   (Administrator, Normal) lässt sich „darf ändern, aber nicht freigeben" nicht
   ausdrücken. Entweder ist Freigeben Sache des Administrators, oder es braucht
   ein eigenes Recht.
2. **SPEC-01 §12** legt die Daten nach `C:\ProgramData\UniCom\` mit
   `database\unicom.db` und den Verzeichnissen `processing\`, `conflicts\`,
   `archive\`, `temp\`, `backups\`. Die Implementierung verwendet
   `application-data\unikom.db`; die genannten Unterverzeichnisse gibt es noch
   nicht.
3. **SPEC-02 §46** („Manuelle Entscheidungen werden mit der eindeutigen
   Benutzer-ID des angemeldeten UniCom-Benutzers protokolliert") ist mit der
   Benutzer-ID im Protokoll bereits erfüllt.

---

## Runde 6 — Die Kette schließt sich (20.08.2026)

**Der Anlass:** drei offene Punkte aus Etappe 8.

### Die Konsolidierung gehört in den Lauf, nicht neben ihn

Etappen 5 bis 7 waren gebaut und liefen ausschließlich über die Schnittstelle:
Ein Mensch schickte Quellen und Regeln, bekam einen Bericht und entschied. Ein
Workflow um drei Uhr nachts hat keinen Menschen.

**Entschieden:** Ein Dienst legt sich **um** die Übertragung, statt sie zu
ersetzen. Der Orchestrator behält Zeitplan, Doppellaufsperre und Lauf-Eintrag
und weiß von der Konsolidierung nichts.

**Die Alternative** wäre gewesen, den Orchestrator um die Konsolidierung zu
erweitern. Dann hätte er zwei Dinge gewusst, die nichts miteinander zu tun
haben — wann etwas läuft, und was dabei geschieht.

### Was am Workflow steht und was nicht

**Am Workflow:** Betriebsart, Art, führende Datei, Schlüssel, Dubletten,
Umgang mit fehlenden Hauptsätzen, Dateimuster, Tabellenblatt.

**Nicht am Workflow:** Die **Mindestkonfidenz** — sie kommt aus der Hierarchie
der Einstellungen; wer sie am Workflow senken dürfte, könnte sich eine
automatische Entscheidung bestellen, die im Prüflauf noch ein Konflikt war. Und
die **Referenzbestände** — ein Referenzbestand ist eine Datenmenge und keine
Einstellung; ihn in jeden Workflow zu kopieren ergäbe so viele Stände wie
Workflows.

### Ein Workflow ohne Übertragung ist vollständig

Bisher endete er im Fehler: „Dieser Workflow holt keine Dateien, und kein
anderer Schritt ist eingeschaltet." Das galt, solange die Übertragung die
Grundlage war.

**Entschieden:** Ohne Übertragungsschritt endet der erste Teil mit
`SUCCESS_NO_FILES` — für diesen Lauf ist das Holen erledigt, indem es nicht
stattfand. Ein Fehler bleibt nur, wenn **kein einziges** Glied eingeschaltet
ist: Das ist kein Zuschnitt, sondern ein Versehen.

### Der E-Mail-Versand darf scheitern

**Entschieden:** Die Meldung wird angelegt und **danach** versandt, nie
stattdessen. Ein Postfach, das nicht antwortet, hält keine Verarbeitung an.
Gewartet wird trotzdem — ein nur angestoßener Versand geht mit dem Prozess
unter, der sich gleich darauf beendet.

**SMTP von Hand statt Fremdbibliothek.** Sieben Befehle gegen eine Abhängigkeit,
die im Haus jedes Kunden mitgepflegt werden müsste.

### Der Agent liest die Datenbank

**Der Grund für den dritten Prozess** ist enger als „der Browser könnte zu
sein": Ein Windows-Dienst läuft in Sitzung 0, und Sitzung 0 hat keinen
Bildschirm. Der Worker **kann** keine Blase zeigen.

**Entschieden:** Er liest dieselbe SQLite, statt den Server zu fragen. Über HTTP
zu fragen hieße, eine Anmeldung ohne Benutzer zu erfinden — ein Dauertoken auf
der Platte des Arbeitsplatzes. Ein Schlüssel mehr für eine Frage, die die
Datenbank unmittelbar beantwortet.

**Der Meldungstext geht durch eine Umgebungsvariable**, nicht über die
Befehlszeile: In einem Titel steht ein Workflowname, den ein Mensch getippt hat.

---

## Runde 7 — Die Ränder (20.08.2026)

### Das Fenster darf sich vordrängen, aber nicht immer

SPEC-01 §21 verlangt es für „Aktion erforderlich" und „Kritisches Ereignis" und
verbietet es für „Information". Das ist keine Feinheit: Ein Fenster, das sich
vordrängt, während jemand tippt, ist eine Zumutung — und wer sie täglich
erlebt, klickt auch das Konfliktfenster weg.

**Entschieden:** Die Kanäletabelle bleibt die einzige Schranke. Und der Agent
öffnet **keinen** Browser, wenn keiner offen ist: Er liefe sonst nachts um drei
auf einem leeren Rechner und öffnete Fenster für niemanden.

### Die Meldung, die aus einem Nichts entsteht

Alle anderen Meldungen entstehen, weil etwas geschehen ist. „Erwartete
Verarbeitung nicht erfolgt" entsteht, weil nichts geschehen ist — und der
häufigste Grund dafür ist ein Worker, der nicht läuft. Genau dann fehlt aber
auch derjenige, der es merken könnte.

**Entschieden:** Jeder Tick prüft **zuerst**, was er verpasst hat, und arbeitet
dann. Andersherum wäre die Spur fort, bevor jemand sie liest.

**Die Nachfrist ist knapp** (fünf Minuten), anders als beim Herzschlag. Dort
geht es um einen Prozess, der vielleicht gerade rechnet; hier um einen
Zeitpunkt, der überschritten ist. Länger zu warten hieße, den Ausfall einer
Nachtverarbeitung erst am Vormittag zu melden.

**Ein Termin meldet sich einmal** — sonst zwölf gleiche Meldungen pro Stunde,
solange eine abgelaufene Lizenz das Nachholen verhindert.

### Die Mindestkonfidenz wird unmöglich statt verboten

Sie stand als Kommentar im Regeltyp: „kommt aus der Hierarchie". Ein Kommentar
hält niemanden auf.

**Entschieden:** `Omit<Entscheidungsregeln, 'mindestKonfidenz'>` — sie ist am
Workflow nicht mehr darstellbar. Und der Lauf verwirft sie zusätzlich zur
Laufzeit, weil ein von Hand bearbeiteter Datensatz sie trotzdem tragen kann.

### Dateiname und Quellenkennung sind zweierlei

Im Workflow steht, was ein Mensch sieht: `Filialen.xlsx`. Im Auftrag steht, was
die Konsolidierung unterscheidet: `Filialen.xlsx#Nord`.

**Entschieden:** Übersetzt wird an einer Stelle, für die führende Quelle **und**
für jede Rangfolge. Vorher galt es nur für die führende Quelle — eine Rangfolge
über eine Arbeitsmappe wäre stillschweigend wirkungslos geblieben.

