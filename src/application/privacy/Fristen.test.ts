import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryTenantRepository } from '../../infrastructure/persistence/InMemoryTenantRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { fristenEines, fristenJeMandant } from './Fristen.js';

async function aufbau() {
  const tenants = new InMemoryTenantRepository();
  const jobs = new InMemoryTransferJobRepository();
  const jetzt = new Date('2026-08-19T08:00:00.000Z');

  for (const [id, name] of [
    ['nord', 'Kunde Nord'],
    ['sued', 'Kunde Süd'],
  ]) {
    await tenants.save({
      id,
      name,
      rootDirectory: `C:/daten/${id}`,
      enabled: true,
      createdAt: jetzt,
      updatedAt: jetzt,
    });
  }

  return { tenants, jobs };
}

test('die Fristen stehen beim Mandanten, zu dem der Workflow gehört', async () => {
  const { tenants, jobs } = await aufbau();

  await jobs.save(createTransferJob({ id: 'j1', tenantId: 'nord', name: 'Rechnungen' }));
  await jobs.save(createTransferJob({ id: 'j2', tenantId: 'sued', name: 'Bestellungen' }));

  const fristen = await fristenJeMandant(tenants, jobs);

  assert.deepEqual(
    fristen.map((mandant) => [mandant.name, mandant.workflows.map((workflow) => workflow.name)]),
    [
      ['Kunde Nord', ['Rechnungen']],
      ['Kunde Süd', ['Bestellungen']],
    ]
  );
});

test('ein Mandant ohne Workflow fehlt nicht, sondern steht leer da', async () => {
  // Sonst hieße „nicht in der Liste" mal „keine Workflows" und mal „vergessen".
  const { tenants, jobs } = await aufbau();

  await jobs.save(createTransferJob({ id: 'j1', tenantId: 'nord' }));

  const sued = (await fristenJeMandant(tenants, jobs)).find((mandant) => mandant.tenantId === 'sued');

  assert.ok(sued);
  assert.deepEqual(sued.workflows, []);
});

test('eine Voreinstellung ist als solche gekennzeichnet', async () => {
  // Beim einen hat jemand entschieden, beim anderen hat niemand hingesehen.
  const ohne = fristenEines(createTransferJob({ id: 'j1' }));
  const mit = fristenEines(createTransferJob({ id: 'j2', retention: { logDays: 7 } }));

  const protokoll = (fristen: ReturnType<typeof fristenEines>) =>
    fristen.fristen.find((frist) => frist.was === 'Laufprotokoll');

  assert.deepEqual(protokoll(ohne), { was: 'Laufprotokoll', wert: '90 Tage', voreingestellt: true });
  assert.deepEqual(protokoll(mit), { was: 'Laufprotokoll', wert: '7 Tage', voreingestellt: false });
});

test('eine Historienfrist neben liegen bleibender Quelldatei wird angemerkt', async () => {
  // Diese Kombination holt dieselbe Datei nach Ablauf der Frist ein zweites
  // Mal. Wer die Frist einstellt, soll es dort lesen, wo er sie einstellt.
  const gefaehrlich = fristenEines(
    createTransferJob({ id: 'j1', retention: { historyDays: 30 }, sourceSuccessAction: 'KEEP' })
  );
  const harmlos = fristenEines(
    createTransferJob({ id: 'j2', retention: { historyDays: 30 }, sourceSuccessAction: 'DELETE' })
  );

  const historie = (fristen: ReturnType<typeof fristenEines>) =>
    fristen.fristen.find((frist) => frist.was === 'Verarbeitungshistorie');

  assert.match(historie(gefaehrlich)?.hinweis ?? '', /erneut übernommen/);
  assert.equal(historie(harmlos)?.hinweis, undefined);
});

test('eine liegen bleibende Eingangsdatei wird benannt, nicht verschwiegen', async () => {
  const fristen = fristenEines(createTransferJob({ id: 'j1', sourceSuccessAction: 'KEEP' }));
  const eingang = fristen.fristen.find((frist) => frist.was.startsWith('Eingangsdatei'));

  assert.equal(eingang?.wert, 'bleibt liegen');
  assert.match(eingang?.hinweis ?? '', /den niemand verwaltet/);
});

test('für den Ergebnisbestand gibt es keine Frist, und das steht da', async () => {
  const { tenants, jobs } = await aufbau();
  const nord = (await fristenJeMandant(tenants, jobs))[0];

  assert.equal(nord.fristen[0].was, 'Ergebnisbestand');
  assert.equal(nord.fristen[0].wert, 'unbegrenzt');
  assert.match(nord.fristen[0].hinweis ?? '', /C:\/daten\/nord/);
});
