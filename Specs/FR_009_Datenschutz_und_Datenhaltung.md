# FR_009 — Datenschutz und Datenhaltung

**Status:** FINAL
**Version:** 1.2
**Gilt für:** alle Module
**Abhängigkeiten:** SPEC-01 (Speicherung, Verzeichnisse), SPEC-02 (Protokollierung, Konflikte),
SPEC-05 (Nachvollziehbarkeit), SPEC-07 (Konfliktbestand), SPEC-11 (KI-Ausbaustufe)

Diese Spec beschreibt Technik, nicht Recht. Sie legt fest, **was Unikom
speichert, wo, wie lange, wer es sieht und wie es wieder verschwindet** — die
Fragen, die ein Datenschutzbeauftragter als erste stellt. Ob das im Einzelfall
genügt, beurteilt jemand mit der entsprechenden Zulassung.

---

## 1. Die Ausgangslage: das Haus des Kunden

Unikom läuft beim Kunden. Der Kunde ist Verantwortlicher für die Daten, die er
damit verarbeitet.

Solange keine Daten zum Hersteller fließen, gibt es beim Hersteller nichts zu
verarbeiten. Diese Eigenschaft ist kein Zufall, sondern eine Zusage, und sie ist
an mehreren Stellen bereits festgeschrieben:

* SPEC-01, Abschnitt 3 und 30 — die Kundendaten verlassen die lokale Umgebung nicht
* SPEC-11 — eine KI-gestützte Erkennung ist nicht Bestandteil von V1; wo sie
  später hinzukäme, ist die Frage nach dem Datenabfluss ausdrücklich offen

**Verbindlich:** Unikom sendet von sich aus nichts nach außen. Keine Telemetrie,
keine Nutzungsstatistik, keine Fehlerberichte, keine Modellanfragen. Was hinaus
geht, geht ausschließlich in ein Ziel, das der Kunde selbst eingerichtet hat.

Für ein Produkt, das gegen Cloud-Anbieter antritt, ist das kein Zugeständnis,
sondern das stärkste Argument, das es hat.

---

## 2. Was Unikom speichert

Vollständige Aufstellung. Neue Bestände sind hier zu ergänzen; ein Bestand, der
hier fehlt, darf nicht entstehen.

| Bestand | Inhalt | Ort | Personenbezug |
| --- | --- | --- | --- |
| Laufprotokoll | Schritte, Dateinamen, Zählwerte, Fehler | SQLite | mittelbar (Dateinamen) |
| Änderungsprotokoll | wer wann was geändert hat | SQLite | ja (Benutzer) |
| Verarbeitungshistorie | Läufe, Status, Statistik | SQLite | mittelbar |
| Konfliktbestand | **Feldwerte im Klartext** | SQLite | ja |
| Ergebnisbestand | die konsolidierten Daten | Dateisystem | ja |
| Arbeitsbestand, Ausleitungen | Zwischenstände | Dateisystem | ja |
| Eingangsdateien | was der Kunde bereitstellt, auch abgelegte E-Mails | Dateisystem | ja |
| Benutzer | Name, Anmeldename, Kürzel, Passworthash | SQLite | ja |
| Zugänge | Kennwörter und Schlüssel fremder Systeme | SQLite, einzeln verschlüsselt | nein |
| Mandanten, Workflows, Strukturen | Einstellungen | SQLite | nein |

Dass der Konfliktbestand die ursprünglichen Werte enthält, ist gewollt und in
SPEC-02, Abschnitt 22, festgelegt: Ohne den Wert lässt sich ein Konflikt nicht
bearbeiten. Er ist damit der Bestand mit dem dichtesten Personenbezug und der
erste, den ein Löschauftrag trifft.

---

## 3. Datensparsamkeit

**Es wird nur mitgenommen, was gebraucht wird.**

Die Blockerkennung (FR_007) übernimmt ausschließlich den erkannten Datenblock.
Anrede, Signatur, Grußformel und alles Übrige einer Nachricht wandern **nicht**
in den Datenbestand. Das ist keine Nebenwirkung, sondern eine Eigenschaft, die
zu erhalten ist.

**Verbindlich:**

* Das Betriebsprotokoll enthält keine Feldwerte. Zählwerte, Dateinamen,
  Entscheidungen — ja. Der Inhalt einer Zeile — nein.
* Der Inhalt einer Anfrage wird nie protokolliert. Er trägt Kennwörter und
  Schlüssel; diese Regel gilt bereits und bleibt.
