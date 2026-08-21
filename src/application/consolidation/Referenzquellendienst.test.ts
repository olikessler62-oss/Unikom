import assert from 'node:assert/strict';
import test from 'node:test';

import { versionVon, maengel } from '../../domain/consolidation/Referenzquelle.js';
import { DEFAULT_REGION } from '../../domain/tenants/Region.js';
import { alsBytes, schreibeCsv } from '../../infrastructure/formats/CsvSchreiben.js';
import { InMemoryReferenzquellenRepository } from '../../infrastructure/persistence/InMemoryReferenzquellenRepository.js';
import type { Dateiablage, Verzeichniseintrag } from '../workflow/Dateiablage.js';
import { Referenzquellendienst, ReferenzquellenFehler } from './Referenzquellendienst.js';

class Ablage implements Dateiablage {
  readonly dateien = new Map<string, { inhalt: Uint8Array; geaendert?: string }>();

  lege(pfad: string, felder: string[], zeilen: string[][], geaendert?: string): void {
    this.dateien.set(pfad, { inhalt: alsBytes(schreibeCsv(felder, zeilen)), geaendert });
  }

  async liste(verzeichnis: string): Promise<Verzeichniseintrag[]> {
    return [...this.dateien.entries()]
      .filter(([pfad]) => pfad.startsWith(verzeichnis + '/'))
      .map(([pfad, eintrag]) => ({ name: pfad.slice(verzeichnis.length + 1), geaendert: eintrag.geaendert }));
  }

  async lies(pfad: string): Promise<Uint8Array> {
    const eintrag = this.dateien.get(pfad);

    if (!eintrag) {
      throw new Error(`Es gibt keine Datei ${pfad}`);
    }

    return eintrag.inhalt;
  }

  async schreibe(): Promise<void> {
    throw new Error('Referenzdaten werden nur gelesen');
  }

  async entferne(): Promise<void> {
    throw new Error('Referenzdaten werden nur gelesen');
  }

  pfad(verzeichnis: string, name: string): string {
    return `${verzeichnis}/${name}`;
  }
}

function werkbank() {
  const ablage = new Ablage();
  const bestand = new InMemoryReferenzquellenRepository();
  const protokoll: string[] = [];

  return {
    ablage,
    bestand,
    protokoll,
    dienst: new Referenzquellendienst(bestand, ablage, { log: (eintrag) => protokoll.push(eintrag.message) }),
  };
}

const WUNSCH = { region: DEFAULT_REGION };

const PLZ: [string[], string[][]] = [
  ['plz', 'ort'],
  [
    ['53111', 'Bonn'],
    ['50667', 'Köln'],
  ],
];

/* ---------- Anlegen ---------- */

test('eine Referenzquelle ohne Namen oder Verzeichnis wird abgelehnt', async () => {
  // Geprüft beim Anlegen und nicht erst im Nachtlauf: Dort ist niemand, der sie
  // eintragen könnte.
  const { dienst } = werkbank();

  await assert.rejects(
    () => dienst.lege({ tenantId: 't1', name: '', verzeichnis: '/ref' }),
    (fehler: Error) => {
      assert.ok(fehler instanceof ReferenzquellenFehler);
      assert.match(fehler.message, /Name/);

      return true;
    }
  );

  assert.deepEqual(maengel({ name: 'PLZ', verzeichnis: '' }).length, 1);
});

test('eine zweite Änderung legt keine zweite Quelle an', async () => {
  const { dienst } = werkbank();

  const erste = await dienst.lege({ tenantId: 't1', name: 'PLZ', verzeichnis: '/ref' });
  const zweite = await dienst.lege({ id: erste.id, tenantId: 't1', name: 'PLZ 2026', verzeichnis: '/ref' });

  assert.equal(zweite.id, erste.id);
  assert.equal(zweite.angelegt, erste.angelegt, 'der Zeitpunkt der Anlage bleibt');
  assert.equal((await dienst.liste('t1')).length, 1);
});

/* ---------- Nachsehen ---------- */

test('das Nachsehen schreibt fest, was in der Datei stand', async () => {
  /*
   * Damit jemand beim Einrichten sieht, ob die Referenz die Felder hat, über
   * die er nachschlagen will — statt es im Nachtlauf zu erfahren, wenn kein
   * Treffer zustande kommt und niemand weiß, warum.
   */
  const { dienst, ablage } = werkbank();

  ablage.lege('/ref/plz.csv', ...PLZ, '2026-01-05T10:00:00.000Z');

  const angelegt = await dienst.lege({ tenantId: 't1', name: 'PLZ', verzeichnis: '/ref' });
  const geprueft = await dienst.pruefe(angelegt.id, WUNSCH);

  assert.equal(geprueft.gesehen?.datei, 'plz.csv');
  assert.deepEqual(geprueft.gesehen?.felder, ['plz', 'ort']);
  assert.equal(geprueft.gesehen?.zeilen, 2);
  assert.equal(geprueft.gesehen?.geaendert, '2026-01-05T10:00:00.000Z');
});

