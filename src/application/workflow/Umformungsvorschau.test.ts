import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import type { Dateiablage, Verzeichniseintrag } from './Dateiablage.js';
import { Umformungsvorschaudienst, VorschauFehler } from './Umformungsvorschau.js';

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

function werkbank(): { dienst: Umformungsvorschaudienst; ablage: Ablage } {
  const ablage = new Ablage();

  return { dienst: new Umformungsvorschaudienst(ablage), ablage };
}

const KUNDEN: [string[], string[][]] = [
  ['kdnr', 'name', 'ort'],
  [
    ['4711', 'meier, anna', 'Bonn'],
    ['4712', 'SCHULZ, BERT', 'Köln'],
    ['4713', 'Berger, Carl', 'Ulm'],
  ],
];

const DEUTSCH = { region: DEFAULT_REGION };

test('ohne Umformung zeigt die Vorschau die Datei, wie sie ist', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang' });

  assert.equal(vorschau.datei, 'Kunden.csv');
  assert.equal(vorschau.datensaetze, 3);
  assert.deepEqual(
    vorschau.felder.map((feld) => feld.feld),
    ['kdnr', 'name', 'ort']
  );
  assert.equal(
    vorschau.felder.every((feld) => !feld.veraendert),
    true
  );
});

test('vorher und nachher stehen nebeneinander', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige({
    ...DEUTSCH,
    verzeichnis: '/eingang',
    umformung: { felder: [{ feld: 'name', schritte: [{ art: 'ANFANGSGROSS' }] }] },
  });

  assert.equal(vorschau.zeilen[1].vorher.name, 'SCHULZ, BERT');
  assert.equal(vorschau.zeilen[1].nachher.name, 'Schulz, Bert');
  assert.deepEqual(vorschau.zeilen[1].geaendert, ['name']);
});

test('ein Feld, an dem sich nichts tut, wird nicht hervorgehoben', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige({
    ...DEUTSCH,
    verzeichnis: '/eingang',
    umformung: { felder: [{ feld: 'name', schritte: [{ art: 'ANFANGSGROSS' }] }] },
  });

  const ort = vorschau.felder.find((feld) => feld.feld === 'ort');

  assert.equal(ort?.veraendert, false);
  assert.equal(ort?.neu, false);
});

test('neue Felder sind als neu erkennbar', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  const vorschau = await dienst.zeige({
    ...DEUTSCH,
    verzeichnis: '/eingang',
    umformung: {
      aufteilungen: [
        { quelle: 'name', ziele: ['nachname', 'vorname'], trennung: { art: 'ZEICHEN', zeichen: ',' } },
      ],
    },
  });

  const nachname = vorschau.felder.find((feld) => feld.feld === 'nachname');

  assert.equal(nachname?.neu, true);
  assert.equal(vorschau.zeilen[0].nachher.nachname, 'meier');
  assert.equal(vorschau.zeilen[0].vorher.nachname, undefined, 'vorher gab es das Feld nicht');
});

/* ---------- Der eigentliche Zweck ---------- */

test('mögliche Datenverluste stehen dabei, auch wenn sie weit hinten liegen', async () => {
  /*
   * SPEC-09, Abschnitt 11, nennt „mögliche Datenverluste" ausdrücklich. Sie
   * sind der Grund, warum es die Vorschau gibt: Eine Aufteilung, die bei
   * neunzehn von zwanzig Zeilen aufgeht, sieht ohne diese Liste vollkommen in
   * Ordnung aus — und der Prüffall steckt selten in Zeile drei.
   */
  const { dienst, ablage } = werkbank();

  const zeilen = Array.from({ length: 30 }, (_, nummer) => [String(nummer + 1), `Kunde ${nummer + 1}`, 'Bonn']);

  zeilen[27] = ['28', 'Bert von der Heide', 'Ulm'];

  ablage.lege('/eingang/Kunden.csv', ['kdnr', 'name', 'ort'], zeilen);

  const vorschau = await dienst.zeige({
    ...DEUTSCH,
    verzeichnis: '/eingang',
    zeilen: 5,
    umformung: {
      aufteilungen: [
        { quelle: 'name', ziele: ['vorname', 'nachname'], trennung: { art: 'ZEICHEN', zeichen: ' ' } },
      ],
    },
  });

  assert.equal(vorschau.gezeigt, 5, 'gezeigt werden fünf Zeilen');
  assert.equal(vorschau.pruefaelle.length, 1, 'gefunden wird der Fall aus Zeile 28');
  assert.equal(vorschau.pruefaelle[0].zeile, 28);
  assert.match(vorschau.pruefaelle[0].hinweis, /4 Teile/);
});