* Wo ein Wert zur Bearbeitung eines Konflikts nötig ist, wird er im
  Konfliktbestand geführt und nicht zusätzlich im Protokoll.

---

## 4. Aufbewahrung

Jeder Bestand hat eine Frist. Eine Frist ohne Voreinstellung ist keine.

| Bestand | Voreinstellung | Einstellbar |
| --- | --- | --- |
| Laufprotokoll | 90 Tage | je Workflow |
| Verarbeitungshistorie | 90 Tage | je Workflow |
| Arbeitsbestände und Ausleitungen | nach erfolgreichem Abschluss | je Workflow |
| Konfliktbestand | bis bearbeitet, danach 90 Tage | je Workflow |
| Eingangsdatei nach Verarbeitung | **entfernen** | je Workflow |
| Ergebnisbestand | unbegrenzt | je Mandant |

**Neu gegenüber heute:** Die Voreinstellung für die Eingangsdatei lautet
*entfernen*, nicht *liegen lassen*. Eine abgelegte E-Mail, die nach der
Verarbeitung im Eingangsverzeichnis stehen bleibt, ist ein Bestand, den niemand
verwaltet.

**Ebenfalls neu:** Die geltenden Fristen sind je Mandant an einer Stelle
sichtbar. Heute stehen sie verstreut in den Workflows, und wer sie beauskunften
soll, muss sie zusammensuchen.

---

## 5. Löschauftrag für eine betroffene Person

Die Funktion, die heute fehlt.

Unikom muss die Daten einer bestimmten Person über **alle** Bestände hinweg
finden und entfernen können. Gesucht wird über die Felder, die der Mandant
dafür benennt — Kundennummer, Name, E-Mail-Adresse, Kombinationen davon.

Ablauf:

```text
Suchen  →  Anzeigen, was gefunden wurde und wo
        →  Bestätigen durch einen Menschen
        →  Entfernen
        →  Bestätigung mit Angabe, was entfernt wurde
```

**Nie ohne Anzeige.** Ein Löschauftrag, der sofort ausführt, ist nicht
umkehrbar und trifft im Zweifel den Falschen.

### Der Widerspruch zur Nachvollziehbarkeit

SPEC-05, Abschnitt 13, und SPEC-07, Abschnitt 12, verlangen eine unveränderbare
Historie. Ein Löschauftrag verlangt das Gegenteil. Beides gilt, und deshalb ist
zu unterscheiden:

**Es bleibt:** dass ein Lauf stattgefunden hat, seine Kennung, seine Zählwerte,
die getroffenen Entscheidungen, wer sie getroffen hat.

**Es geht:** die personenbezogenen Werte in Konflikten, Ergebnissen und
Eingangsdateien.

**Es kommt hinzu:** ein Vermerk, dass gelöscht wurde, mit Zeitpunkt, Benutzer
und Umfang — aber ohne die gelöschten Werte zu wiederholen.

Damit bleibt die Verarbeitung nachvollziehbar, ohne dass die Daten weiter
vorgehalten werden. Ein Lauf, aus dem gelöscht wurde, sagt das von sich aus;
eine stillschweigend gelöschte Historie wäre schlimmer als beides.

### Was Unikom nicht kann

Ein Ergebnisbestand, der bereits exportiert oder in eine fremde Datenbank
geschrieben wurde, liegt außerhalb. Unikom muss beim Löschauftrag **anzeigen**,
in welche Ziele die betroffenen Daten geflossen sind, damit der Kunde dort
nachfassen kann. Es darf nicht den Eindruck erwecken, mit dem eigenen Löschen
sei die Sache erledigt.

---

## 6. Auskunft

Dieselbe Suche, ohne den zweiten Schritt: Was liegt zu dieser Person vor, in
welchem Bestand, seit wann, aus welchem Lauf.

Das Ergebnis muss als Datei ausgeleitet werden können — der Kunde muss es
weitergeben, nicht abtippen.

---

## 7. Zugriff

Vorhanden und hier nur festgehalten:

* Zwei Berechtigungsstufen; Zugänge und Benutzerverwaltung sind dem
  Administrator vorbehalten
* Jede ändernde Handlung wird mit Benutzerkennung und Anmeldenamen
  protokolliert
* Ein Zugang trägt sein Kennwort verschlüsselt, mit einem Hauptschlüssel, den
  das Betriebssystem verwahrt

