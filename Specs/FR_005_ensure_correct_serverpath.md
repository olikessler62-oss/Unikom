# UniCom – Spec: Remote-Pfadauflösung für SFTP/FTPS

## Ziel

UniCom soll Benutzern ermöglichen, Remote-Verzeichnisse auf SFTP- und FTPS-Servern anzugeben, ohne dass sie zwingend den vollständigen Serverpfad kennen müssen.

Unterschiedliche Schreibweisen des Benutzers sollen toleriert werden. Die Pfadauflösung muss zentral erfolgen und darf nicht durch zahlreiche `if/else`-Abfragen in den einzelnen Workflows implementiert werden.

## 1. Remote-Verbindung

Jede SFTP-/FTPS-Verbindung kann einen optionalen `RemoteWorkingDirectory` bzw. Startpfad besitzen.

Beispiel:

```text
/
```

oder:

```text
/customer123
```

Dieser Pfad definiert den Einstiegspunkt, von dem aus relative Benutzerpfade aufgelöst werden.

## 2. Benutzereingabe

Der Benutzer darf einen Remote-Pfad in unterschiedlichen Schreibweisen eingeben.

Beispiele:

```text
orders/incoming
/orders/incoming
\orders\incoming
/orders/incoming/
orders//incoming
```

Diese Schreibweisen sollen nach Möglichkeit auf denselben logischen Pfad abgebildet werden.

## 3. Zentrale Pfadauflösung

Eine zentrale Komponente `RemotePathResolver` implementieren.

Beispiel:

```text
resolve(userPath, remoteWorkingDirectory)
```

Die Komponente übernimmt mindestens:

* führende und nachfolgende Leerzeichen entfernen
* `\` in `/` umwandeln
* doppelte `/` normalisieren
* führenden/trailing `/` konsistent behandeln
* relative Pfade relativ zum `RemoteWorkingDirectory` auflösen
* `.`-Segmente normalisieren
* `..`-Segmente kontrollieren
* Pfadtraversal außerhalb des erlaubten Bereichs verhindern

Die eigentliche SFTP-/FTPS-Kommunikation darf keine eigene Pfadnormalisierungslogik enthalten.

## 4. Relativer Pfad

Wenn der Benutzer nur einen Unterpfad angibt, soll dieser relativ zum konfigurierten Remote-Arbeitsverzeichnis interpretiert werden.

Beispiel:

```text
RemoteWorkingDirectory:
/customer123

Benutzereingabe:
orders/incoming

Ergebnis:
/customer123/orders/incoming
```

Der Benutzer muss den physikalischen Root-Pfad des Servers nicht kennen.

## 5. Server-Root nicht voraussetzen

UniCom darf nicht davon ausgehen, dass `/` dem physikalischen Root-Verzeichnis des Servers entspricht.

SFTP-/FTPS-Server können Benutzer in virtuelle Verzeichnisse bzw. Chroot-Verzeichnisse einschränken.

UniCom arbeitet deshalb ausschließlich mit den vom jeweiligen Server gelieferten Remote-Pfaden.

## 6. Verzeichnis-Browser

Zusätzlich zur manuellen Eingabe soll UniCom einen Remote-Verzeichnisbrowser anbieten.

UI:

```text
Remote-Quellverzeichnis

[ orders/incoming                 ] [ Verzeichnis auswählen ]
```

Bei Auswahl von „Verzeichnis auswählen“:

1. Verbindung zum Server herstellen.
2. Aktuelles Remote-Arbeitsverzeichnis öffnen.
3. Verzeichnisstruktur anzeigen.
4. Benutzer kann ein Verzeichnis auswählen.
5. Ausgewählter Pfad wird in das Eingabefeld übernommen.
6. Der tatsächlich vom Server gelieferte Pfad wird verwendet.

Beispiel:

```text
/
├── orders
│   ├── incoming
│   └── archive
├── invoices
└── reports
```

Benutzer wählt:

```text
orders/incoming
```

## 7. Pfadprüfung

Nach der Auflösung muss UniCom prüfen, ob das Zielverzeichnis erreichbar bzw. vorhanden ist.

Ergebnis im UI:

```text
✓ Verzeichnis gefunden
```

oder:

```text
✗ Verzeichnis nicht gefunden
```

Bei Fehlern soll die ursprüngliche Benutzereingabe nicht automatisch überschrieben werden.

## 8. Optional: Verzeichnissuche

Falls die manuelle Angabe eines Unterverzeichnisses nicht eindeutig ist, kann später eine Suchfunktion ergänzt werden.

Beispiel:

Benutzer gibt ein:

```text
incoming
```

UniCom kann innerhalb des zugänglichen Verzeichnisbaums nach passenden Verzeichnissen suchen:

```text
/incoming
/customer123/incoming
/data/transfer/incoming
```

Der Benutzer wählt anschließend den gewünschten Treffer.

Diese Funktion ist zunächst optional und muss nicht Teil der ersten Implementierung sein.

## 9. Sicherheitsanforderungen

Ein Benutzer darf durch Pfadangaben wie

```text
../../othercustomer
```

oder entsprechende Varianten niemals außerhalb des erlaubten Remote-Bereichs gelangen.

Die Prüfung muss nach der Normalisierung erfolgen.

Keine reine String-Prüfung verwenden, bei der beispielsweise

```text
/customer1234
```

fälschlicherweise als Unterpfad von

```text
/customer123
```

akzeptiert wird.

Die Prüfung muss auf vollständigen Pfadsegmenten basieren.

## 10. Architektur

Die Pfadauflösung muss protokollunabhängig implementiert werden.

Nicht:

```text
SftpPathResolver
FtpsPathResolver
```

sondern:

```text
RemotePathResolver
```

SFTP- und FTPS-Adapter liefern lediglich die jeweilige Remote-Verzeichnisstruktur bzw. Serverinformationen.

Der Resolver darf keine Kenntnisse über den konkreten Workflow besitzen.

## 11. Verwendung in UniCom

Die zentrale Pfadauflösung soll für alle Stellen verwendet werden, an denen Remote-Pfade benötigt werden:

* SFTP-Quelle
* SFTP-Ziel
* FTPS-Quelle
* FTPS-Ziel
* Workflow-Konfiguration
* Verzeichnisbrowser
* Verbindungstest

Ziel ist, dass Workflows ausschließlich mit bereits aufgelösten und validierten Remote-Pfaden arbeiten.

## Akzeptanzkriterien

* `orders/incoming` funktioniert.
* `/orders/incoming` funktioniert.
* `\orders\incoming` funktioniert.
* Überflüssige `/` werden normalisiert.
* Ein konfigurierter `RemoteWorkingDirectory` wird bei relativen Pfaden berücksichtigt.
* Der Benutzer muss den physikalischen Server-Root nicht kennen.
* Ein Remote-Verzeichnis kann über einen Verzeichnisbrowser ausgewählt werden.
* Nicht vorhandene Verzeichnisse werden verständlich gemeldet.
* `..` kann nicht zur Umgehung des erlaubten Bereichs verwendet werden.
* Die gleiche Logik funktioniert für SFTP und FTPS.
* Keine verstreuten Pfad-`if/else`-Sonderfälle in den Workflows.
* Die Pfadauflösung ist zentral über `RemotePathResolver` implementiert.
