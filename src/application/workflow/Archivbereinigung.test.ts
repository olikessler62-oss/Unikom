import assert from 'node:assert/strict';
import test from 'node:test';

import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { Archivbereinigung, archivverzeichnisse } from './Archivbereinigung.js';

function job(teile: { id: string; tenantId: string; archiv?: string; weitere?: string[] }): TransferJob {
  return {
    id: teile.id,
    tenantId: teile.tenantId,
    name: teile.id,
    consolidation: {
      enabled: true,
      dateien: teile.archiv ? { abholung: { archiv: teile.archiv } } : undefined,
      weitere: (teile.weitere ?? []).map((archiv, stelle) => ({
        enabled: true,
        name: `Durchgang ${stelle + 2}`,
        dateien: { abholung: { archiv } },
      })),
    },
  } as unknown as TransferJob;
}

/* ---------- Woher die Verzeichnisse kommen ---------- */

test('gesammelt wird über alle Durchgänge eines Mandanten', () => {
  const orte = archivverzeichnisse(
    [
      job({ id: 'a', tenantId: 'default', archiv: '/archiv/eins', weitere: ['/archiv/zwei'] }),
      job({ id: 'b', tenantId: 'default', archiv: '/archiv/drei' }),
    ],
    'default'
  );

  assert.deepEqual(orte.sort(), ['/archiv/drei', '/archiv/eins', '/archiv/zwei']);
});

test('ein fremder Mandant bleibt außen vor', () => {
  // Die Trennung der Mandanten ist der Grund, warum es sie überhaupt gibt.
  assert.deepEqual(archivverzeichnisse([job({ id: 'a', tenantId: 'kunde-b', archiv: '/fremd' })], 'default'), []);
});

test('dasselbe Verzeichnis wird einmal bereinigt, nicht zweimal', () => {
  /*
   * Im zweiten Durchgang stolperte die Bereinigung sonst über Dateien, die der
   * erste schon fortgenommen hat.
   */
  const orte = archivverzeichnisse(
    [
      job({ id: 'a', tenantId: 'default', archiv: '/archiv/gemeinsam' }),
      job({ id: 'b', tenantId: 'default', archiv: '/archiv/gemeinsam' }),
    ],
    'default'
  );

  assert.deepEqual(orte, ['/archiv/gemeinsam']);
});

test('ein Workflow ohne Archiv bringt kein Verzeichnis mit', () => {
  assert.deepEqual(archivverzeichnisse([job({ id: 'a', tenantId: 'default' })], 'default'), []);
});

/* ---------- Die Frist des Mandanten ---------- */

/** Merkt sich, womit der Dienst gerufen wurde. */
function dienstDoppel() {
  const aufrufe: { verzeichnis: string; tage?: number }[] = [];

  return {
    aufrufe,
    dienst: {
      async bereinige(verzeichnis: string, optionen: { tage?: number; jetzt: Date }) {
        aufrufe.push({ verzeichnis, tage: optionen.tage });

        return { entfernt: [`${verzeichnis}/alt.zip.enc`], fehler: [] };
      },
    },
  };
}

function mandanten(...eintraege: { id: string; archivTage?: number }[]) {
  return {
    async list() {
      return eintraege.map((eintrag) => ({ ...eintrag, name: eintrag.id, enabled: true })) as never;
    },
  } as never;
}

test('jeder Mandant bekommt seine eigene Frist', () => {
  /*
   * Der eine Kunde muss Lieferscheine sieben Jahre vorhalten, der nächste will
   * personenbezogene Daten nach einem Quartal fort haben.
   */
  const { aufrufe, dienst } = dienstDoppel();
  const bereinigung = new Archivbereinigung(
    mandanten({ id: 'a', archivTage: 7 }, { id: 'b', archivTage: 400 }),
    { async list() { return [job({ id: '1', tenantId: 'a', archiv: '/a' }), job({ id: '2', tenantId: 'b', archiv: '/b' })]; } },
    dienst as never
  );

  return bereinigung.bereinige(new Date()).then(() => {
    assert.deepEqual(aufrufe, [
      { verzeichnis: '/a', tage: 7 },
      { verzeichnis: '/b', tage: 400 },
    ]);
  });
});

test('ohne eigene Frist wird keine mitgegeben — dann gilt die Voreinstellung', () => {
  // Eine Null von hier hieße „nie forträumen"; das ist etwas anderes als
  // „nichts eingestellt".
  const { aufrufe, dienst } = dienstDoppel();
  const bereinigung = new Archivbereinigung(
    mandanten({ id: 'a' }),
    { async list() { return [job({ id: '1', tenantId: 'a', archiv: '/a' })]; } },
    dienst as never
  );

  return bereinigung.bereinige(new Date()).then(() => {
    assert.deepEqual(aufrufe, [{ verzeichnis: '/a', tage: undefined }]);
  });
});

test('was fortgenommen wurde, wird gezählt und protokolliert', async () => {
  /*
   * Je Paket eine Zeile: Ein Archiv ist das Original einer Lieferung. Dass es
   * fort ist, gehört einzeln ins Protokoll und nicht in eine Tagessumme.
   */
  const { dienst } = dienstDoppel();
  const zeilen: string[] = [];

  const ergebnis = await new Archivbereinigung(
    mandanten({ id: 'a' }),
    { async list() { return [job({ id: '1', tenantId: 'a', archiv: '/a' })]; } },
    dienst as never,
    { log: (eintrag) => zeilen.push(eintrag.message) }
  ).bereinige(new Date());

  assert.equal(ergebnis.entfernt, 1);
  assert.equal(ergebnis.fehler, 0);
  assert.match(zeilen[0], /„\/a\/alt\.zip\.enc" ist abgelaufen und wurde fortgenommen/);
});

test('ein Mandant ohne Archivverzeichnis wird übersprungen', async () => {
  const { aufrufe, dienst } = dienstDoppel();

  await new Archivbereinigung(
    mandanten({ id: 'a' }),
    { async list() { return [job({ id: '1', tenantId: 'a' })]; } },
    dienst as never
  ).bereinige(new Date());

  assert.deepEqual(aufrufe, []);
});