### Ein eigenes Recht für den Konfliktbestand

**Entschieden:** Der Zugriff auf Konfliktdaten hängt an einem eigenen Recht, das
am **Benutzer** hängt und nicht an seiner Berechtigungsstufe.

Der Grund ist der Bestand selbst: Dort stehen die ursprünglichen Feldwerte im
Klartext (SPEC-02, Abschnitt 22), und das ist der dichteste Personenbezug im
ganzen System. Wer ihn sehen darf, soll namentlich feststehen und sich nicht aus
einer Stufe ergeben, in der zwanzig Leute sind.

Auch ein Administrator bekommt es nicht von selbst. Er kann es sich geben — dann
ist es aber eine Handlung, die im Änderungsprotokoll steht, und die Frage „wer
darf die Werte sehen" bleibt aus der Benutzerliste beantwortbar.

Damit bleibt es bei zwei Berechtigungsstufen; das Recht steht daneben, nicht
darüber.

---

## 8. E-Mail-Nachrichten als Eingang

**Unikom greift nicht auf Postfächer zu.**

Ein Zugang zu einem Postfach berechtigt zu allem, was darin liegt — auch zu
Nachrichten, die Unikom nichts angehen. Kennwörter fremder Postfächer in der
Verwahrung eines Verarbeitungsprogramms sind ein Risiko, dem kein Nutzen
gegenübersteht.

Stattdessen:

```text
Regel im Mailsystem des Kunden
        ↓
Nachricht wird als Datei abgelegt
        ↓
Unikom holt aus dem Verzeichnis ab   (vorhandene Abholung)
        ↓
Erkennung von Rumpf und Anhängen     (FR_007)
        ↓
Eingangsdatei wird entfernt          (Abschnitt 4)
```

Der Kunde entscheidet damit in seinem eigenen System, was Unikom überhaupt zu
sehen bekommt. Das ist eine dokumentierbare Zweckbindung und keine
Auslegungssache.

**Zu beachten:** Eine abgelegte Nachricht trägt mehr als ihre Daten — Kopfzeilen
mit weiteren Empfängern, Signaturen, Freitext. Sie fällt deshalb unter die
Voreinstellung *entfernen* aus Abschnitt 4, und aus ihr wird nur der erkannte
Block übernommen (Abschnitt 3).

---

## 9. Das Auskunftsdokument im Produkt

Unikom soll eine Seite besitzen, die ein Datenschutzbeauftragter allein lesen
kann. Sie zeigt für diese Installation:

* welche Bestände es gibt und was darin steht
* wo sie liegen
* welche Fristen gelten, je Mandant
* wer worauf Zugriff hat
* wie gelöscht und beauskunftet wird
* dass und warum nichts nach außen geht

Erzeugt aus dem tatsächlichen Zustand, nicht aus einer Textvorlage. Ein
Dokument, das die Wirklichkeit beschreibt, altert nicht.

---

## 10. Verschlüsselung im Ruhezustand — offene Entscheidung

Die Datenbank ist heute nicht verschlüsselt. Zugangsdaten sind es einzeln;
personenbezogene Werte in Konflikten und Ergebnissen liegen im Klartext auf der
Platte des Kunden.

Drei Wege:

**a) So lassen.** Die Platte ist Sache des Kunden; Windows und Linux bringen
Festplattenverschlüsselung mit. Unikom sagt in Abschnitt 9, dass es so ist.

**b) Werte einzeln verschlüsseln,** wie die Zugangsdaten. Schützt gegen eine
kopierte Datei, kostet aber jede Suche über diese Werte — und die
Konfliktbearbeitung lebt vom Suchen.

**c) Die ganze Datei verschlüsseln.** Braucht eine Erweiterung, die SQLite nicht
mitbringt, und damit Fremdcode im Haus des Kunden.

**Entschieden: a.** Die Datenbank bleibt unverschlüsselt.

Daraus folgen zwei Pflichten, die keine Kür sind:

* Die Auskunftsseite (Abschnitt 9) sagt es ausdrücklich, statt es zu verschweigen.
* Bei der Einrichtung wird darauf hingewiesen, das Datenverzeichnis auf einer
  verschlüsselten Platte zu halten — Windows und Linux bringen das mit.

Der Weg b — Werte einzeln verschlüsseln — scheiterte an der Konfliktbearbeitung:
Sie lebt vom Suchen über eben diese Werte. Der Weg c hätte Fremdcode in das Haus
des Kunden gebracht, was diesem Produkt widerspricht.

