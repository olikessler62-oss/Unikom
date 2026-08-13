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
npm test          # 165 Tests, inklusive echter SFTP- und FTPS-Protokolltests
npm run dev       # Beispiellauf mit lokaler Quelle
npm run build     # Produktivbuild nach dist/ (ohne Tests)
```

## Hauptschlüssel

Zugangsdaten werden verschlüsselt gespeichert. Der dafür nötige Schlüssel wird
aus der Umgebungsvariablen `UNIKOM_MASTER_KEY` gelesen und liegt damit bewusst
außerhalb der Datenbank, die er schützt.

Einen neuen Schlüssel erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Der Wert muss base64-kodierte 32 Byte sein. Ohne ihn lassen sich keine
Zugangsdaten lesen oder anlegen; Jobs mit rein lokalen Quellen und ohne
Verschlüsselung laufen auch ohne.

Geht der Schlüssel verloren, sind alle gespeicherten Zugangsdaten unbrauchbar
und müssen neu hinterlegt werden. Die bereits übertragenen Dateien sind davon
nicht betroffen — außer sie wurden verschlüsselt abgelegt.

## Datenablage

Alles Dauerhafte liegt unter `application-data/`:

| Inhalt | Ablage |
| ------ | ------ |
| Jobs, Läufe, Zugangsdaten, Datei-Historie | `unikom.db` (SQLite) |
| Arbeitsverzeichnis während eines Laufs | `staging/<run-id>/` |

Das Staging-Verzeichnis wird nach jedem Lauf geleert. Dateien erreichen das
Zielverzeichnis ausschließlich als fertiges, atomar verschobenes Ergebnis.

## Architektur

```text
src/
  domain/          Modelle und Regeln (Transfer, Quelle, Zugangsdaten, Verschlüsselung)
  application/     Pipeline, Scheduler, Laufzeit, Credential-Verwaltung
  infrastructure/  Quell-Adapter (Local/SFTP/FTPS), Persistenz, Krypto, Dateisystem
  testing/         Testhilfen inklusive echter SFTP- und FTPS-Server
```

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

## Stand

Umgesetzt sind die Phasen 1 bis 11 der Spec mit Ausnahme benutzerdefinierter
Cron-Ausdrücke. Nicht enthalten sind bislang: Retry für temporäre Fehler (§65),
begrenzte Parallelverarbeitung (§79) und die Oberfläche (§83–94).
