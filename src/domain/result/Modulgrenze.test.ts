import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_REGION } from '../tenants/Region.js';
import { pruefeErgebnis } from './Ergebnispruefung.js';
import type { Ergebnisstand } from './Ergebnisstand.js';
import { MODUL_DREI, zurUebergabe, type Modulzugang } from './Uebergabe.js';

/**
 * Die Grenze zwischen den Modulen — als Test und nicht als Vorsatz.
 *
 * ```text
 * Modul 1  Transfer        holt Dateien, legt Dateien ab
 * Modul 2  Konsolidierung  liest, prüft, führt zusammen  →  Ergebnisstand
 * Modul 3  Export/Import   schreibt in Zieldatenbanken, exportiert endgültig
 * ```
 *
 * **In fremde Datenbanken schreibt ausschließlich Modul 3**, und der endgültige
 * Export ebenso. Das steht in SPEC-03, Abschnitt 9, und SPEC-10, Abschnitt 1 —
 * und ein Satz in einer Spec hält niemanden auf, der in Eile ist.
 *
 * Diese Datei hält auf. Sie liest den Quelltext der Konsolidierung und schlägt
 * an, sobald dort etwas auftaucht, das schreiben könnte. Nicht, weil heute
 * jemand das vorhätte — sondern weil in zwei Jahren jemand „nur schnell" eine
 * Zieltabelle füllen will und die Stelle, an der es auffällt, sonst erst beim
 * Kunden liegt.
 */
const WURZEL = path.resolve(import.meta.dirname, '..', '..');

/** Was zu Modul 2 gehört. Alles darin darf nichts hinausschreiben. */
const MODUL_ZWEI = [
  'domain/consolidation',
  'domain/conflicts',
  'domain/result',
  'domain/quality',
  'domain/mapping',
  'domain/discovery',
  'application/consolidation',
  'application/conflicts',
  'application/result',
  'application/quality',
  'application/mapping',
  'application/discovery',
];

/**
 * Woran ein Schreibzugriff zu erkennen ist.
 *
 * Absichtlich grob: Es geht nicht darum, jeden denkbaren Weg zu erwischen,
 * sondern die naheliegenden — und vor allem darum, dass jemand, der einen davon
 * einbaut, an dieser Stelle stolpert und die Entscheidung noch einmal liest.
 */
const VERBOTEN: readonly { muster: RegExp; was: string }[] = [
  { muster: /\bwriteFile\b|\bappendFile\b|\bcreateWriteStream\b/, was: 'ein Schreibzugriff auf das Dateisystem' },
  { muster: /\bDatabaseSync\b|\bnode:sqlite\b/, was: 'ein direkter Zugriff auf die Datenbank' },
  { muster: /\bDestinationAdapter\b|\bdestinationProvider\b/, was: 'ein Ziel-Adapter aus Modul 1' },
  { muster: /\b(INSERT INTO|UPDATE .*\bSET\b|DELETE FROM|MERGE INTO)\b/i, was: 'eine schreibende SQL-Anweisung' },
];

async function quelldateien(verzeichnis: string): Promise<string[]> {
  const eintraege = await fs.readdir(verzeichnis, { withFileTypes: true });
  const gefunden: string[] = [];

  for (const eintrag of eintraege) {
    const voll = path.join(verzeichnis, eintrag.name);

    if (eintrag.isDirectory()) {
      gefunden.push(...(await quelldateien(voll)));
      continue;
    }

    // Tests dürfen alles — sie legen Verzeichnisse an und lesen sie wieder.
    if (eintrag.name.endsWith('.ts') && !eintrag.name.endsWith('.test.ts')) {
      gefunden.push(voll);
    }
  }

  return gefunden;
}