---

## 11. Was daraus zu bauen ist

Alle Positionen sind umgesetzt. Sie bleiben als Verzeichnis stehen, damit ein
später hinzukommender Bestand daran geprüft werden kann.

1. ~~Löschauftrag über alle Bestände, mit Anzeige vor der Ausführung
   (Abschnitt 5)~~ — gebaut. Suchen, Anzeigen, Bestätigen, Ausführen; ohne
   ausdrückliche Bestätigung führt die Schnittstelle nichts aus.
2. ~~Auskunft mit Ausleitung (Abschnitt 6)~~ — gebaut. Die Datei entsteht auf
   dem Server aus einem zweiten, unbegrenzten Suchlauf: Der Bildschirm zeigt
   fünfzig Fundstellen je Bestand, die Auskunft führt jede auf. Greift eine
   Grenze doch, steht es in der Datei.
3. ~~Voreinstellung „Eingangsdatei nach erfolgreicher Verarbeitung entfernen"
   (Abschnitt 4)~~ — umgesetzt, für neu angelegte Workflows.
4. ~~Fristen je Mandant sichtbar (Abschnitt 4)~~ — gebaut. Sie werden aus den
   Workflows gelesen und nicht ein zweites Mal gepflegt; eine Frist, die nur
   die Voreinstellung ist, ist als solche gekennzeichnet.
5. ~~Die Auskunftsseite (Abschnitt 9)~~ — gebaut, im Bereich *Datenauskunft*.
6. ~~Entscheidung zu Abschnitt 10~~ — entschieden: Die Datenbank bleibt
   unverschlüsselt, und die Auskunftsseite sagt es. Damit entfällt eine
   Umsetzung.
7. ~~Entscheidung zum eigenen Recht für den Konfliktbestand~~ — entschieden und
   umgesetzt: Das Recht steht am Benutzer und ist im Benutzerformular zu
   erteilen. Es greift, sobald es einen Konfliktbestand gibt (SPEC-07).

### Was beim Bauen dazukam

**Die Eingrenzung auf einen Mandanten ist verbindlich.** Ein Bestand, der sie
nicht leisten kann, wird bei einem eingegrenzten Löschauftrag **nicht**
ausgeführt, sondern vorgelegt.

Der Grund ist ein Schaden, den niemand bemerkt hätte: Wer „nur Mandant A"
aufträgt und dabei die Zeilen von B mitschwärzt, hat mehr getan als beauftragt,
es ist nicht zurückzuholen, und es steht nirgends. Protokoll und Dateiliste
kennen den Workflow, nicht den Mandanten; sie lösen ihn deshalb über die
Workflows des Mandanten auf.

**Der Löschbeleg** entsteht im selben Zug wie die Löschung. Später ließe er
sich nicht mehr erzeugen: Eine zweite Suche fände nichts mehr und belegte gar
nichts. Er nennt Umfang, Zeitpunkt und Urheber — und wiederholt die gelöschten
Werte nicht.

---

## Status

**FR_009 — FINAL und umgesetzt.** Die Entscheidungen aus Abschnitt 7 und 10
sind getroffen, die Liste in Abschnitt 11 ist abgearbeitet.

## Änderungsverzeichnis

### Version 1.2

Abschnitt 11: Alle Positionen umgesetzt und als solche gekennzeichnet.

Neu festgehalten, weil es beim Bauen aufkam: Die Eingrenzung auf einen Mandanten
ist verbindlich — ein Bestand, der sie nicht leisten kann, wird bei einem
eingegrenzten Löschauftrag vorgelegt statt ausgeführt. Dazu der Löschbeleg, der
im Augenblick der Löschung entsteht.

### Version 1.1

Abschnitt 7: Das eigene Recht für den Konfliktbestand ist entschieden und im
Benutzermodell umgesetzt.

Abschnitt 10: Die Verschlüsselung im Ruhezustand ist entschieden — sie bleibt
aus, dafür sagt es die Auskunftsseite ausdrücklich.

### Version 1.0

Neu angelegt. Anlass war die Entscheidung, nicht auf Postfächer zuzugreifen,
sondern abgelegte Nachrichten aus einem Verzeichnis zu holen — und die Frage,
die dahinter stand: Was speichert Unikom eigentlich, und wie wird man es wieder
los.