test('die Vorschau rechnet über die ganze Datei, zeigt aber nur den Anfang', async () => {
  const { dienst, ablage } = werkbank();

  const zeilen = Array.from({ length: 50 }, (_, nummer) => [String(nummer + 1), 'meier, anna', 'Bonn']);

  ablage.lege('/eingang/Kunden.csv', ['kdnr', 'name', 'ort'], zeilen);

  const vorschau = await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang', zeilen: 3 });

  assert.equal(vorschau.datensaetze, 50);
  assert.equal(vorschau.gezeigt, 3);
  assert.equal(vorschau.zeilen.length, 3);
});

test('weniger Zeilen als gewünscht sind kein Fehler', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  assert.equal((await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang', zeilen: 100 })).gezeigt, 3);
});

/* ---------- Welche Datei ---------- */

test('ohne Angabe wird die erste lesbare Datei gezeigt', async () => {
  // Eine Vorschau, die erst nach einer Auswahl etwas zeigt, wird nicht geöffnet.
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/A.csv', ...KUNDEN);
  ablage.lege('/eingang/B.csv', ...KUNDEN);

  assert.equal((await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang' })).datei, 'A.csv');
});

test('eine bestimmte Datei lässt sich verlangen', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/A.csv', ...KUNDEN);
  ablage.lege('/eingang/B.csv', ...KUNDEN);

  assert.equal((await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang', datei: 'B.csv' })).datei, 'B.csv');
});

test('ein leeres Verzeichnis sagt, welche Formate gelesen werden', async () => {
  // „Keine Datei gefunden" schickt jemanden auf die Suche nach dem Fehler im
  // Pfad, wo in Wahrheit eine PDF im Ordner liegt.
  const { dienst } = werkbank();

  await assert.rejects(
    () => dienst.zeige({ ...DEUTSCH, verzeichnis: '/leer' }),
    (fehler: Error) => {
      assert.ok(fehler instanceof VorschauFehler);
      assert.match(fehler.message, /CSV, TXT, JSON, XML und XLSX/);

      return true;
    }
  );
});

test('eine Datei, die es nicht gibt, wird beim Namen genannt', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/A.csv', ...KUNDEN);

  await assert.rejects(
    () => dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang', datei: 'Gibtesnicht.csv' }),
    /Gibtesnicht\.csv/
  );
});

test('was der Leser anmerkt, steht in der Vorschau', async () => {
  /*
   * Bei lauter Textspalten kann er die Kopfzeile nicht von den Daten
   * unterscheiden — und sagt es. Diese Anmerkung gehört genau hierher: Wer sie
   * erst im Nachtlauf liest, hat den Workflow längst scharf geschaltet.
   */
  const { dienst, ablage } = werkbank();

  ablage.lege('/eingang/Namen.csv', ['vorname', 'nachname'], [['Anna', 'Meier'], ['Bert', 'Schulz']]);

  const vorschau = await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang' });

  assert.ok(
    vorschau.hinweise.some((hinweis) => /Kopfzeile/.test(hinweis)),
    vorschau.hinweise.join(' | ')
  );
});

test('eine Datei ohne Leser wird übergangen und nicht gezeigt', async () => {
  /*
   * Sonst zeigte die Vorschau ein Bericht.pdf, das im Ordner liegt — und der
   * Lauf verarbeitete danach etwas ganz anderes.
   */
  const { dienst, ablage } = werkbank();

  ablage.dateien.set('/eingang/Bericht.pdf', new Uint8Array([1, 2, 3]));
  ablage.lege('/eingang/Kunden.csv', ...KUNDEN);

  assert.equal((await dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang' })).datei, 'Kunden.csv');
});

test('liegt nur Unlesbares da, sagt die Vorschau es', async () => {
  const { dienst, ablage } = werkbank();

  ablage.dateien.set('/eingang/Bericht.pdf', new Uint8Array([1, 2, 3]));

  await assert.rejects(() => dienst.zeige({ ...DEUTSCH, verzeichnis: '/eingang' }), VorschauFehler);
});
