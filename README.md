# Unikom

Technische Umsetzung von Step 1 der in [Specs/FR_001_FOUND_STEP1.md](Specs/FR_001_FOUND_STEP1.md)
beschriebenen Anwendung: automatisierte Dateiübernahme aus lokalen, SFTP- und
FTPS-Quellen mit überprüfbaren Filtern, Stabilitätsprüfung, Integritätsnachweis,
optionaler Verschlüsselung und sicherer lokaler Ablage.

Eine Datei gilt erst dann als übernommen, wenn sie den Auswahlregeln entspricht,
alt genug und stabil ist, vollständig übertragen, geprüft, optional verschlüsselt,
endgültig gespeichert und persistent registriert wurde. Erst dann entsteht
`STEP_1_COMPLETED` — der spätere Übergabepunkt an Step 2.

## Voraussetzungen

- **Node.js 22 oder neuer.** Die Persistenz nutzt das eingebaute Modul `node:sqlite`,
  das Node beim Start als experimentell meldet.

## Einrichtung

```bash
npm install
npm test          # 555 Tests, inklusive echter SFTP- und FTPS-Protokolltests
npm run web:build # Oberfläche nach dist/web bauen
npm run serve     # Server und Oberfläche auf http://127.0.0.1:8383
npm run dev       # Beispiellauf mit lokaler Quelle, ohne Server
npm run build     # Produktivbuild nach dist/ (ohne Tests)
```

`npm test` kommt ohne Netz und ohne fremde Server aus. Zwei Prüfungen gehen
darüber hinaus und sind deshalb getrennt:

- **Windows-Freigaben.** Acht Kombinationen aus Herkunft und Ablageort prüft
  `TransferMatrix.test.ts`; die mit einer Freigabe überspringen sich, solange
  es keine gibt. Anlegen in einer PowerShell als Administrator:

  ```powershell
  New-SmbShare -Name UnikomTest -Path C:\UnikomTest\Freigabe -FullAccess "$env:USERDOMAIN\$env:USERNAME"
  ```

- **Echte Server und das echte Betriebssystem.** `npm run test:real` prüft
  gegen einen wirklichen Hoster — Zugangsdaten nach dem Muster von
  `testserver.local.example.json` — und gegen den Datenschutz von Windows, der
  den Hauptschlüssel verwahrt. Beides läuft getrennt, weil es außerhalb des
  Prozesses stattfindet und lange dauert: Ein PowerShell-Aufruf kostet Sekunden,
  eine Netzverbindung ebenso. In der Standardprüfung würden sie daneben laufende
  Tests in ihre Zeitgrenze treiben.

Für die Arbeit an der Oberfläche:

```bash
npm run serve     # in einem Fenster
npm run web:dev   # im zweiten, auf http://127.0.0.1:5173
```

Der Entwicklungsserver reicht `/api` an den laufenden Server durch, damit der
Browser eine einzige Herkunft sieht und das Sitzungs-Cookie sich genauso
verhält wie später im Betrieb. **Im Betrieb läuft nur ein Prozess:** der Server
liefert die gebaute Oberfläche aus `dist/web` selbst aus.

## Server und Anmeldung

`npm run serve` startet Scheduler und Oberfläche gemeinsam. Beim allerersten
Start erzeugt Unikom einen Administrator und zeigt dessen Passwort **einmalig**
auf der Konsole; es muss bei der ersten Anmeldung geändert werden. Bis dahin
darf die Sitzung nichts anderes als genau das.

