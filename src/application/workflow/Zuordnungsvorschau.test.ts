import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import { InMemoryMappingRepository } from '../../infrastructure/persistence/InMemoryMappingRepository.js';
import { MappingService } from '../mapping/MappingService.js';
import type { Dateiablage, Verzeichniseintrag } from './Dateiablage.js';
import { Umformungsvorschaudienst } from './Umformungsvorschau.js';
import { VorschauFehler } from './Vorschaudatei.js';
import { Zuordnungsvorschaudienst } from './Zuordnungsvorschau.js';

class Ablage implements Dateiablage {
  readonly dateien = new Map<string, Uint8Array>();
  readonly verschoben: string[] = [];

  lege(pfad: string, felder: string[], zeilen: string[][]): void {
    this.dateien.set(pfad, alsBytes(schreibeCsv(felder, zeilen)));
  }

  async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    return [...this.dateien.keys()]
      .filter((pfad) => pfad.startsWith(verzeichnis + '/'))
      .map((pfad) => ({ name: pfad.slice(verzeichnis.length + 1) }));
  }

  async lies(pfad: string): Promise<Uint8Array> {
    const inhalt = this.dateien.get(pfad);

    if (!inhalt) {
      throw new Error(`Es gibt keine Datei ${pfad}`);
    }

    return inhalt;
  }

  async schreibe(): Promise<void> {
    throw new Error('Eine Vorschau schreibt nichts');
  }

  async entferne(pfad: string): Promise<void> {
    this.dateien.delete(pfad);
  }

  async verschiebe(von: string, nach: string): Promise<void> {
    const inhalt = this.dateien.get(von);

    if (!inhalt) {
      throw new Error(`Es gibt keine Datei ${von}`);
    }

    this.dateien.set(nach, inhalt);
    this.dateien.delete(von);
    this.verschoben.push(`${von} -> ${nach}`);
  }

  pfad(verzeichnis: string, name: string): string {
    return `${verzeichnis}/${name}`;
  }
}

function werkbank() {
  const ablage = new Ablage();
  const mappings = new MappingService(new InMemoryMappingRepository(), { log: () => undefined });

  return { ablage, mappings, dienst: new Zuordnungsvorschaudienst(ablage, mappings) };
}

const WUNSCH = { region: DEFAULT_REGION, verzeichnis: '/eingang', tenantId: 't1' };

const KUNDEN: [string[], string[][]] = [
  ['Kundennr', 'E-Mail', 'Bemerkung'],
  [
    ['4711', 'anna@example.com', 'Stammkunde'],
    ['4712', 'bert@example.com', 'Neukunde'],
    ['4713', 'carl@example.com', 'Stammkunde'],
  ],
];

test('aus einer echten Datei entsteht die Zuordnung Spalte für Spalte', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige(WUNSCH);

  assert.equal(vorschau.datei, 'Kunden.csv');
  assert.equal(vorschau.datensaetze, 3);
  assert.deepEqual(
    vorschau.spalten.map((spalte) => spalte.spalte),
    ['Kundennr', 'E-Mail', 'Bemerkung']
  );
  assert.equal(vorschau.spalten[0].intern, 'customerId');
  assert.equal(vorschau.spalten[1].intern, 'email');
});

test('was in keiner Bezeichnungsliste steht, wird nicht geraten', async () => {
  /*
   * Ein falsches Feldmapping leitet eine ganze Spalte still ins falsche
   * Zielfeld. „Möglichst automatisch" heißt nicht „im Zweifel raten".
   */
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const bemerkung = (await dienst.zeige(WUNSCH)).spalten[2];

  assert.equal(bemerkung.intern, undefined);
  assert.equal(bemerkung.sicherheit, 'MEHRDEUTIG');
  assert.ok(
    bemerkung.gruende.some((grund) => grund.includes('Bezeichnungsliste')),
    bemerkung.gruende.join(' | ')
  );
});

test('der erkannte Typ und ein paar echte Werte stehen dabei', async () => {
  // Ohne Werte ist keine Vermutung zu prüfen: „E-Mail" ohne E-Mail-Adressen
  // darin ist keine, und das sieht man nur, wenn welche danebenstehen.
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige(WUNSCH);

  assert.equal(vorschau.spalten[0].typ, 'INTEGER');
  assert.equal(vorschau.spalten[1].typ, 'STRING', 'jede Spalte trägt ihren eigenen Typ, nicht den der ersten');
  assert.deepEqual(vorschau.spalten[1].beispiele, ['anna@example.com', 'bert@example.com', 'carl@example.com']);
});

test('die Beispiele überspringen die leeren Werte', async () => {
  // Drei leere Zellen zu zeigen ist keine Auskunft. Wer prüfen soll, ob die
  // Vermutung stimmt, braucht Werte, die dastehen.
  const { dienst, ablage } = werkbank();

  ablage.lege(
    '/eingang/Kunden.csv',
    ['Kundennr', 'Bemerkung'],
    [
      ['', 'x'],
      ['', 'y'],
      ['4711', 'z'],
      ['4712', 'w'],
    ]
  );

  const kundennr = (await dienst.zeige(WUNSCH)).spalten[0];

  assert.deepEqual(kundennr.beispiele, ['4711', '4712']);
  assert.equal(kundennr.leer, 2);
});

