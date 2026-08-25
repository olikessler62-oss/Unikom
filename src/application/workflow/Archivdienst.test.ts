import assert from 'node:assert/strict';
import test from 'node:test';

import { Archivdienst, ARCHIVENDUNG, archivdateiname } from './Archivdienst.js';
import type { Dateiablage, Verzeichniseintrag } from './Dateiablage.js';

/** Ein Rohschlüssel, wie ihn die Installation hält: 32 Bytes, Base64. */
const SCHLUESSEL = Buffer.alloc(32, 9).toString('base64');
const ANDERER = Buffer.alloc(32, 4).toString('base64');
/*
 * Ortszeit und nicht UTC: Der Dateiname wird von jemandem gelesen, der im
 * Verzeichnis steht, und für den ist die Lieferung um halb drei nachmittags
 * angekommen — nicht um 12:30 UTC. Dieselbe Wahl trifft `ergebnisdateiname`.
 * Als Ortszeit gebaut, damit der Test in jeder Zeitzone gilt.
 */
const JETZT = new Date(2026, 7, 25, 14, 30, 0);

class Ablage implements Dateiablage {
  readonly dateien = new Map<string, Uint8Array>();
  readonly zeiten = new Map<string, string>();

  lege(pfad: string, text: string): void {
    this.dateien.set(pfad, new TextEncoder().encode(text));
  }

  async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    return [...this.dateien.keys()]
      .filter((pfad) => pfad.startsWith(verzeichnis + '/'))
      .map((pfad) => ({
        name: pfad.slice(verzeichnis.length + 1),
        geaendert: this.zeiten.get(pfad) ?? '2026-08-25T00:00:00.000Z',
      }));
  }

  async lies(pfad: string): Promise<Uint8Array> {
    const inhalt = this.dateien.get(pfad);

    if (!inhalt) {
      throw new Error(`Es gibt keine Datei ${pfad}`);
    }

    return inhalt;
  }

  async schreibe(pfad: string, inhalt: Uint8Array): Promise<void> {
    this.dateien.set(pfad, inhalt);
  }

  async entferne(pfad: string): Promise<void> {
    this.dateien.delete(pfad);
  }

  async verschiebe(): Promise<void> {
    throw new Error('wird hier nicht gebraucht');
  }

  pfad(verzeichnis: string, name: string): string {
    return `${verzeichnis}/${name}`;
  }
}

async function gepackt(inhalte: Record<string, string> = { 'Nord.csv': 'kdnr;ort\n4711;Bonn\n' }) {
  const ablage = new Ablage();

  for (const [name, text] of Object.entries(inhalte)) {
    ablage.lege(`/abholung/${name}`, text);
  }

  const dienst = new Archivdienst(ablage, () => SCHLUESSEL);
  const pfad = await dienst.lege({
    verzeichnis: '/abholung',
    namen: Object.keys(inhalte),
    archiv: '/archiv',
    benennung: 'Nachtlauf_Archiv_20260825_143000_TR-1',
    jetzt: JETZT,
  });

  return { ablage, dienst, pfad };
}

/* ---------- Der Weg hin ---------- */

test('das Paket liegt verschlüsselt im Archiv', async () => {
  const { ablage, pfad } = await gepackt();

  assert.equal(pfad, `/archiv/Nachtlauf_Archiv_20260825_143000_TR-1${ARCHIVENDUNG}`);

  const bytes = ablage.dateien.get(pfad)!;

  // Unser Umschlag, kein lesbares ZIP: Wer die Platte sieht, sieht keine Daten.
  assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), 'UNIKOM');
  assert.ok(!new TextDecoder().decode(bytes).includes('Bonn'));
});

/* ---------- Der Weg zurück ---------- */

