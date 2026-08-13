# FR_003 — Step 3: Feldzuordnung für Export und Migration

**Stand:** 2026-08-13 · **Status:** Anforderung erfasst, nicht umgesetzt

Festgehalten aus dem Gespräch, bevor die Oberfläche gebaut wird. Dieses Dokument
beschreibt, *was* gebraucht wird und *warum* — nicht, wie es umgesetzt wird.

---

## 1. Ausgangslage

Nach Step 2 liegen konsolidierte Daten lokal bereit: Felder, die aus einer oder
mehreren übernommenen Dateien entstanden sind, geprüft und gegebenenfalls
korrigiert und ergänzt.

Step 3 bringt diese Daten heraus — entweder als Datei in einem Zielformat oder
direkt in Datenbanktabellen. Beides sind getrennte Module
(`STEP_3_FILE_EXPORT`, `STEP_3_DATABASE_MIGRATION`), weil sie sich im Aufwand
deutlich unterscheiden.

Dazwischen steht die Frage, die dieses Dokument behandelt: **Welches Feld gehört
wohin?**

---

## 2. Die Zuordnung gehört zum Mandanten

Ein Kunde liefert und erwartet in aller Regel immer dieselbe Struktur, unabhängig
davon, aus welchem Job eine Datei stammt. Die Zuordnung ist deshalb ein **Profil
am Mandanten**, kein Feld am einzelnen Job.

Läge sie am Job, würde dieselbe Zuordnung an fünf Stellen gepflegt und an vier
davon vergessen, sobald sich etwas ändert.

Ein Mandant kann mehrere Profile haben — etwa eines für den täglichen Export und
eines für die monatliche Migration. Ein Job verweist auf ein Profil.

---

## 3. Die Zielstruktur festlegen

Der Benutzer muss auf drei Wegen sagen können, wie das Ziel aussieht:

### 3.1 Mustervorlage hochladen

Eine leere Datei mit Überschriftenzeile wird hochgeladen; Unikom liest daraus
die Zielfelder und ihre Reihenfolge. Das ist der bequemste Weg, weil der Kunde
so eine Vorlage meist ohnehin hat.

### 3.2 Feldliste von Hand

Die Zielfelder werden aufgezählt — Name, Datentyp, Pflichtfeld ja/nein.

### 3.3 Positionen statt Namen

Für Formate ohne Überschriftenzeile: Feld 1, Feld 2, Feld 3. Die Position ist
dann die Identität des Feldes.

---

## 4. Die Zuordnung herstellen

### 4.1 Automatisch

Über Namensgleichheit, ergänzt um eine Normalisierung (Groß-/Kleinschreibung,
Leerzeichen, Umlaute). Der Vorschlag wird dem Benutzer gezeigt, **nicht still
angewendet** — er muss ihn bestätigen können.

### 4.2 Fest nach Vorgabe

Der Benutzer legt jede Zuordnung selbst fest. Das ist der Normalfall bei Kunden
mit eigenen Feldbezeichnungen.

Beides muss mischbar sein: automatisch vorschlagen, einzelne Zuordnungen
korrigieren.

---

## 5. Positionsbasierte Zuordnung braucht eine Absicherung

**Das ist der wichtigste Punkt dieses Dokuments.**

Namensbasierte Zuordnung bricht *laut*: Fehlt ein Feld, gibt es einen Fehler,
und jemand sieht ihn.

Positionsbasierte Zuordnung bricht *leise*. Fügt das Quellsystem eine Spalte
ein, rutscht alles um eine Position, und ab diesem Moment stehen Werte in
falschen Feldern. Formal ist alles in Ordnung — die Datei hat Spalten, die
Spalten haben Werte, kein Schritt schlägt fehl. Der Fehler fällt erst auf, wenn
beim Empfänger etwas Unsinniges ankommt, möglicherweise Wochen später.

Deshalb muss ein positionsbasiertes Profil zusätzlich festhalten, was es
erwartet, und das prüfen:

- **erwartete Spaltenanzahl** — weicht sie ab, bricht der Lauf ab statt falsch
  zuzuordnen
- optional **Stichproben-Prüfung**: erwarteter Datentyp oder Muster je Position

Ohne diese Prüfung ist die positionsbasierte Zuordnung ein stiller Datenfehler,
der auf ein Zutun wartet.

---

## 6. Weitere Punkte, die aus der Zuordnung folgen

| Punkt | Warum |
| ----- | ----- |
| **Umwandlung je Feld** | Datumsformate, Dezimaltrennzeichen und Zahlenformate unterscheiden sich zwischen Quelle und Ziel. Ohne Umwandlung ist die Zuordnung allein wertlos. |
| **Feste Werte** | Manche Zielfelder werden nicht zugeordnet, sondern gesetzt — Mandantenkennung, Lieferdatum, Herkunft. |
| **Nicht zugeordnete Felder** | Muss entscheidbar sein: leer lassen, oder den Lauf ablehnen. Beides ist je nach Kunde richtig. |
| **Vorschau** | Vor dem ersten echten Lauf muss sichtbar sein, was herauskäme. Eine Zuordnung, die man erst nach der Auslieferung prüfen kann, ist eine, die man nicht prüft. |
| **Versionierung** | Ändert sich ein Profil, muss nachvollziehbar bleiben, mit welcher Fassung ein früherer Export erzeugt wurde. |

---

## 7. Abgrenzung

Nicht Teil dieser Anforderung:

- **Datensatz-Dubletten** — das ist Step 2 und arbeitet auf Datensätzen
  *innerhalb* der Daten. Nicht zu verwechseln mit der Dateidublettenerkennung
  aus Step 1, die auf ganzen Dateien arbeitet.
- **Wohin geliefert wird** — Zielsystem, Verzeichnis oder entferntes Ziel sind
  eine eigene Frage. Ein Upload nach SFTP/FTPS wird ein eigenes Modul.
- **Verschlüsselung des Ergebnisses** — bereits umgesetzt
  (`EncryptResultStage`, eigener Schlüssel je Ziel).

---

## 8. Einschätzung

Das wird der aufwendigste und individuellste Teil der Anwendung. Der Aufwand
steckt nicht im Umwandeln der Daten, sondern in der Oberfläche: Der Benutzer muss
zwei Feldlisten nebeneinander sehen, verbinden, korrigieren und das Ergebnis
prüfen können, bevor etwas hinausgeht.

Das ist auch der Grund, warum die Oberfläche mit React und einem Build-Schritt
gebaut wird statt mit serverseitigem HTML — für Step 1 wäre das Einfachere
genug gewesen, für diesen Bildschirm nicht.
