import assert from 'node:assert/strict';
import test from 'node:test';

import type { Archivpaket } from '../../domain/transfer/Archivpaket.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import type { Vorentscheidung } from '../../domain/consolidation/Vorentscheidung.js';
import { InMemoryPaketRepository } from '../../infrastructure/persistence/InMemoryPaketRepository.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import type { Archivdienst } from '../workflow/Archivdienst.js';
import type { Korrekturauftrag } from '../workflow/WorkflowExecutionService.js';
import { Korrekturdienst, KorrekturFehler, type Fallakte } from './Korrekturdienst.js';

const BENUTZER = { id: 'anna', name: 'Anna' };

const VORGABE: Vorentscheidung = {
  datensatz: '4711',
  werte: { ort: 'Hamburg' },
  herkunft: 'Konfliktfall 3f2a, entschieden am 26.08.2026',
};

function paket(): Archivpaket {
  return {
    id: 'p1',
    tenantId: 'default',
    jobId: 'job1',
    laufId: 'TR-1',
    pfad: '/archiv/Nachtlauf_TR-1.zip.enc',
    name: 'Nachtlauf_TR-1.zip.enc',
    dateien: 2,
    erstellt: '2026-08-25T03:00:00.000Z',
  };
}

/** Merkt sich, was der Dienst mit den Fällen gemacht hat. */
function fallakte(): Fallakte & { freigegeben: string[]; abgeschlossene: string[]; laeufe: string[] } {
  const freigegeben: string[] = [];
  const abgeschlossene: string[] = [];
  const laeufe: string[] = [];

  return {
    freigegeben,
    abgeschlossene,
    laeufe,
    async zurVerarbeitung(_tenantId, _benutzer, optionen) {
      freigegeben.push('f1');
      laeufe.push(optionen.neuerLaufId);

      return {
        felder: ['konflikt_uuid', 'ort'],
        zeilen: [['f1', 'Hamburg']],
        ids: ['f1'],
        vorentscheidungen: [VORGABE],
      };
    },
    async abschliessen(ids) {
      abgeschlossene.push(...ids);

      return ids.length;
    },
  };
}

/** Gibt zwei Dateien heraus und merkt sich, welches Paket geöffnet wurde. */
function archivDoppel(): Archivdienst & { geoeffnet: string[] } {
  const geoeffnet: string[] = [];

  return {
    geoeffnet,
    async oeffne(pfad: string) {
      geoeffnet.push(pfad);

      return {
        pfad,
        dateien: [
          { name: 'CRM.csv', inhalt: new Uint8Array([1]) },
          { name: 'ERP.csv', inhalt: new Uint8Array([2]) },
        ],
      };
    },
  } as unknown as Archivdienst & { geoeffnet: string[] };
}

function ausfuehrung(status = TransferRunStatus.SUCCESS) {
  const auftraege: Korrekturauftrag[] = [];

  return {
    auftraege,
    dienst: {
      async korrigiere(_job: TransferJob, auftrag: Korrekturauftrag) {
        auftraege.push(auftrag);

        return { status, message: 'Konsolidierung erledigt' };
      },
    },
  };
}

async function baue(optionen: { status?: TransferRunStatus; ohnePaket?: boolean; ohneJob?: boolean } = {}) {
  const bestand = new InMemoryPaketRepository();

  if (!optionen.ohnePaket) {
    await bestand.save(paket());
  }

  const faelle = fallakte();
  const archiv = archivDoppel();
  const lauf = ausfuehrung(optionen.status);
  const zeilen: string[] = [];

  const dienst = new Korrekturdienst(
    faelle,
    bestand,
    archiv,
    { async getById() { return optionen.ohneJob ? undefined : createTransferJob({ id: 'job1' }); } },
    lauf.dienst,
    { log: (eintrag) => zeilen.push(eintrag.message) }
  );

  return { dienst, faelle, archiv, lauf, zeilen };
}

/* ---------- Der Regelfall ---------- */

test('aus entschiedenen Fällen wird ein Lauf', async () => {
  const { dienst, faelle, archiv, lauf } = await baue();

  const ergebnis = await dienst.fuehreAus({
    tenantId: 'default',
    laufId: 'TR-1',
    neuerLaufId: 'KOR-1',
    benutzer: BENUTZER,
  });

  assert.equal(ergebnis.gelungen, true);
  assert.deepEqual(archiv.geoeffnet, ['/archiv/Nachtlauf_TR-1.zip.enc'], 'die Lieferung von damals');
  assert.equal(lauf.auftraege[0].ausLauf, 'TR-1');
  assert.equal(lauf.auftraege[0].laufId, 'KOR-1');
  assert.deepEqual(lauf.auftraege[0].vorentscheidungen, [VORGABE]);
  assert.deepEqual(faelle.abgeschlossene, ['f1']);
});