test('die Konsolidierung schreibt nirgendwohin', async () => {
  const verstoesse: string[] = [];

  for (const bereich of MODUL_ZWEI) {
    const verzeichnis = path.join(WURZEL, bereich);

    if (
      !(await fs
        .stat(verzeichnis)
        .then(() => true)
        .catch(() => false))
    ) {
      continue;
    }

    for (const datei of await quelldateien(verzeichnis)) {
      const inhalt = await fs.readFile(datei, 'utf-8');

      /*
       * Kommentare zählen nicht: Diese Datei selbst nennt die verbotenen Wörter,
       * und in den Modulen stehen sie in Erklärungen, warum es sie dort nicht
       * gibt. Geprüft wird, was ausgeführt wird.
       */
      const code = inhalt
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^\s*\*.*$/gm, '');

      for (const regel of VERBOTEN) {
        if (regel.muster.test(code)) {
          verstoesse.push(`${path.relative(WURZEL, datei)}: ${regel.was}`);
        }
      }
    }
  }

  assert.deepEqual(
    verstoesse,
    [],
    'In fremde Datenbanken schreibt ausschließlich Modul 3, und der endgültige Export ebenso ' +
      '(SPEC-03 Abschnitt 9, SPEC-10 Abschnitt 1). Modul 2 endet beim freigegebenen Ergebnisstand; ' +
      'was danach kommt, holt sich Modul 3 über die Übergabe.\n' +
      verstoesse.join('\n')
  );
});

test('geprüft wird überhaupt etwas', async () => {
  // Ohne diese Zusage bestünde der Test oben auch dann, wenn die
  // Verzeichnisnamen eines Tages nicht mehr stimmen — und niemand merkte es.
  const dateien = await quelldateien(path.join(WURZEL, 'domain', 'consolidation'));

  assert.ok(dateien.length > 5, `nur ${dateien.length} Dateien gefunden - stimmen die Pfade noch?`);
});

/* ---------- Die Tür ---------- */

/** Modul 3 gekauft und angehakt — der Normalfall einer vollen Installation. */
const OFFEN: Modulzugang = { gekauft: () => true, angehakt: () => true };

const SAUBER = pruefeErgebnis({
  eingang: { felder: ['a'], zeilen: [['1']] },
  ergebnis: { felder: ['a'], zeilen: [['1']] },
  region: DEFAULT_REGION,
});

function stand(teile: Partial<Ergebnisstand> = {}): Ergebnisstand {
  return {
    id: 'e1',
    tenantId: 'default',
    laufId: 'lauf1',
    jobId: 'job1',
    felder: ['kdnr', 'ort'],
    zeilen: [['4711', 'Bonn']],
    pruefung: SAUBER,
    status: 'COMPLETED',
    entstanden: '2026-08-20T10:00:00.000Z',
    ...teile,
  };
}

test('ein nicht freigegebenes Ergebnis kommt nicht durch die Tür', () => {
  // „Ein nicht freigegebenes Ergebnis ist kein gültiges Ergebnis. Es darf von
  // Modul 3 nicht übernommen werden."
  const pruefung = zurUebergabe(stand({ status: 'WAITING_FOR_RELEASE' }), OFFEN);

  assert.equal(pruefung.ok, false);
  assert.match(pruefung.ok === false ? pruefung.grund : '', /nicht freigegeben/);
});

test('auch ein abgeschlossener Lauf ohne Vermerk kommt nicht durch', () => {
  // Der Status allein genügt nicht — es zählt die festgehaltene Freigabe.
  assert.equal(zurUebergabe(stand({ status: 'COMPLETED' }), OFFEN).ok, false);
});

test('ein freigegebener Stand geht mit seiner Herkunft hinaus', () => {
  const pruefung = zurUebergabe(
    stand({
      ausLauf: 'lauf0',
      freigabe: {
        zeitpunkt: '2026-08-20T11:00:00.000Z',
        art: 'MANUELL',
        benutzerName: 'Anna Meier',
        bedingungen: [],
        pruefstand: {},
      },
    }),
    OFFEN
  );

  assert.equal(pruefung.ok, true);

  const uebergabe = pruefung.ok === true ? pruefung.uebergabe : undefined;

  assert.equal(uebergabe?.datensaetze, 1);
  assert.equal(uebergabe?.freigabeart, 'MANUELL');
  assert.equal(uebergabe?.freigegebenVon, 'Anna Meier');
  assert.deepEqual(uebergabe?.herkunft, { ausLauf: 'lauf0', wiederhergestelltAus: undefined });
});

