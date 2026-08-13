# Unikom

Dieses Projekt ist die technische Umsetzung für die in [Specs/FR_001_FOUND_STEP1.md](Specs/FR_001_FOUND_STEP1.md) definierte Step-1-Anforderung: Automatisierte Dateiübernahme mit überprüfbaren Filtern, Scheduler, Quellen-Adaptern und sicherer Ablage.

## Zielarchitektur

- Domain: Transfer-, Scheduling-, Credential- und Datei-Modelle
- Application: Transfer-Execution, Dateiauswahl und Orchestrierung
- Infrastructure: Local/SFTP/FTPS Adapter, Persistenz, Scheduling, Security
- API/UI: spätere Oberfläche und REST-Integration

## Aktueller Stand

Diese Struktur bildet den Startpunkt für die eigentliche Entwicklung und enthält bereits die Kernmodelle und die wichtigsten Service-Interfaces nach den Anforderungen aus dem Spec.

## Entwicklung

```bash
npm install
npm run build
```