test('die Zieldatei kommt als Nachweis mit', async () => {
  /*
   * Gerechnet wird nicht aus ihr, sondern aus den Entscheidungen im Bestand.
   * Sie ist das, was man einem Lieferanten hinlegt oder in drei Monaten
   * nachsieht.
   */
  const { dienst } = await baue();

  const ergebnis = await dienst.fuehreAus({
    tenantId: 'default',
    laufId: 'TR-1',
    neuerLaufId: 'KOR-1',
    benutzer: BENUTZER,
  });

  assert.deepEqual(ergebnis.zieldatei.felder, ['konflikt_uuid', 'ort']);
  assert.deepEqual(ergebnis.zieldatei.zeilen, [['f1', 'Hamburg']]);
});

/* ---------- Der vierte Schritt ist keine Formsache ---------- */

test('misslingt der Lauf, wird nichts abgeschlossen', async () => {
  /*
   * „Ein bearbeiteter Konflikt gilt erst dann als erfolgreich verarbeitet, wenn
   * die anschließende Verarbeitung erfolgreich abgeschlossen wurde." Wer sie
   * vorher abschlösse, hätte einen Bestand, in dem alles erledigt aussieht und
   * nichts geliefert wurde.
   */
  const { dienst, faelle, zeilen } = await baue({ status: TransferRunStatus.COMPLETED_WITH_ERRORS });

  const ergebnis = await dienst.fuehreAus({
    tenantId: 'default',
    laufId: 'TR-1',
    neuerLaufId: 'KOR-1',
    benutzer: BENUTZER,
  });

  assert.equal(ergebnis.gelungen, false);
  assert.equal(ergebnis.abgeschlossen, 0);
  assert.deepEqual(faelle.abgeschlossene, [], 'die Fälle bleiben auf „erneut verarbeitet"');
  assert.ok(zeilen.some((zeile) => /misslungen/.test(zeile)), zeilen.join(' | '));
});

test('ein Lauf ohne Dateien gilt trotzdem als durch', async () => {
  // Eine Lieferung, aus der nach den Regeln nichts übrig bleibt, ist kein
  // Fehlschlag — und die Fälle sind dann tatsächlich durch.
  const { dienst, faelle } = await baue({ status: TransferRunStatus.SUCCESS_NO_FILES });

  const ergebnis = await dienst.fuehreAus({
    tenantId: 'default',
    laufId: 'TR-1',
    neuerLaufId: 'KOR-1',
    benutzer: BENUTZER,
  });

  assert.equal(ergebnis.gelungen, true);
  assert.deepEqual(faelle.abgeschlossene, ['f1']);
});

/* ---------- Erst das Paket, dann der Statuswechsel ---------- */

test('ohne Archivpaket wird kein Fall angefasst', async () => {
  /*
   * Andersherum stünden die Fälle auf „erneut verarbeitet", und dann fiele auf,
   * dass es keine Lieferung gibt, auf die man sie anwenden könnte — sie wären
   * aus der Bearbeitung heraus und hätten keinen Weg zurück.
   */
  const { dienst, faelle } = await baue({ ohnePaket: true });

  await assert.rejects(
    () =>
      dienst.fuehreAus({ tenantId: 'default', laufId: 'TR-1', neuerLaufId: 'KOR-1', benutzer: BENUTZER }),
    (fehler: unknown) => fehler instanceof KorrekturFehler && /kein Archivpaket/.test(fehler.message)
  );

  assert.deepEqual(faelle.freigegeben, [], 'nichts freigegeben');
});

test('ohne Workflow ebenfalls nicht', async () => {
  const { dienst, faelle } = await baue({ ohneJob: true });

  await assert.rejects(
    () =>
      dienst.fuehreAus({ tenantId: 'default', laufId: 'TR-1', neuerLaufId: 'KOR-1', benutzer: BENUTZER }),
    (fehler: unknown) => fehler instanceof KorrekturFehler && /gibt es nicht mehr/.test(fehler.message)
  );

  assert.deepEqual(faelle.freigegeben, []);
});

/* ---------- Das Protokoll ---------- */

test('der Lauf steht mit Herkunft und Umfang im Protokoll', async () => {
  const { dienst, zeilen } = await baue();

  await dienst.fuehreAus({ tenantId: 'default', laufId: 'TR-1', neuerLaufId: 'KOR-1', benutzer: BENUTZER });

  assert.ok(
    zeilen.some((zeile) => /Korrekturlauf KOR-1 zu Lauf TR-1: 1 Fall\/Fälle, 2 Datei\(en\)/.test(zeile)),
    zeilen.join(' | ')
  );
});