test('das Paket lässt sich wieder öffnen, Byte für Byte', async () => {
  /*
   * Die stärkste Prüfung, die es hier gibt, ist die Rundreise. Ohne sie wäre
   * das Archiv eine Einbahnstraße — und die Zusage „das Original liegt im
   * Archiv" hinge an einer Behauptung.
   */
  const { dienst, pfad } = await gepackt({
    'Nord.csv': 'kdnr;ort\n4711;Bonn\n',
    'Süd.csv': 'kdnr;ort\n4712;Köln\n',
  });

  const inhalt = await dienst.oeffne(pfad);

  assert.equal(inhalt.pfad, pfad);
  assert.deepEqual(
    inhalt.dateien.map((datei) => datei.name).sort(),
    ['Nord.csv', 'Süd.csv'],
    'auch der Umlaut im Dateinamen kommt zurück'
  );

  const nord = inhalt.dateien.find((datei) => datei.name === 'Nord.csv')!;

  assert.equal(new TextDecoder().decode(nord.inhalt), 'kdnr;ort\n4711;Bonn\n');
});

test('eine leere Datei kommt als leere Datei zurück', async () => {
  // Der Grenzfall, an dem eine Längenrechnung als Erstes bricht.
  const { dienst, pfad } = await gepackt({ 'leer.csv': '' });
  const inhalt = await dienst.oeffne(pfad);

  assert.equal(inhalt.dateien.length, 1);
  assert.equal(inhalt.dateien[0].inhalt.length, 0);
});

test('mit dem falschen Schlüssel geht gar nichts auf', async () => {
  const { ablage, pfad } = await gepackt();
  const fremd = new Archivdienst(ablage, () => ANDERER);

  await assert.rejects(() => fremd.oeffne(pfad), /Entschlüsselung ist fehlgeschlagen/);
});

test('ein verändertes Byte fällt auf', async () => {
  /*
   * AES-GCM erkennt die Änderung. Ein Archiv, das man unbemerkt umschreiben
   * kann, beantwortet die Frage „was hat der Lieferant geschickt" nicht mehr.
   */
  const { ablage, dienst, pfad } = await gepackt();
  const bytes = Buffer.from(ablage.dateien.get(pfad)!);

  bytes[bytes.length - 20] ^= 0xff;
  ablage.dateien.set(pfad, bytes);

  await assert.rejects(() => dienst.oeffne(pfad), /verändert|falsche/);
});

test('etwas, das kein Umschlag ist, wird benannt statt zerlegt', async () => {
  const { ablage, dienst } = await gepackt();

  ablage.lege('/archiv/fremd.zip.enc', 'nur Text');

  await assert.rejects(() => dienst.oeffne('/archiv/fremd.zip.enc'), /kein Unikom-Umschlag/);
});

/* ---------- Die Liste ---------- */

test('das Archiv listet seine Pakete, jüngste zuerst', async () => {
  const { ablage, dienst } = await gepackt();

  ablage.lege('/archiv/Alt_Archiv_20260101_000000_TR-0.zip.enc', 'x');
  ablage.zeiten.set('/archiv/Alt_Archiv_20260101_000000_TR-0.zip.enc', '2026-01-01T00:00:00.000Z');
  ablage.zeiten.set(
    '/archiv/Nachtlauf_Archiv_20260825_143000_TR-1.zip.enc',
    '2026-08-25T14:30:00.000Z'
  );

  const liste = await dienst.liste('/archiv');

  assert.deepEqual(
    liste.map((stueck) => stueck.name),
    ['Nachtlauf_Archiv_20260825_143000_TR-1.zip.enc', 'Alt_Archiv_20260101_000000_TR-0.zip.enc']
  );
});

test('was keine Endung hat, gilt nicht als Paket', async () => {
  // Im Archivverzeichnis liegt irgendwann eine Notiz. Sie ist kein Archiv.
  const { ablage, dienst } = await gepackt();

  ablage.lege('/archiv/liesmich.txt', 'Notiz');

  assert.deepEqual(
    (await dienst.liste('/archiv')).map((stueck) => stueck.name),
    ['Nachtlauf_Archiv_20260825_143000_TR-1.zip.enc']
  );
});

/* ---------- Der Name ---------- */

test('der Name trägt Workflow, Zeitpunkt und Lauf', () => {
  assert.equal(archivdateiname('Nachtlauf', 'TR-7', JETZT), 'Nachtlauf_Archiv_20260825_143000_TR-7');
});

test('unzulässige Zeichen werden ersetzt, nicht weggelassen', () => {
  // Sonst ergäben „A/B" und „AB" denselben Namen.
  assert.match(archivdateiname('A/B:C', 'TR-1', JETZT), /^A_B_C_Archiv_/);
});
