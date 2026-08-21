# SPEC-11 – KI-gestützte Erkennung (Ausbaustufe)

**Status:** ENTWURF — **nicht Bestandteil von UniCom V1**
**Version:** 1.0
**Abhängigkeit:** SPEC-01, SPEC-04, SPEC-08, SPEC-09

## 1. Zweck und Geltung

SPEC-11 beschreibt, unter welchen Bedingungen UniCom eine KI-gestützte Erkennung
einsetzen darf, wenn sie später gebaut wird.

**In V1 gibt es sie nicht.** Diese Spec ist eine Vorfestlegung, damit die
Ausbaustufe nicht später an den Zusagen von SPEC-01 vorbei entsteht.

Sie ersetzt den Verweis in SPEC-04, Abschnitt 9, auf „die bereits definierten
Modi". Diese Modi waren bis Version 1.0 von SPEC-04 nirgends definiert.

## 2. Die drei Modi

### KI AUS

Nur deterministische Regeln, Mustererkennung über Stichproben und bestätigte,
gelernte Zuordnungen.

**Das ist der Zustand von V1 und die Voreinstellung jeder späteren Fassung.**

### Nur Vorschläge

Die KI darf Vorschläge erzeugen. Sie darf keine Daten verändern, keine Zuordnung
festlegen und keine Regel in Kraft setzen.

Jeder Vorschlag ist als solcher erkennbar und nennt seine Grundlage.

### Automatisch

Die KI darf eine Entscheidung oder Korrektur selbst anwenden, wenn die Confidence
die Schwelle aus SPEC-02, Abschnitt 5, erreicht.

Unterhalb der Schwelle entsteht eine Benutzerentscheidung bzw. ein Konflikt.

Der Modus ist je Mandant einzuschalten. Eine installationsweite Aktivierung genügt
nicht: was für einen Kunden zulässig ist, ist es für den nächsten nicht
notwendigerweise.

## 3. Guardrails

Die KI darf die Grundsätze der übrigen Specs **niemals** umgehen. Es gelten
unverändert:

* SPEC-04, Abschnitt 1 — keine Änderung aufgrund bloßer Vermutung
* SPEC-04, Abschnitt 9 — die geschützte Reihenfolge der Verarbeitungspipeline
* SPEC-02, Abschnitt 21 — die Originaldatei bleibt unverändert
* SPEC-02, Abschnitt 18 — kein Umlernen aufgrund einzelner widersprüchlicher Daten
* SPEC-07 — alles, was nicht sicher entscheidbar ist, wird zum Prüffall

Eine explizit definierte Benutzerregel hat immer Vorrang vor einer
KI-Entscheidung.

## 4. Nachvollziehbarkeit

Eine KI-gestützte Entscheidung ist im Protokoll als solche zu kennzeichnen.

Festzuhalten sind mindestens:

* dass die Entscheidung KI-gestützt war
* Modell und Modellstand
* die Eingabe, auf der sie beruhte
* die ermittelte Confidence
* das Ergebnis
* ob ein Benutzer sie bestätigt hat

Ein Verarbeitungslauf muss auch Jahre später zeigen können, welche seiner
Entscheidungen aus dieser Quelle stammten. Ohne Modellstand ist das Ergebnis
nicht reproduzierbar (SPEC-06, Abschnitt 13).

## 5. Offene Entscheidung: Wo das Modell läuft

**Diese Frage ist bewusst offen und vor jeder Umsetzung zu beantworten.**

SPEC-01, Abschnitt 3, sagt zu:

> „Die Kundendaten verlassen die lokale Umgebung nicht, sofern der Kunde selbst
> eine externe Datenquelle oder ein externes Datenziel konfiguriert."

und Abschnitt 30:

> „Die Architektur setzt nicht voraus, dass Kundendaten in einer externen
> Cloud-Datenbank gespeichert werden."

Daraus folgen drei mögliche Wege, die einander ausschließen:

**a) Lokales Modell.** Die Zusage bleibt unangetastet. Dafür braucht SPEC-01,
Abschnitt 3, eine weitere Komponente, SPEC-06, Abschnitt 15, den zusätzlichen
Ressourcenbedarf, und die Auslieferung wird erheblich größer.

**b) Externer Dienst, nur Strukturinformationen.** Feldbezeichnungen und
Datentypen verlassen das Haus, Werte nicht. Auch ein Feldname kann verraten,
womit ein Kunde handelt; die Zusage aus Abschnitt 3 und 30 wäre um diese Ausnahme
zu ergänzen, und der Mandant müsste ihr ausdrücklich zustimmen.

**c) Externer Dienst mit Werten.** Nicht vereinbar mit den Zusagen in ihrer
heutigen Fassung.

Solange diese Entscheidung nicht getroffen ist, bleibt SPEC-11 im Entwurf und
Modus **KI AUS** der einzige zulässige Zustand.

## 6. Was diese Spec nicht regelt

* Auswahl eines konkreten Modells
* Betrieb, Aktualisierung und Lizenzierung des Modells
* Kosten je Aufruf
* Verhalten bei nicht erreichbarem Dienst
* Prompt- und Antwortformate

Diese Punkte gehören in die technische Implementierungsspezifikation, sobald
Abschnitt 5 entschieden ist.

## Status

**SPEC-11 – ENTWURF.** Nicht Bestandteil von V1. Wird verbindlich, sobald
Abschnitt 5 entschieden und die Spec auf FINAL gesetzt ist.

## Änderungsverzeichnis

### Version 1.0

Neu angelegt. Grund: SPEC-08 und SPEC-09 stützten sich in ihren Fassungen 1.0 auf
KI-gestützte Erkennung, SPEC-04, Abschnitt 9, verwies auf „bereits definierte
Modi", und SPEC-01 kannte weder eine KI-Komponente noch eine Ausnahme von der
On-Premise-Zusage. Die Fähigkeit ist damit aus V1 herausgenommen und hier
beschrieben, statt an drei Stellen vorausgesetzt zu werden.