test('eine Spalte, deren Werte dem Namen widersprechen, wird nicht zugeordnet', async () => {
  /*
   * Der Name allein entscheidet nicht (SPEC-09, Abschnitt 4). Eine Spalte
   * „E-Mail" ohne E-Mail-Adressen darin ist ein falsch beschrifteter Export —
   * und ein Vorschlag mit widersprechenden Werten ist eine Einladung zum
   * Durchwinken. Dafür müssen die Werte bis zur Zuordnung durchkommen und nicht
   * nur bis zur Typerkennung.
   */
  const { dienst, ablage } = werkbank();

  ablage.lege(
    '/eingang/Kunden.csv',
    ['Kundennr', 'E-Mail'],
    [
      ['4711', 'Anna Meier'],
      ['4712', 'Bert Schulz'],
      ['4713', 'Carl Berger'],
    ]
  );

  const spalte = (await dienst.zeige(WUNSCH)).spalten[1];

  assert.equal(spalte.intern, undefined, 'hier wird nichts zugeordnet');
  assert.equal(spalte.sicherheit, 'MEHRDEUTIG');
  assert.ok(
    spalte.gruende.some((grund) => grund.includes('Werte')),
    spalte.gruende.join(' | ')
  );
});

test('leere Werte werden über die ganze Datei gezählt, nicht über die Stichprobe', async () => {
  /*
   * Die Typerkennung sieht sich nur die ersten hundert Werte an. Eine Zahl, die
   * aus dieser Stichprobe stammt, sähe aus wie eine Aussage über die Datei —
   * und eine Spalte, die ab Zeile 101 leer läuft, wäre unauffällig.
   */
  const { dienst, ablage } = werkbank();

  const zeilen = Array.from({ length: 300 }, (_, nummer) => [
    String(4000 + nummer),
    nummer < 100 ? `k${nummer}@example.com` : '',
    'x',
  ]);

  ablage.lege('/eingang/Kunden.csv', ['Kundennr', 'E-Mail', 'Bemerkung'], zeilen);

  const vorschau = await dienst.zeige(WUNSCH);

  assert.equal(vorschau.datensaetze, 300);
  assert.equal(vorschau.spalten[1].leer, 200);
  assert.equal(vorschau.spalten[0].leer, 0);
});

test('eine bestätigte Zuordnung ist beim nächsten Mal keine Vermutung mehr', async () => {
  /*
   * Der ganze Zweck des Bildschirms. Ohne ihn kann niemand bestätigen, ohne
   * Bestätigung entsteht keine dauerhafte Regel, und ohne Regel wird derselbe
   * Lieferant beim nächsten Mal wieder gefragt (SPEC-02, Abschnitt 15).
   */
  const { dienst, ablage, mappings } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ['Spalte 7', 'Bemerkung'], [['4711', 'x']]);

  const vorher = (await dienst.zeige(WUNSCH)).spalten[0];

  assert.equal(vorher.intern, undefined, 'diese Spalte kennt niemand');
  assert.equal(vorher.istRegel, false);

  await mappings.bestaetige({ art: 'FELD', von: 'Spalte 7', nach: 'customerId', ebene: 'MANDANT', tenantId: 't1' });

  const nachher = (await dienst.zeige(WUNSCH)).spalten[0];

  assert.equal(nachher.intern, 'customerId');
  assert.equal(nachher.istRegel, true);
  assert.equal(nachher.sicherheit, 'EINDEUTIG');
});

test('die internen Felder zur Auswahl stehen dabei', async () => {
  // Sonst hieße berichtigen, die Kennung von Hand zu tippen — und wer sich
  // vertippt, legt eine Regel auf ein Feld an, das es nicht gibt.
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const felder = (await dienst.zeige(WUNSCH)).felder;

  assert.ok(felder.length > 0);
  assert.ok(
    felder.some((feld) => feld.intern === 'customerId' && feld.label === 'Kundennummer'),
    'die Auswahl nennt Kennung und Beschriftung'
  );
});

test('die Zahlen oben stimmen mit den Zeilen darunter überein', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige(WUNSCH);

  assert.equal(
    vorschau.uebernommen + vorschau.vorgeschlagen + vorschau.offen,
    vorschau.spalten.length,
    'jede Spalte gehört in genau eine der drei Gruppen'
  );
});

/* ---------- Dieselbe Datei wie die andere Vorschau ---------- */

test('beide Vorschauen zeigen dieselbe Datei', async () => {
  /*
   * Es gibt zwei Vorschauen auf dieselbe Eingangsdatei. Zeigten sie
   * verschiedene, wäre die eine die Antwort auf eine Frage, die die andere
   * nicht gestellt hat — und niemand käme darauf, dass es daran liegt.
   */
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/A.csv', ...KUNDEN);
  ablage.lege('/eingang/B.csv', ...KUNDEN);

  const umformung = new Umformungsvorschaudienst(ablage);

  assert.equal(
    (await dienst.zeige(WUNSCH)).datei,
    (await umformung.zeige({ region: DEFAULT_REGION, verzeichnis: '/eingang' })).datei
  );
});

test('eine bestimmte Datei lässt sich verlangen', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/A.csv', ...KUNDEN);
  ablage.lege('/eingang/B.csv', ...KUNDEN);

  assert.equal((await dienst.zeige({ ...WUNSCH, datei: 'B.csv' })).datei, 'B.csv');
});

test('ein leeres Verzeichnis sagt, welche Formate gelesen werden', async () => {
  const { dienst } = werkbank();

  await assert.rejects(
    () => dienst.zeige(WUNSCH),
    (fehler: Error) => {
      assert.ok(fehler instanceof VorschauFehler);
      assert.match(fehler.message, /CSV, TXT, JSON, XML und XLSX/);

      return true;
    }
  );
});

test('was der Leser anmerkt, steht in der Vorschau', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege(
    '/eingang/Namen.csv',
    ['Vorname', 'Nachname'],
    [
      ['Anna', 'Meier'],
      ['Bert', 'Schulz'],
    ]
  );

  const vorschau = await dienst.zeige(WUNSCH);

  assert.ok(
    vorschau.hinweise.some((hinweis) => /Kopfzeile/.test(hinweis)),
    vorschau.hinweise.join(' | ')
  );
});
