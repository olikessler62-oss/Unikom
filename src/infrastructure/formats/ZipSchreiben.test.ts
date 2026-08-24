import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readZip } from './Zip.js';
import { packe } from './ZipSchreiben.js';

const ZEITPUNKT = new Date(2026, 7, 23, 3, 12, 44);

async function arbeitsplatz(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'unikom-zip-'));
}

/**
 * Wo 7-Zip liegt — oder nichts.
 *
 * Der Fremdprüfer ist der eigentliche Wert dieser Testreihe: Ob unser Archiv
 * dem Format entspricht, entscheidet nicht unsere Meinung darüber, sondern ein
 * Werkzeug, das nichts von uns weiß. Unser eigener Leser wäre kein Beweis — er
 * könnte denselben Denkfehler machen wie der Schreiber. Auf einer Maschine ohne
 * 7-Zip bleibt die Prüfung aus und sagt das, statt zu behaupten, sie sei
 * gelaufen.
 */
function siebenZip(): string | undefined {
  const orte = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    '/usr/bin/7z',
    '/usr/local/bin/7z',
  ];

  return orte.find((ort) => existsSync(ort));
}

const FREMD = siebenZip();

/* ---------- Der Fremdprüfer ---------- */

test(
  '7-Zip macht das Archiv auf und findet den Inhalt wieder',
  { skip: FREMD ? false : 'ohne 7-Zip auf dieser Maschine nicht prüfbar' },
  async () => {
    const ordner = await arbeitsplatz();
    const archiv = path.join(ordner, 'stapel.zip');
    const gross = Buffer.alloc(70_000, 'x');

    await fs.writeFile(
      archiv,
      packe(
        [
          { name: 'bestellung.csv', inhalt: Buffer.from('Nr;Menge\r\n7;3\r\n', 'utf-8') },
          { name: 'lieferschein.csv', inhalt: Buffer.from('leer', 'utf-8') },
          // Mehr als ein Puffer voll — Größen und Prüfsumme müssen auch dann stimmen.
          { name: 'gross.bin', inhalt: gross },
        ],
        ZEITPUNKT
      )
    );

    const heraus = path.join(ordner, 'heraus');
    execFileSync(FREMD as string, ['x', archiv, `-o${heraus}`, '-y'], { stdio: 'pipe' });

    assert.equal(
      await fs.readFile(path.join(heraus, 'bestellung.csv'), 'utf-8'),
      'Nr;Menge\r\n7;3\r\n'
    );
    assert.equal(await fs.readFile(path.join(heraus, 'lieferschein.csv'), 'utf-8'), 'leer');
    assert.deepEqual(await fs.readFile(path.join(heraus, 'gross.bin')), gross);
  }
);

test(
  '7-Zip findet das Archiv unversehrt',
  { skip: FREMD ? false : 'ohne 7-Zip auf dieser Maschine nicht prüfbar' },
  async () => {
    /*
     * `t` prüft jeden Eintrag gegen seine Prüfsumme. Damit steht auch die
     * CRC-32 unter Beweis, die ein bloßes Auspacken durchgehen ließe.
     */
    const ordner = await arbeitsplatz();
    const archiv = path.join(ordner, 'stapel.zip');

    await fs.writeFile(
      archiv,
      packe([{ name: 'a.csv', inhalt: Buffer.from('Nr;Menge\r\n7;3\r\n', 'utf-8') }], ZEITPUNKT)
    );

    const bericht = execFileSync(FREMD as string, ['t', archiv], { encoding: 'utf-8' });

    assert.match(bericht, /Everything is Ok/);
  }
);

test(
  'ein Name mit Umlauten kommt unverändert wieder heraus',
  { skip: FREMD ? false : 'ohne 7-Zip auf dieser Maschine nicht prüfbar' },
  async () => {
    /*
     * Deshalb steht Bit 11 im Kopf: Ohne die Marke „UTF-8" liest ein
     * Packprogramm den Namen in seiner Landestabelle, und aus „Größe" wird
     * „GrÃ¶ÃŸe". Bei Dateinamen aus einem Kundensystem ist das der Normalfall.
     */
    const ordner = await arbeitsplatz();
    const archiv = path.join(ordner, 'stapel.zip');

    await fs.writeFile(archiv, packe([{ name: 'Größe_Übersicht.csv', inhalt: Buffer.from('x') }], ZEITPUNKT));

    const heraus = path.join(ordner, 'heraus');
    execFileSync(FREMD as string, ['x', archiv, `-o${heraus}`, '-y'], { stdio: 'pipe' });

    assert.deepEqual(await fs.readdir(heraus), ['Größe_Übersicht.csv']);
  }
);

/* ---------- Der eigene Leser kommt damit zurecht ---------- */