| Umgebungsvariable | Bedeutung |
| ----------------- | --------- |
| `UNIKOM_HOST` | Voreingestellt `127.0.0.1` |
| `UNIKOM_PORT` | Voreingestellt `8383` |
| `UNIKOM_BEHIND_TLS` | `true`, wenn ein Reverse Proxy TLS beendet |
| `UNIKOM_DATA_DIRECTORY` | Ablage, voreingestellt `application-data` |
| `UNIKOM_LICENCE_PUBLIC_KEY` | Prüfschlüssel für Lizenzen — greift nur, solange keiner eingebaut ist (siehe [Zahlungszeitraum](#zahlungszeitraum)) |

Der Server **verweigert den Start**, wenn er an eine andere Adresse als
`127.0.0.1` gebunden werden soll, ohne dass `UNIKOM_BEHIND_TLS` gesetzt ist:
über einfaches HTTP wanderte das Anmeldepasswort sonst im Klartext durchs
Firmennetz. Das ist eine Fehlermeldung und keine Dokumentationszeile, weil man
Dokumentation überliest.

Es gibt drei Rollen — `ADMIN`, `OPERATOR`, `VIEWER`. Zugangsdaten und
Benutzerverwaltung bleiben beim Administrator; ein Operator legt Jobs an und
startet sie, ein Viewer sieht zu. Geprüft wird an jedem Endpunkt, nicht in der
Oberfläche: die entscheidet nur, was sie anzeigt.

Die Anmeldung ist vollständig lokal. Sie darf von keinem Dienst im Netz
abhängen — sonst stünde bei einem Produkt, dessen Zusage „Ihre Daten bleiben
bei Ihnen" lautet, ausgerechnet der Zugang als Ausnahme da.

## Werkbank und Leitwarte

Einrichten und Zusehen sind zwei Tätigkeiten, und die Oberfläche trennt sie:

| Bereich | Wofür |
| --- | --- |
| **Workflows** | Zusammenbauen: anlegen, ändern, aktivieren, deaktivieren, löschen — und von Hand starten |
| **Jobs** | Zusehen: was gerade läuft, was als Nächstes ansteht, mitlaufendes Protokoll — und **anhalten, fortsetzen, abbrechen** |

Wer einem Lauf zusieht, soll nicht aus Versehen seine Einrichtung verstellen;
wer einrichtet, will nicht die Leitwarte dazwischen haben.

**Anhalten und Abbrechen wirken zwischen zwei Dateien, nie in einer.** Die
Übertragungsschleife fragt vor jeder Datei, ob sie weitermachen darf
([`RunControl`](src/domain/transfer/RunControl.ts)); wird angehalten, wartet sie
dort, wird abgebrochen, rührt sie keine weitere Datei an. Der Preis ist
sichtbar: bei einer sehr großen Datei dauert es bis zum nächsten Halt. Das ist
der richtige Preis — eine halbe Datei im Ziel wäre der Bruch derselben Zusage,
die auch Staging und Verschlüsselung tragen. Was bis zum Abbruch übertragen
wurde, bleibt übertragen und vollständig; der Lauf endet als `CANCELLED`.

Die Steuerung lebt im Speicher des Prozesses
([`RunControlRegistry`](src/application/transfer/RunControlRegistry.ts)) und
nicht in der Datenbank: sie gilt für einen Lauf in genau diesem Prozess. Stirbt
er, ist der Lauf ohnehin zu Ende, und ein gespeichertes „angehalten" würde nach
einem Neustart auf einen Transfer warten, den es nicht mehr gibt.

Das Protokoll läuft mit, indem die Oberfläche im Sekundentakt nur nachfragt,
was seit ihrem letzten Blick dazugekommen ist. Dafür trägt jede Logzeile ihre
Position (`sequence`); Zeitstempel würden nicht genügen, weil mehrere Zeilen
sich eine Millisekunde teilen und eine davon doppelt oder gar nicht ankäme.

## Hauptschlüssel

Zugangsdaten werden verschlüsselt gespeichert, und der Schlüssel dazu liegt
bewusst außerhalb der Datenbank, die er schützt — ein Schlüssel daneben wäre
Zierde.

**Unter Windows ist nichts einzurichten.** Unikom erzeugt ihn beim ersten Bedarf
selbst und übergibt ihn dem Datenschutz des Systems (DPAPI, Bereich
`LocalMachine`); was in `hauptschluessel.dpapi` im Datenverzeichnis liegt, gibt
Windows nur auf demselben Rechner wieder heraus. Eine Sicherung der Datenbank
ist damit für sich genommen wertlos.

`LocalMachine` und nicht `CurrentUser`, weil ein Dienst unter einem anderen
Konto läuft als der Mensch, der ihn eingerichtet hat — sonst wäre der Schlüssel
für den Dienst unlesbar, und zwar erst dann, wenn nachts niemand zusieht. Die
Rechte auf die Datei bleiben deshalb die zweite Schranke.

**Anderswo, oder wenn derselbe Schlüssel auf zwei Rechnern gelten soll**, wird
er über `UNIKOM_MASTER_KEY` vorgegeben. Diese Angabe hat Vorrang: Wer sie setzt,
meint es so und wird nicht von einer Bequemlichkeit überstimmt.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Der Wert muss base64-kodierte 32 Byte sein.

Geht der Schlüssel verloren — auch durch Umzug auf einen anderen Rechner oder
eine Neuinstallation von Windows —, sind alle gespeicherten Zugangsdaten
unbrauchbar und müssen neu hinterlegt werden. Die bereits übertragenen Dateien
sind davon nicht betroffen, außer sie wurden verschlüsselt abgelegt. Workflows
mit rein lokalen Quellen und ohne Verschlüsselung laufen ganz ohne Schlüssel.

## Remote-Pfade

Wer aus einem SFTP- oder FTPS-Verzeichnis holt, muss den physikalischen Aufbau
des Servers nicht kennen. Eine Verbindung hat ein **Remote-Arbeitsverzeichnis**
— etwa `/customer123` —, und alles, was jemand eingibt, wird von dort aus
gelesen.

| Eingabe | Bedeutet bei `/customer123` |
| --- | --- |
| `orders/incoming` | `/customer123/orders/incoming` |
| `/orders/incoming` | dasselbe |
| `\orders\incoming` | dasselbe |
| `orders//incoming/` | dasselbe |
| ` orders/incoming ` | dasselbe |

**`/` ist nicht der Rechner-Root.** Server sperren Konten in Chroots und
virtuelle Verzeichnisse; was hinter `/` liegt, weiß nur der Server. Unikom
arbeitet deshalb ausschließlich mit den Pfaden, die der Server selbst nennt —
der Verzeichnisbrowser zeigt sie, und was er übernimmt, ist der Pfad des
Servers und kein zusammengesetzter.

**Das Arbeitsverzeichnis ist zugleich die Grenze.** Ein `..` darf sich darin
bewegen und wird an seinem Rand **abgelehnt**, nicht stillschweigend
zurechtgebogen: Ein Job, der leise woanders holt als bestellt, fällt niemandem
auf. Verglichen wird dabei Verzeichnis für Verzeichnis, nie als Zeichenkette —
`/customer1234` ist ein anderer Kunde als `/customer123`, obwohl der Name so
anfängt.

Zuständig ist eine einzige Klasse,
[`RemotePathResolver`](src/domain/source/RemotePathResolver.ts) — protokollfrei,
ohne Wissen über Workflows. Die Adapter für SFTP und FTPS enthalten keine eigene
Pfadlogik mehr; sie fragen dieselbe Stelle. Ein `SftpPathResolver` neben einem
`FtpsPathResolver` wären zwei Gelegenheiten, sich über `..` uneinig zu werden.

### Doppelte Verzeichnisse

Server tragen die Kundennummer zweimal (`/customer123/customer123`), und
Unterverzeichnisse wiederholen ihren eigenen Namen (`orders/orders`). Beides
kommt vor, und beides macht eine Eingabe mehrdeutig: Bei
Arbeitsverzeichnis `/customer123` kann `/customer123/orders` das Verzeichnis
dieses Namens meinen — oder ein `customer123` darin.

**Geraten wird hier nicht.** Der Resolver nennt beide Lesarten, und geprüft wird
am Server:

| Am Server gefunden | Ergebnis |
| --- | --- |
| eine Lesart | die ist es, und sie steht im Protokoll |
| beide Lesarten | Abbruch mit beiden Pfaden — die Wahl trifft der Benutzer im Verzeichnisbrowser |
| keine | nicht gefunden, mit allen geprüften Pfaden |

Ein geplanter Lauf, bei dem niemand fragen kann, folgt der ersten Lesart und
schreibt sie ins Protokoll. Wer sicher gehen will, wählt das Verzeichnis einmal
im Browser aus: Was der Server nennt, ist eindeutig.

Im Editor gibt es zu jedem Remote-Verzeichnis zwei Knöpfe: **Verzeichnis
wählen** öffnet den Browser, **Verzeichnis prüfen** beantwortet dieselbe Frage
kurz — `✓ Verzeichnis gefunden: /customer123/orders/incoming` oder `✗
Verzeichnis nicht gefunden`, jeweils mit dem Pfad, auf den die Eingabe
hinauslief. Die Eingabe selbst wird dabei **nie** überschrieben: Was nicht
gefunden wurde, ist meist fast richtig.

## Verschlüsselung: zwei Fragen, nicht eine

Wie die Datei **hereinkommt** und was am Ende **im Ziel liegt**, sind zwei
Entscheidungen. Sie hängen nicht voneinander ab, und alle vier Kombinationen
beantworten eine echte Frage.

| Unterwegs | Im Ziel | Wofür |
| --- | --- | --- |
| lesbar | lesbar | der schlichte Transfer |
| lesbar | verschlüsselt | das Ziel ist eine Freigabe, die andere lesen können |
| verschlüsselt | verschlüsselt | außerhalb der Quelle existiert nirgends etwas Lesbares |
| verschlüsselt | lesbar | geschützt auf dem Weg, lesbar für den, der danach damit arbeitet — ein Folgeschritt oder ein fremdes Programm |

`onPickup` verschlüsselt im Strom, während die Datei gelesen wird: Beim Holen
entsteht keine lesbare Kopie auf dieser Maschine. Ohne `onPickup` wird im
internen Arbeitsbereich verschlüsselt, nachdem die Datei geholt und geprüft
wurde — im Ziel liegt auch dann kein Klartext, im Arbeitsbereich für die Dauer
der Verarbeitung schon.

Die letzte Zeile ist der Grund für zwei Einstellungen statt einer: Konsolidieren
und Konvertieren arbeiten auf Datensätzen, und eine Hülle hat keine. Die Datei
wird dafür im Arbeitsbereich wieder geöffnet — was der Editor auch so sagt,
samt dem, was dieses Öffnen kostet.

Früher stand hier ein `timing` mit `ON_PICKUP` oder `BEFORE_DESTINATION`. Das
konnte „durchgehend verschlüsselt" und „am Ende verschlüsselt" ausdrücken, aber
nicht „auf dem Weg verschlüsselt, am Ende lesbar". Gespeicherte Jobs werden beim
Lesen übersetzt (`reviveJob`), nicht in einer Wanderung.

Was `onPickup` **nicht** kann: auf einem fremden SFTP- oder FTPS-Server
verschlüsseln. Dort läuft unsere Software nicht. Diese erste Strecke schützt das
jeweilige Protokoll selbst, also SSH beziehungsweise TLS.

Kann eine Quelle keinen Strom liefern, wird der Job **abgelehnt** statt still auf
einen gewöhnlichen Download zurückzufallen. Ein Rückfall wäre der eine Fehler,
den niemand bemerkt und jeder bereut: die Datei läge unverschlüsselt da, obwohl
der Job das Gegenteil zugesichert hat. Aus demselben Grund werden Lizenz,
Schlüssel und Stromfähigkeit geprüft, **bevor** das erste Byte fließt.

Die Prüfsumme beschreibt in beiden Fällen den Inhalt, nicht die verschlüsselte
Hülle. Anders wäre keine Dublettenerkennung über mehrere Läufe möglich, denn
jede Verschlüsselung verwendet frisches Salz und einen frischen IV.

## Verschlüsselte Quellen

Die Gegenrichtung: Ein Kunde liefert bereits verschlüsselte Dateien. Der Job
sagt das an der Quelle (`sourceEncryption`) und nennt den Schlüssel, mit dem sie
sich öffnen lassen.

**Zwei Schlüssel, nicht einer.** Wer Daten schickt, verschließt sie mit *seinem*
Schlüssel; wer sie weitergibt, muss mit dem Schlüssel verschließen, den der
**Empfänger** öffnen kann — dieselbe Regel, die Step 3 schon mit einem eigenen
Schlüssel je Ziel befolgt. Ein Schlüssel für beide Richtungen funktionierte nur
so lange, wie Absender und Empfänger dieselbe Partei sind, und genau dafür ist
dieses Merkmal nicht da.

| | Ziel: Klartext | Ziel: verschlüsselt |
| --- | --- | --- |
| **Quelle: Klartext** | Der Normalfall | mit oder ohne `onPickup` |
| **Quelle: verschlüsselt** | Öffnen | **Umschlüsseln**: mit dem Schlüssel des Absenders öffnen, mit dem eigenen verschließen |

**Erkannt wird an der Kennung, nicht geraten.** Eine Unikom-Datei beginnt mit
`UNIKOM` und einem Versionsbyte; das ist eindeutig. Der naheliegende Ausweg —
die Entropie messen — taugt nicht: komprimierte Daten sind statistisch so
zufällig wie verschlüsselte, und eine Heuristik würde früher oder später ein
ZIP-Archiv als „schon verschlüsselt" durchwinken und den Klartext ungeschützt
weiterreichen.

Geöffnet wird **nur im Arbeitsbereich**, der nach jedem Lauf gelöscht wird. Die
Prüfsumme entsteht danach über den Inhalt, damit die Dublettenerkennung über
Läufe hinweg vergleichen kann.

Verweigert wird an vier Stellen, statt zu raten:

1. **Ohne Modul `ENCRYPTION`** — Öffnen ist dasselbe Verfahren wie Verschließen,
   nur rückwärts gelesen.
2. **Ohne Schlüssel** — ein Job, der eine verschlüsselte Quelle angibt und
   keinen Schlüssel nennt, ist falsch eingerichtet, nicht großzügig.
3. **Bei einer Datei ohne Kennung** — sie sollte verschlüsselt sein und ist es
   nicht; das ist ein Fehler an der Quelle und gehört gemeldet. Quellen, die
   absichtlich beides liefern, dürfen das im Job ausdrücklich sagen.
4. **Bei `onPickup` zusammen mit einer verschlüsselten Quelle** — die Datei
   bekäme eine zweite Hülle und ihr Inhalt bliebe verschlossen. Abgelehnt schon
   beim Speichern, nicht erst nachts um drei.

## Logging und Historie

Jeder Transfer wird protokolliert — in die Datenbank und optional auf die
Konsole. Die Level sind `DEBUG`, `INFO`, `WARNING` und `ERROR`; im Betrieb gilt
standardmäßig `INFO`.

**Jeder Schritt wird angekündigt und danach gemeldet.** Ein Schritt, der nur
seinen Erfolg meldet, hinterlässt nichts, wenn er hängenbleibt — und „bei
welcher Datei stand er" ist die erste Frage bei jedem Lauf, der nie fertig
wurde. Auf `DEBUG` steht deshalb im Protokoll:

- jeder Schritt der Anmeldung: Verbinden, Hostkey mit Fingerabdruck, gewähltes
  Verfahren (Passwort oder Schlüssel), Anmeldung erfolgreich, Listen;
- jeder Pfad, wie er eingegeben und wie er gelesen wurde;
- jede Datei vor und nach jedem Schritt — geholt, geprüft, geöffnet,
  verschlüsselt, abgelegt — und was mit der Quelldatei geschah;
- im Fehlerfall Datei, Schritt, Ursache und der Systemcode (`[EACCES]`), samt
  Ursachenkette.

**Das Protokoll ist deutsch.** Es wird vom Kunden gelesen, nicht vom Entwickler
— Kommentare und Bezeichner im Code bleiben englisch, die Meldungen nicht.

Eine Stelle hängt daran und ist leicht zu übersehen: Die Wiederholungslogik
([`RetryPolicy`](src/application/transfer/RetryPolicy.ts)) erkennt an der
Fehlermeldung, ob ein Fehler dauerhaft ist — ein falsches Passwort wird nicht
dreimal versucht. Sie führt deshalb **beide Sprachen**: Englisch für das, was
`ssh2` und `basic-ftp` melden, Deutsch für Unikoms eigene Meldungen. Wer eine
Meldung umformuliert, muss dort nachsehen; ein Test hält den Fall fest.

Nie im Protokoll: Passwörter, Schlüssel, Passphrasen. Ein Test prüft das nach.

### Wo das Protokoll liegt

**Im Arbeitsspeicher, nicht in der Datenbank.** Ein Laufprotokoll ist eine
Mitschrift: gebraucht, solange jemand hinsieht — und darüber hinaus nur, wenn
jemand es aufhebt. Das tut der Benutzer, indem er in der Laufansicht auf
**„Protokoll speichern"** klickt; er bekommt es als Textdatei
(`Kunde-A-Bestellungen_2026-08-17_0345_TR-8f2c.log`), mit Kopfdaten, dem
vollständigen Verlauf und den Fehlern und Warnungen noch einmal am Ende.

Gespeichert wird dabei **jede Zeile**, nicht nur die des angezeigten
Detailgrads: Wer ein Protokoll verschickt, soll nicht hinterher merken, dass
genau die fehlende Zeile die Antwort war.

Was das kostet und bringt:

- Die Datenbank wächst nicht mehr mit dem Protokoll — gemessen waren das 1,6 kB
  je Datei bei „Alles", also gut ein halbes Gigabyte im Jahr bei tausend Dateien
  am Tag.
- Ein Neustart nimmt die Protokolle mit, und alte Läufe werden verdrängt
  ([`RunProtocolMemo`](src/application/logging/RunProtocolMemo.ts): 20 Läufe
  oder 100.000 Zeilen). **Verworfen wird ein Lauf im Ganzen, nie halb** — ein
  Protokoll, dem vorne die Hälfte fehlt, sieht vollständig aus und beantwortet
  die Frage trotzdem nicht.
- `logDays` löscht damit nichts mehr; der Aufbewahrungsdienst meldet null,
  statt eine Zahl zu nennen, die nach Aufräumen aussieht. Für die
  Übernahme-Historie gilt er unverändert.

### Protokolle ablegen

Für Läufe, denen niemand zusieht: **`saveProtocol` am Workflow** (im Editor
unter Grunddaten, voreingestellt **aus**) schreibt das Protokoll am Ende jedes
Laufs selbst weg.

```
application-data/protokolle/2026/08/Kunde-A-Bestellungen_2026-08-17_0345_TR-8f2c.log
```

Nach Jahr und Monat sortiert — ein flaches Verzeichnis hätte nach zwei Jahren
zwanzigtausend Dateien. Ein eigener Pfad geht über `protocolDirectory`, etwa
auf ein Netzlaufwerk; das Konto, unter dem Unikom läuft, braucht dort
Schreibrecht.

Abgelegte Protokolle werden nach **30 Tagen** aufgeräumt (`retention.protocolDays`),
gerechnet nach dem Zeitpunkt **im Dateinamen** und nicht nach dem der Datei: Ein
Virenscanner fasst Dateien an, ein Dateiname bleibt, was er war. Leergeräumte
Monats- und Jahresordner verschwinden mit.

Das Ablegen geschieht **nach** dem Speichern des Laufs und kann ihn nicht
scheitern lassen: Ein voller Datenträger im Protokollverzeichnis wäre ein
schlechter Grund, eine gelungene Übertragung als Fehler zu melden. Ein Lauf ohne
eine einzige Zeile hinterlässt keine leere Datei.

**Der Umfang ist je Workflow einstellbar** (`logLevel` am Job, im Editor unter
Grunddaten). Er gewinnt gegen die Einstellung der Installation, in beide
Richtungen: Ein Workflow, der Ärger macht, schreibt alles mit, während die
übrigen leise bleiben — und einer, der jede Minute läuft, darf leiser sein als
der Rest. Ohne eigene Angabe gilt die Einstellung der Installation.

Der Verbindungstest im Editor gibt seine Schritte mit zurück und zeigt sie als
nummerierte Liste. Wo die Liste aufhört, ist die Verbindung stehengeblieben:
am Netz, am Hostkey, am Konto oder am Pfad.

```bash
UNIKOM_LOG_LEVEL=DEBUG npm run dev
```

`DEBUG` erklärt zusätzlich für jede gefundene Datei, warum sie ausgewählt oder
verworfen wurde — das ist der schnellste Weg, einen Filter zu prüfen, der nicht
wie erwartet greift. Ein Wiederholungsversuch nach einem temporären Fehler
erscheint als `WARNING`, nicht als `ERROR`: Der Lauf ist zu diesem Zeitpunkt
noch in Ordnung.

Über den `TransferHistoryService` sind Laufübersicht, Laufdetail mit Dateien und
Protokoll, fehlgeschlagene Dateien sowie die Kennzahlen des Dashboards
abrufbar.

## Dubletten: zwei verschiedene Dinge

Im Code stecken zwei Mechanismen, die leicht verwechselt werden:

**Wiederholungsschutz** — dieselbe Quelldatei nach Pfad, Name, Größe und
Änderungszeit wurde schon übernommen, also nicht erneut holen. Das ist keine
fachliche Dublettenprüfung, sondern die Wiederholbarkeit des Laufs, und deshalb
**nicht abschaltbar**. Ohne sie holt der Scheduler alle 15 Minuten das gesamte
Quellverzeichnis erneut.

**Inhaltsgleichheit** — zwei *verschiedene* Dateien mit identischem Inhalt. Das
ist ein Job-Schalter, `detectContentDuplicates`, und er ist **voreingestellt
aus**:

```typescript
detectContentDuplicates: true
```

Welche Dateien ein Quellsystem bereitstellt, ist dessen Entscheidung. Ob
derselbe Inhalt unter zwei Namen ein Versehen ist oder Absicht, lässt sich von
hier aus nicht beurteilen — und eine Datei stillschweigend zu unterschlagen, die
der Kunde geschickt hat, ist die riskantere Annahme.

Einschalten lohnt für ein bestimmtes Muster: Quellsysteme, die ihre Dateien
nächtlich neu schreiben, ohne etwas zu ändern. Gleicher Name, neue
Änderungszeit — der Wiederholungsschutz greift dann nicht, die Inhaltsprüfung
schon.

## Verzeichnisse und Freigaben

Quell- und Zielverzeichnis sind frei einstellbar: ein lokaler Pfad, ein
Netzlaufwerk oder eine Freigabe als UNC-Pfad.

```text
D:\Daten\kunde-a\eingang
\\dateiserver\austausch\kunde-a
```

Schrägstriche und Backslashes werden gleich behandelt, ebenso ein abschließendes
Trennzeichen. Auch die Mandantengrenze arbeitet auf Freigaben:
`\\server\austausch\KundeAB` liegt korrekt **außerhalb** von
`\\server\austausch\KundeA` — verglichen werden aufgelöste Pfade, keine
Zeichenketten.

Im Job-Editor prüfen zwei Knöpfe, was sonst erst nachts auffiele:

| Knopf | Antwortet auf |
| ----- | ------------- |
| **Verbindung testen** | Ist die Quelle erreichbar, und wie viele Dateien liegen dort? |
| **Ziel prüfen** | Existiert das Verzeichnis, ist es eines, kann Unikom dort schreiben, liegt es im Root-Verzeichnis des Mandanten? |

Das Schreibrecht wird durch einen **Schreibversuch** ermittelt, nicht durch
Auslesen von Berechtigungen: Bei einer Windows-Freigabe ergibt sich das
effektive Recht aus ACLs, Gruppenzugehörigkeit und Freigabeberechtigungen, von
denen keine in dem steht, was ein Dateisystemaufruf meldet. Die Testdatei wird
sofort wieder entfernt.

**Wichtig bei Freigaben:** Ein Zugang ist **Pflicht** — Benutzername und
Kennwort, je Seite getrennt. Ohne ihn zählte das Konto, unter dem Unikom läuft,
und nicht das der Person, die den Workflow anlegt: Beim Einrichten fiele das
nicht auf, weil Unikom dann oft in deren Sitzung läuft; als Windows-Dienst
fände derselbe Workflow nichts mehr. Verbunden wird je Server eine Sitzung
gleichzeitig (`ShareConnectionService`), weil Windows SMB-Sitzungen je Konto
und Server führt und einen zweiten Zugang zum selben Server mit Fehler 1219
abweist.

## Aufbewahrung

Protokoll und Übernahme-Historie enthalten Dateinamen, und ein Dateiname ist
regelmäßig ein Personenbezug — `Rechnung_Mueller_2026.pdf` nennt einen
Menschen. Eine unbefristete Speicherung ist damit begründungsbedürftig
(Art. 5 Abs. 1 lit. e DSGVO). Jeder Job kann deshalb festlegen, wie lange
aufbewahrt wird:

```typescript
retention: { logDays: 90, historyDays: 365 }
```

Der `RetentionService` löscht Abgelaufenes; der Scheduler ruft ihn höchstens
einmal pro Kalendertag auf. Schlägt das fehl, wird es gemeldet, aber der
Betrieb läuft weiter — Aufräumen ist kein Grund, Übertragungen einzustellen.

Die beiden Fristen sind bewusst getrennt, weil sie unterschiedlich folgenreich
sind:

| | Voreinstellung | Folge der Löschung |
| --- | --- | --- |
| `logDays` | 90 Tage | Nur die Spur wird kürzer. Keine Auswirkung auf Übertragungen. |
| `historyDays` | unbegrenzt | **Verändert das Verhalten.** |

Die Übernahme-Historie *ist* die Dublettenerkennung. Wird sie gelöscht, ist eine
Datei, die noch in der Quelle liegt, wieder unbekannt und wird erneut geholt.
Was dann passiert, hängt an der Konfliktstrategie: `SKIP` erkennt die Datei am
Zielverzeichnis, es bleibt bei vergeblicher Übertragung. `RENAME` legt sie ein
zweites Mal ab — unter dem Zeitpunkt ihres Laufs, `ORDER_001_31012026_235959.csv`
— und `NEW_NAME` unter dem Namen, der im Workflow steht. In beiden Fällen steht
derselbe Inhalt danach doppelt im Ziel.

Die Schreibweise des Zeitstempels hängt am Job (`timestampNotation`), nicht am
Betrachter: Tag zuerst, oder Monat zuerst für die USA. Sie wird beim Anlegen aus
der Sprache der Oberfläche übernommen und danach nicht mehr verändert — sonst
hießen die Dateien eines Workflows je nach Bearbeiter anders.

Betroffen ist nur `sourceSuccessAction: 'KEEP'`. Wer Quelldateien verschiebt
oder löscht, hat nichts, was ein zweites Mal aufgesammelt werden könnte. Weil es
hier keine unbedenkliche Voreinstellung gibt, bleibt `historyDays` leer, bis
jemand sie bewusst setzt.

## Mandanten

Unikom läuft auf **einem** Rechner für **eine** Firma. Diese Firma kann aber ein
Dienstleister sein, der für mehrere eigene Kunden Daten abholt, verarbeitet und
wieder ausliefert. Diese Kunden sind die Mandanten — im Code `Tenant`.

Das ist ausdrücklich **nicht** Mandantenfähigkeit im SaaS-Sinn. Wir hosten
niemanden; die Trennung dient dazu, dass beim Betreiber die Daten seiner Kunden
nicht durcheinandergeraten.

Eine Firma mit einem einzigen Quellserver hat schlicht den Mandanten `Standard`
und muss sich nie damit befassen. Er entsteht beim Start von selbst und
übernimmt Jobs, die aus einer Zeit vor den Mandanten stammen — ein
Aktualisierungsschritt ist dafür nicht nötig.

Ein Mandant klammert:

| | |
| --- | --- |
| **Jobs** | Jeder Job gehört genau einem Mandanten |
| **Zugangsdaten** | Eigene je Mandant; ohne Zuordnung gelten sie für alle |
| **Zielverzeichnis** | Optionales Root-Verzeichnis, das erzwungen wird |

Die Zuordnung bleibt, der Ort ihrer Pflege nicht: **Schlüssel und Zugänge werden
im Job-Editor angelegt**, dort, wo die Aufgabe festgelegt wird und wo auffällt,
dass etwas fehlt. Sie ändern sich im Takt des Auftrags, nicht im Takt des
Kunden. Was einmal angelegt ist, bleibt gespeichert und steht jedem weiteren Job
offen; die Übersicht über alle Einträge — prüfen, ersetzen, löschen — liegt
unter **Einstellungen → Schlüssel & Zugänge**.

Das Root-Verzeichnis ist der wichtigste Teil. Ohne es sind Quell- und
Zielverzeichnis freie Textfelder, und ein Tippfehler legt Dateien von Kunde A im
Ordner von Kunde B ab, ohne dass es jemand merkt. Ist es gesetzt, wird bei jedem
Speichern geprüft, dass das Ziel darin liegt — und zwei Mandanten dürfen sich
ihr Verzeichnis weder teilen noch ineinander schachteln. Verglichen werden
aufgelöste Pfade, nicht Zeichenketten: sonst läge `D:/Daten/KundeAB`
scheinbar in `D:/Daten/KundeA`.

Geprüft wird an denselben zwei Stellen wie die Lizenz — beim Speichern des Jobs
und beim Erzeugen der Fähigkeit. Wird eine Zugangsdatei *nachträglich* einem
Mandanten zugeordnet, greift die zweite Prüfung, unmittelbar bevor die
Verbindung mit fremden Zugangsdaten aufgebaut würde.

Nur das **Ziel** wird eingegrenzt, nicht die Quelle: die liegt auf dem Server des
Kunden oder in einem Verzeichnis, das er uns nennt, und geht unsere Grenze
nichts an.

Abschottung nach Benutzern gibt es noch nicht — alle Mitarbeiter des Betreibers
sehen alle Mandanten. Das Feld liegt aber überall, sodass eine Rechteprüfung
darauf später ohne Datenumbau ergänzt werden kann.

## Module

Unikom ist ein Produkt mit einzeln zuschaltbaren Modulen. **Alle vier Module
werden einzeln gekauft, das Übertragen eingeschlossen.** Es war einmal das
kostenlose Grundprodukt; das trug nur, solange alles andere ein Aufsatz darauf
war. Sobald jemand das Konsolidieren allein kaufen kann, verschenkte man mit dem
Übertragen das Modul, das die übrigen trägt.

Zeitplanung, Historie, Benutzer und die Job-Verwaltung bleiben außerhalb der
Lizenz: Sie sind die Plattform, auf der die Module laufen, kein Produkt daneben.

| Modul | Inhalt |
| ----- | ------ |
| `TRANSFER` | **Daten übertragen**: Dateien abholen und ablegen |
| `REMOTE_SOURCES` | Entfernte Quellen: SFTP und FTPS |
| `ENCRYPTION` | Verschlüsselte Ablage, Entschlüsselung in der Kette, erneute Verschlüsselung vor der Auslieferung (AES-256-GCM) |
| `CONSOLIDATION` | **Daten konsolidieren**: zusammenführen, korrigieren, anreichern, Datensatz-Dubletten |
| `DATA_IMPORT` | **Daten importieren**: Übernahme in Datenbanktabellen |
| `CONVERSION` | **Daten konvertieren**: Ausgabe in ein anderes Dateiformat |

`REMOTE_SOURCES` und `ENCRYPTION` sind keine Module, sondern Fähigkeiten *in*
ihnen: Ein entfernter Zugriff braucht beides — das Übertragen und die entfernte
Quelle —, und keines davon allein genügt.

**Die Module tragen Namen, keine Nummern.** Eine Nummer könnte nur eines von
beidem bedeuten — welches Modul das ist oder wann es läuft — und beides
gleichzeitig geht nicht: Wer nur Konsolidieren und Konvertieren kauft, lässt sie
als erstes und zweites laufen, während eine feste Nummerierung sie weiterhin
zwei und vier nennen würde. Der Name trägt also die Identität, die Nummer den
Ablauf eines konkreten Workflows.

SFTP und FTPS bilden ein Modul: beides ist entfernter Dateizugriff über einen
verschlüsselten Kanal, mit gemeinsamer Zugangsdaten- und Host-Prüfung.
Konvertieren und Importieren sind dagegen zwei Module, weil eine Datei in einem
anderen Format zu schreiben und Datensätze in Tabellen zu laden im Aufwand weit
auseinanderliegen: Das eine schreibt eine Datei, das andere braucht Verbindungen,
Schema-Abbildung, Transaktionen und eine eigene Fehlergeschichte. Jedes wird
einzeln gekauft und läuft einzeln.

Die Prüfung sitzt an zwei Stellen, nicht in der Oberfläche:

1. **Beim Speichern eines Jobs** über den `TransferJobService`. Der Fehler nennt
   das fehlende Modul, und zwar während der Bearbeitung statt nachts um drei.
2. **Beim Erzeugen der Fähigkeit** — im `SourceAdapterProvider`, vor der
   Verschlüsselung und bei der Registrierung einer Verarbeitungsstufe. Diese
   Prüfung ist die tragende: ein Job, der bei gültiger Lizenz angelegt oder
   direkt in die Datenbank geschrieben wurde, kommt hier unverändert an.

Ein nicht lizenziertes Modul wird nicht ausgeblendet, es existiert zur Laufzeit
nicht. Eine verlangte, aber nicht lizenzierte Verschlüsselung lässt den Transfer
scheitern, statt die Datei im Klartext abzulegen.

### Die Kette, ihre Namen und ihre Nummern

Ein Workflow wird aus vier Gliedern gebaut, und **keines ist Sockel der
anderen**:

| Glied | Modul |
| ----- | ----- |
| Daten übertragen | `TRANSFER` |
| Daten konsolidieren | `CONSOLIDATION` |
| Daten importieren | `DATA_IMPORT` |
| Daten konvertieren | `CONVERSION` |

Alle vier sind einzeln zuschaltbar, in jeder Kombination. „Konsolidiere die
Datei, die in Verzeichnis X schon liegt" ist ein vollständiger Auftrag — ohne
Übertragen, ohne Ausgabe. Die einzige Regel über Kombinationen lautet: mindestens
ein Glied muss an sein, sonst liefe der Workflow jede Nacht und täte nichts.

Ein Kunde kauft also `CONSOLIDATION` und fasst das Übertragen nie an; ein anderer
kombiniert Übertragen und Konvertieren und überspringt das Konsolidieren.

**Die Nummer gehört dem Workflow, nicht dem Modul.** Vergeben wird sie über die
Glieder, die dieser Workflow wirklich benutzt — 1, 2, 3 in der Reihenfolge des
Ablaufs. Dieselbe Konvertierung steht deshalb beim einen Kunden als 4 und beim
anderen als 2, und das ist richtig so: Die Nummer beantwortet „wann läuft das",
der Name beantwortet „was ist das". Ein Workflow aus einem einzigen Glied trägt
gar keine Nummer — eine einsame „1" ließe bloß eine fehlende „2" vermuten.

Weil jedes Glied einzeln gekauft werden kann, sagt jedes für sich, **woher es
liest und wohin es schreibt** (`StageConfig`; beim Übertragen sind es die Quell-
und Zielfelder des Jobs selbst, die Hosts und Zugänge tragen und für `StageInput`
zu reichhaltig sind). Die Verkettung ist dabei ein Verweis und kein
abgeschriebener Pfad:

- `input: { from: 'PRECEDING' }` — übernimmt, was das vorige aktive Glied ablegt
- `input: { from: 'DIRECTORY', directory }` — ein eigenes Verzeichnis
- `output: { to: 'FOLLOWING' }` — reicht weiter, ohne Zwischenablage
- `output: { to: 'DIRECTORY', directory }` — legt selbst ab

Ein vorbestücktes Textfeld wäre genau so lange richtig, bis jemand das Glied
davor ändert; danach zeigte es still auf ein Verzeichnis, in das nichts mehr
geschrieben wird. Ein ausgeschaltetes Glied in der Mitte wird übersprungen — die
Kette schließt sich über die Lücke, statt an ihr abzureißen.

Zwei Verweise können ins Leere zeigen, und beide werden beim Speichern
abgelehnt:

- `output: { to: 'FOLLOWING' }` ohne folgendes Glied — das Ergebnis hätte keinen
  Ort.
- `input: { from: 'PRECEDING' }` ohne vorangehendes Glied — es gibt nichts zu
  erben. Genau das ist der Normalfall für einen Workflow, der mit dem
  Konsolidieren anfängt.

Die Mandantengrenze fragt jedes eingeschaltete Glied, nicht nur das Übertragen:
Konsolidieren und Konvertieren legen Dateien ab, und ein Workflow kann aus nichts
anderem bestehen. Nur das Ziel wird geprüft, nie die Quelle — die liegt beim
Kunden.

Ein Workflow ohne das Übertragen baut **gar keine Quellverbindung** auf: Es gibt
nichts abzuholen, und ein Adapter würde ein Modul verlangen, das dieser Job nicht
benutzt — die Quellfelder tragen ja noch, was zuletzt darin stand.

> **Stand:** Die Verdrahtung wird gespeichert und geprüft, die Verarbeitung
> selbst wird noch gebaut. Ein Workflow mit einem eingeschalteten Glied hinter
> dem Übertragen **bricht deshalb beim Start ab**, statt die übrigen Glieder
> allein auszuführen — sonst lägen unverarbeitete Daten unter dem Namen eines
> Workflows, der Verarbeitung zusagt, und niemandem fiele es auf. Die Liste
> steht in `unbuiltStages` und ist die einzige Stelle, die das entscheidet.


## Zahlungszeitraum

Eine Lizenz sagt außer den Modulen, **bis wann** sie gilt. Sie ist eine Zeile
Text, vom Hersteller mit Ed25519 signiert, und die Installation prüft sie selbst
— ohne Rückfrage an irgendeinen Server. Das ist keine Bequemlichkeit: Unikom
läuft beim Kunden, oft ohne Internetzugang, und der Datenschutztext der
Anwendung sagt zu, dass nichts an den Hersteller gemeldet wird. Was offline
geht, ist eine Signatur prüfen, und das genügt: erzeugen kann sie nur, wer den
privaten Schlüssel hat.

```bash
npm run licence -- keys                 # einmal pro Produkt, nicht pro Kunde
npm run licence -- issue --customer "Muster GmbH" --until 2027-03-31 \
                         --features REMOTE_SOURCES,ENCRYPTION --out unikom.licence
npm run licence -- show unikom.licence  # prüfen, was drinsteht
```

Der **öffentliche** Schlüssel gehört in `BUILT_IN_LICENCE_PUBLIC_KEY`
([src/infrastructure/licensing/LicencePublicKey.ts](src/infrastructure/licensing/LicencePublicKey.ts))
des Auslieferungsbuilds, der **private** bleibt beim Hersteller. Solange dort
kein Schlüssel steht — wie in diesem Repository — prüft die Installation nichts
und läuft mit allen Modulen: das ist der Zustand für Entwicklung, Tests und
Demo, und er steht beim Start auf der Konsole.

Die Lizenz kommt auf zwei Wegen in eine Installation, und die weiter reichende
gewinnt:

| Weg | Ablage |
| --- | ------ |
| Datei `unikom.licence` im Datenverzeichnis | neben der Datenbank, für die Erstinstallation |
| Einstellungen → Lizenz einspielen | in der Datenbank, verlängern ohne Serverzugriff |

**Was am Ende passiert.** Die letzten Tage werden in der Oberfläche angekündigt
(voreingestellt 14, per `--warn` je Lizenz einstellbar). Danach startet **kein
Transfer mehr** — weder von Hand noch über den Zeitplan. Alles andere bleibt
offen: Anmeldung, Historie, Jobs, Einstellungen, Einspielen einer neuen Lizenz.
Wer eine überfällige Rechnung klären soll, darf nicht aus seinen eigenen
Aufzeichnungen ausgesperrt sein. Geprüft wird an denselben zwei Stellen wie bei
den Modulen: vor dem Anlegen eines Laufs im `TransferOrchestratorService` und im
`JobExecutionService`, durch den jeder Aufrufer geht.

Die Systemuhr allein wäre keine Grundlage — auf der eigenen Maschine ist sie in
zwei Sekunden zurückgestellt. Die Installation merkt sich deshalb den spätesten
Zeitpunkt, den sie je gesehen hat, und rechnet nicht dahinter zurück. Die
Kehrseite ist gewollt: eine versehentlich weit in die Zukunft gestellte Uhr
lässt die Installation abgelaufen aussehen, und das repariert eine neue Lizenz.

Absolute Sicherheit gibt es bei Software, die beim Kunden läuft, nicht — wer
den ausgelieferten Code ändert, kann jede Prüfung entfernen. Erreichbar ist,
dass eine Lizenz nicht gefälscht und ein Zeitraum nicht unbemerkt verlängert
werden kann, und dass beides einen bewussten Eingriff erfordert.

Voreingestellt sind alle Module aktiv, damit Entwicklung, Tests und Demo keine
Lizenzübung sind. Ein Auslieferungsbuild übergibt stattdessen die tatsächliche
Zusammenstellung über `ApplicationOptions.features`.

## Übergabe an Step 2 und 3

Sobald eine Datei `STEP_1_COMPLETED` erreicht hat, entsteht der
`FileProcessingContext` aus §75 — der Übergabevertrag. Jede weitere Stufe nimmt
ihn entgegen, verändert ihn und gibt ihn weiter:

```typescript
interface ProcessingStage {
  readonly name: string;
  readonly requiredFeature: Feature;
  process(context: FileProcessingContext): Promise<FileProcessingContext>;
}
```

Weil Ein- und Ausgabe dieselbe Form haben, sind die Stufen frei kombinierbar:
Ein Export läuft ebenso auf dem Ergebnis von Step 1 wie auf dem einer
Konsolidierung. Die Kette ist die Reihenfolge der Registrierung, nichts im Code
setzt eine bestimmte Abfolge voraus (§76).

Zwei Punkte, die dabei zählen:

- `sha256` ist die Prüfsumme des **Inhalts** vor einer Verschlüsselung — der
  Wert, mit dem die Dublettenerkennung arbeitet. Bei `encrypted: true` ist es
  bewusst nicht die Prüfsumme der Bytes unter `currentFilePath`.
- Eine Stufe, die die Datei neu schreibt, muss die neue Prüfsumme mitliefern.
  Andernfalls bricht die Registry ab, statt eine Integrität weiterzureichen, die
  niemand geprüft hat.

Scheitert eine Stufe, bleibt Step 1 gültig: die Datei ist gespeichert und
registriert, die Quelldatei bereits archiviert oder gelöscht. Der Fehler wird
als `PROCESSING_STAGE_FAILED` gemeldet und protokolliert, der Transfer aber
nicht rückwirkend für fehlgeschlagen erklärt.

### Verschlüsselung in der Kette

Eine verschlüsselt abgelegte Datei kann keine Stufe direkt lesen. Dafür gibt es
zwei Stufen, beide im Modul `ENCRYPTION` — wer das Schloss kauft, bekommt auch
den Schlüssel:

| Stufe | Aufgabe |
| ----- | ------- |
| `DecryptForProcessingStage` | Entschlüsselt für die folgenden Stufen. Als erste registrieren. |
| `EncryptResultStage` | Verschlüsselt das Ergebnis vor der Auslieferung. Als letzte registrieren. |

Der Klartext entsteht **ausschließlich im Staging-Verzeichnis**, das am Ende
jedes Laufs gelöscht wird. Die verschlüsselte Datei im Zielverzeichnis bleibt
unangetastet — die Zusage aus §45, dass im Ziel kein Klartext liegt, gilt
weiter, auch während Step 2 auf dem Inhalt arbeitet.

`EncryptResultStage` bekommt **einen eigenen Schlüssel je Ziel**, nicht den des
Quell-Jobs. Eine Datei, die an einen Empfänger geht, muss von diesem lesbar
sein; mit unserem Schlüssel wäre sie es nicht.

Beim Entschlüsseln wird geprüft, ob der Inhalt der Prüfsumme entspricht, die
Step 1 vor dem Verschlüsseln festgehalten hat. Ein falscher Schlüssel oder eine
veränderte Datei fällt damit auf, bevor eine Folgestufe darauf aufsetzt — und
hinterlässt keinen halb geschriebenen Klartext.

## Datenablage

Alles Dauerhafte liegt unter `application-data/`:

| Inhalt | Ablage |
| ------ | ------ |
| Jobs, Läufe, Zugangsdaten, Datei-Historie, Protokoll | `unikom.db` (SQLite) |
| Arbeitsverzeichnis während eines Laufs | `staging/<run-id>/` |

Das Staging-Verzeichnis wird nach jedem Lauf geleert. Dateien erreichen das
Zielverzeichnis ausschließlich als fertiges, atomar verschobenes Ergebnis.

## Architektur

```text
src/
  domain/          Modelle und Regeln (Transfer, Quelle, Zugangsdaten, Verschlüsselung,
                   Module, Übergabevertrag, Benutzer)
  application/     Pipeline, Scheduler, Laufzeit, Credential-Verwaltung, Lizenzprüfung,
                   Stufen-Registry, Aufbewahrung, Anmeldung
  infrastructure/  Quell-Adapter (Local/SFTP/FTPS), Persistenz, Krypto, Dateisystem
  interface/       HTTP-API und Auslieferung der Oberfläche
  testing/         Testhilfen inklusive echter SFTP- und FTPS-Server
web/
  src/             Oberfläche (React), gebaut nach dist/web
```

Die Oberfläche greift **ausschließlich über die API** zu, nie direkt auf ein
Repository. Nicht wegen eines späteren Umzugs in die Cloud — den gibt es nicht,
das Produkt ist lokal — sondern weil sich sonst Geschäftslogik in der
Oberfläche ansammelt, wo sie nicht hingehört und nicht geprüft wird.

Änderungen brauchen neben dem Sitzungs-Cookie ein Begleit-Token im Kopf
`x-unikom-csrf`. Das Cookie allein ist kein Beleg dafür, dass eine Anfrage
gewollt war — ein Browser schickt es auch bei einer Anfrage mit, die eine
fremde Seite ausgelöst hat.

Scheduler, UI, CLI und API laufen alle über denselben
`TransferExecutionService` — es gibt keine getrennte Transferlogik für manuelle
und automatische Läufe. Protokollspezifisches Verhalten steckt ausschließlich in
den jeweiligen Quell-Adaptern.

## Sicherheit

- SSH-Host-Keys werden geprüft. Ohne hinterlegten Fingerabdruck wird die
  Verbindung abgelehnt; das Abschalten erfordert die ausdrückliche Option
  `allowUnknownHostKey`.
- TLS-Zertifikate werden geprüft. Für private oder selbst signierte Zertifikate
  kann eines über `trustedCertificate` hinterlegt werden, statt die Prüfung
  ganz abzuschalten.
- Passwörter, private Schlüssel und Verschlüsselungsschlüssel erscheinen weder
  im Log noch in Exporten, Fehlermeldungen oder der Datenbank. Abgesichert durch
  [SecretsNeverLeak.test.ts](src/application/credentials/SecretsNeverLeak.test.ts).
- Entfernte Dateinamen können das Ziel- oder Staging-Verzeichnis nicht verlassen.

## Abweichungen von der Spec

Bewusste Entscheidungen gegen den Wortlaut der Spec. Sie stehen hier, damit sie
beim nächsten Abgleich nicht als Lücke erscheinen:

| Stelle | Abweichung | Grund |
| ------ | ---------- | ----- |
| §39–40, §108 | Die Erkennung inhaltsgleicher Dateien ist ein Job-Schalter, voreingestellt **aus** | Welche Dateien eine Quelle liefert, ist ihre Entscheidung. Der Wiederholungsschutz ist davon unberührt und bleibt fest. |
| §21 | Benutzerdefinierte Cron-Ausdrücke lösen einen klaren Fehler aus | Besser als still falsch zu rechnen |

## Stand

Umgesetzt sind die Phasen 1 bis 11 der Spec mit den oben genannten
Abweichungen. Damit ist auch Kriterium 41 erfüllt: Step 2 kann an
`STEP_1_COMPLETED` angeschlossen werden, und der Vertrag dafür existiert.

Offen ist die Oberfläche (§83–94). Für Step 2 und Step 3 stehen Vertrag,
Registry, Lizenzprüfung sowie Ver- und Entschlüsselung in der Kette bereit; die
fachlichen Stufen selbst sind noch nicht gebaut.

Geplant, aber noch nicht als Modul angelegt: ein entferntes **Ziel** für Step 3
(Upload nach SFTP/FTPS). Das ist eine andere Fähigkeit als `REMOTE_SOURCES`,
das ausschließlich eingehend arbeitet — Hochladen schreibt in ein fremdes
System, mit eigener Konfliktstrategie und eigener Fehlerbehandlung. Es wird
daher ein eigenes, getrennt lizenziertes Modul. Der Name steht erst im Code,
wenn die Fähigkeit existiert; jedes Modul in `FEATURES` wird auch tatsächlich
irgendwo geprüft.

Ebenfalls vorgesehen: Einstellungen später über Supabase. Weil die Persistenz
hinter Repository-Schnittstellen liegt, ist das eine weitere Implementierung
neben SQLite und kein Umbau.

Der Scheduler läuft, solange `startPolling()` aktiv ist; ein Dienst-Wrapper für
Windows oder systemd existiert noch nicht.