test('die Übergabe reicht keine Referenz auf den Bestand heraus', () => {
  // Sonst könnte Modul 3 den Ergebnisstand von außen verändern — und ein
  // historischer Stand wäre keiner mehr.
  const original = stand({
    freigabe: { zeitpunkt: 'x', art: 'AUTOMATISCH', bedingungen: [], pruefstand: {} },
  });

  const pruefung = zurUebergabe(original, OFFEN);

  if (pruefung.ok) {
    pruefung.uebergabe.zeilen[0][1] = 'Verändert';
    pruefung.uebergabe.felder.push('geschmuggelt');
  }

  assert.deepEqual(original.zeilen, [['4711', 'Bonn']]);
  assert.deepEqual(original.felder, ['kdnr', 'ort']);
});

/* ---------- Gekauft und angehakt ---------- */

const FREIGEGEBEN = stand({
  freigabe: { zeitpunkt: '2026-08-20T11:00:00.000Z', art: 'AUTOMATISCH', bedingungen: [], pruefstand: {} },
});

test('ohne Modul 3 verlassen keine Daten das Haus', () => {
  // Einrichten, prüfen und entscheiden geht ohne — die Daten ausliefern nicht.
  const pruefung = zurUebergabe(FREIGEGEBEN, { gekauft: () => false, angehakt: () => true });

  assert.equal(pruefung.ok, false);
  assert.match(pruefung.ok === false ? pruefung.grund : '', /keines der Module, die Daten hinausgeben/);
});

test('ein gekauftes, aber abgeschaltetes Modul öffnet die Tür nicht', () => {
  // Es ist eines, das der Benutzer für diesen Lauf ausdrücklich nicht wollte.
  const pruefung = zurUebergabe(FREIGEGEBEN, { gekauft: () => true, angehakt: () => false });

  assert.equal(pruefung.ok, false);
  assert.match(pruefung.ok === false ? pruefung.grund : '', /in diesem Ablauf nicht eingeschaltet/);
});

test('eine der beiden Hälften genügt', () => {
  // Es geht darum, ob überhaupt jemand da ist, der die Daten annimmt.
  const nurKonvertierung: Modulzugang = {
    gekauft: (feature) => feature === 'CONVERSION',
    angehakt: (feature) => feature === 'CONVERSION',
  };

  assert.equal(zurUebergabe(FREIGEGEBEN, nurKonvertierung).ok, true);
});

test('ohne Workflow-Bezug wird nur die Lizenz geprüft — und das steht dabei', () => {
  /*
   * Stillschweigend „angehakt" anzunehmen hieße, eine Bedingung wegzulassen
   * und trotzdem zu behaupten, sie sei geprüft worden.
   */
  const pruefung = zurUebergabe(FREIGEGEBEN, { gekauft: () => true });

  assert.equal(pruefung.ok, true);

  const geprueft = pruefung.ok === true ? pruefung.geprueft : [];

  assert.equal(geprueft.length, 1);
  assert.match(geprueft[0], /^gekauft:/);
  assert.equal(geprueft.some((zeile) => zeile.startsWith('angehakt')), false);
});

test('die Modulprüfung kommt vor der Freigabeprüfung', () => {
  /*
   * Wer kein Modul 3 hat, soll nicht erst erfahren, dass sein Ergebnis nicht
   * freigegeben ist — die Freigabe würde ihm nichts nützen. Die nähere Ursache
   * zuerst.
   */
  const pruefung = zurUebergabe(stand({ status: 'WAITING_FOR_RELEASE' }), { gekauft: () => false });

  assert.match(pruefung.ok === false ? pruefung.grund : '', /keines der Module/);
});

test('beide Hälften von Modul 3 stehen in der Liste', () => {
  assert.deepEqual([...MODUL_DREI].sort(), ['CONVERSION', 'DATA_IMPORT']);
});