test('was gepackt wurde, liest der eigene Leser wieder', () => {
  /*
   * Kein Beweis für das Format — dafür steht 7-Zip oben. Aber der Weg, den ein
   * Archiv im Haus geht: Umschlag ab, `readZip`, Dateien zurück.
   */
  const archiv = packe(
    [
      { name: 'a.csv', inhalt: Buffer.from('Nr;Menge', 'utf-8') },
      { name: 'b.csv', inhalt: Buffer.from('leer', 'utf-8') },
    ],
    ZEITPUNKT
  );

  const wieder = readZip(archiv);

  assert.deepEqual([...wieder.keys()], ['a.csv', 'b.csv']);
  assert.equal(wieder.get('a.csv')?.toString('utf-8'), 'Nr;Menge');
  assert.equal(wieder.get('b.csv')?.toString('utf-8'), 'leer');
});

/* ---------- Der Aufbau, auch ohne Fremdprüfer ---------- */

test('jeder Eintrag trägt Deflate und seine Prüfsumme', () => {
  const archiv = packe([{ name: 'a.csv', inhalt: Buffer.from('Nr;Menge', 'utf-8') }], ZEITPUNKT);

  assert.equal(archiv.readUInt32LE(0), 0x04034b50);
  assert.equal(archiv.readUInt16LE(8), 8, 'Deflate');
  assert.notEqual(archiv.readUInt32LE(14), 0, 'die Prüfsumme steht da');
});

test('die Prüfsumme steht auch im zentralen Verzeichnis, und dieselbe', () => {
  /*
   * Beide Stellen tragen sie, und ein Leser darf sich auf jede verlassen.
   * Stimmten sie nicht überein, wäre das Archiv je nach Werkzeug heil oder
   * kaputt — der unangenehmste Fehler, den ein Behälter haben kann.
   */
  const archiv = packe([{ name: 'a.csv', inhalt: Buffer.from('Nr;Menge', 'utf-8') }], ZEITPUNKT);
  const verzeichnis = archiv.readUInt32LE(archiv.length - 22 + 16);

  assert.equal(archiv.readUInt32LE(verzeichnis + 16), archiv.readUInt32LE(14));
});

test('der Name steht in UTF-8 und ist als solcher markiert', () => {
  const archiv = packe([{ name: 'Größe.csv', inhalt: Buffer.from('x') }], ZEITPUNKT);

  assert.equal(archiv.readUInt16LE(6) & 0x0800, 0x0800);
  assert.equal(
    archiv.subarray(30, 30 + archiv.readUInt16LE(26)).toString('utf-8'),
    'Größe.csv'
  );
});

test('das Archiv ist nicht verschlüsselt — das geschieht außen', () => {
  /*
   * Bit 0 bleibt frei. Stünde es, erwartete ein Leser Salz und Prüfwert vor den
   * Daten und läse alles um 18 Bytes verschoben. Der Schutz liegt im Umschlag
   * um das ganze Archiv, und dort liegen dann auch die Namen.
   */
  const archiv = packe([{ name: 'a.csv', inhalt: Buffer.from('x') }], ZEITPUNKT);

  assert.equal(archiv.readUInt16LE(6) & 0x0001, 0);
});

test('das Abschlussstück zählt die Einträge und zeigt auf das Verzeichnis', () => {
  const archiv = packe(
    [
      { name: 'a.csv', inhalt: Buffer.from('x') },
      { name: 'b.csv', inhalt: Buffer.from('y') },
    ],
    ZEITPUNKT
  );

  const abschluss = archiv.length - 22;

  assert.equal(archiv.readUInt32LE(abschluss), 0x06054b50);
  assert.equal(archiv.readUInt16LE(abschluss + 10), 2);
  assert.equal(archiv.readUInt32LE(archiv.readUInt32LE(abschluss + 16)), 0x02014b50);
});

test('ohne Einträge bleibt ein leeres, gültiges Archiv', () => {
  const archiv = packe([], ZEITPUNKT);

  assert.equal(archiv.length, 22);
  assert.equal(archiv.readUInt32LE(0), 0x06054b50);
  assert.equal(archiv.readUInt16LE(10), 0);
});

test('ein Zeitpunkt vor 1980 kippt das Datumsfeld nicht', () => {
  /*
   * Das DOS-Datum zählt Jahre ab 1980 und kann nichts Älteres. Eine kaputte
   * Uhr schriebe sonst eine negative Jahreszahl in den Kopf und machte das
   * ganze Archiv unlesbar — an einer Stelle, die mit dem Inhalt nichts zu tun
   * hat.
   */
  const archiv = packe([{ name: 'a.csv', inhalt: Buffer.from('x') }], new Date(1970, 0, 1));

  assert.equal(archiv.readUInt16LE(12) >> 9, 0);
});