test('eine Quelle, deren Datei fehlt, nennt sich beim Namen', async () => {
  /*
   * „Kein lesbarer Inhalt in /ref" schickt jemanden in ein Verzeichnis; der
   * Name der Quelle sagt ihm zugleich, welche Einstellung dahintersteht.
   */
  const { dienst } = werkbank();

  const angelegt = await dienst.lege({ tenantId: 't1', name: 'PLZ-Verzeichnis', verzeichnis: '/leer' });

  await assert.rejects(() => dienst.pruefe(angelegt.id, WUNSCH), /PLZ-Verzeichnis/);
});

/* ---------- Für den Lauf ---------- */

test('der Bestand für den Lauf trägt Name und Version mit', async () => {
  /*
   * „Ein Lauf, der sich nicht auf eine Version berufen kann, ist nicht
   * reproduzierbar." Ohne sie wäre die Herkunft eines übernommenen Wertes
   * „irgendeine Referenz".
   */
  const { dienst, ablage } = werkbank();

  ablage.lege('/ref/plz.csv', ...PLZ, '2026-01-05T10:00:00.000Z');

  const angelegt = await dienst.lege({
    tenantId: 't1',
    name: 'PLZ-Verzeichnis',
    verzeichnis: '/ref',
    version: '2026-Q1',
  });

  const bestand = await dienst.fuerLauf(angelegt.id, WUNSCH);

  assert.equal(bestand.name, 'PLZ-Verzeichnis');
  assert.equal(bestand.version, '2026-Q1');
  assert.deepEqual(bestand.felder, ['plz', 'ort']);
  assert.equal(bestand.zeilen.length, 2);
});

test('ohne eigene Version gilt das Änderungsdatum der Datei', async () => {
  // Genau und nichtssagend — aber eine Tatsache, und die lässt sich nachprüfen.
  const { dienst, ablage } = werkbank();

  ablage.lege('/ref/plz.csv', ...PLZ, '2026-01-05T10:00:00.000Z');

  const angelegt = await dienst.lege({ tenantId: 't1', name: 'PLZ', verzeichnis: '/ref' });

  assert.equal((await dienst.fuerLauf(angelegt.id, WUNSCH)).version, '2026-01-05T10:00:00.000Z');
});

test('eine erfundene Version gibt es nicht', async () => {
  // Sie sähe aus wie eine Zusage.
  assert.equal(versionVon({ version: '   ' } as never, undefined), undefined);
});

test('eine bestimmte Datei lässt sich verlangen', async () => {
  const { dienst, ablage } = werkbank();

  ablage.lege('/ref/a.csv', ['plz'], [['53111']]);
  ablage.lege('/ref/b.csv', ...PLZ);

  const angelegt = await dienst.lege({ tenantId: 't1', name: 'PLZ', verzeichnis: '/ref', datei: 'b.csv' });

  assert.deepEqual((await dienst.fuerLauf(angelegt.id, WUNSCH)).felder, ['plz', 'ort']);
});

test('eine Quelle, die es nicht gibt, wird beim Aufruf gemeldet', async () => {
  const { dienst } = werkbank();

  await assert.rejects(() => dienst.fuerLauf('gibtesnicht', WUNSCH), ReferenzquellenFehler);
});

/* ---------- Entfernen ---------- */

test('das Entfernen nimmt den Eintrag, nicht die Datei', async () => {
  /*
   * Der Eintrag ist ein Verweis und keine Aufzeichnung. Was ein Lauf mit der
   * Datei getan hat, steht in seinem Bericht — samt Name und Version.
   */
  const { dienst, ablage, protokoll } = werkbank();

  ablage.lege('/ref/plz.csv', ...PLZ);

  const angelegt = await dienst.lege({ tenantId: 't1', name: 'PLZ', verzeichnis: '/ref' });

  await dienst.entferne(angelegt.id);

  assert.equal((await dienst.liste('t1')).length, 0);
  assert.equal(ablage.dateien.has('/ref/plz.csv'), true, 'die Datei bleibt liegen');
  assert.ok(
    protokoll.some((eintrag) => /Referenzquelle entfernt/.test(eintrag) && /bleibt liegen/.test(eintrag)),
    protokoll.join(' | ')
  );
});
