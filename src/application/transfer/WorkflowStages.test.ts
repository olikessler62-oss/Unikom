import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { StaticFeatureSet } from '../../domain/licensing/Feature.js';
import { TransferRunStatus } from '../../domain/transfer/TransferRun.js';
import {
  activeStages,
  followingStage,
  numberedStages,
  precedingStage,
  type DeliverConfig,
  type StageConfig,
} from '../../domain/transfer/WorkflowStages.js';
import { InMemoryTransferFileRepository } from '../../infrastructure/persistence/InMemoryTransferFileRepository.js';
import { InMemoryTransferJobRepository } from '../../infrastructure/persistence/InMemoryTransferJobRepository.js';
import { LocalSourceAdapter } from '../../infrastructure/sources/local/LocalSourceAdapter.js';
import { reviveJob } from '../../infrastructure/persistence/TransferRecordMapping.js';
import { createTransferJob } from '../../testing/TransferJobFixture.js';
import { requiredFeaturesFor } from '../licensing/JobLicensing.js';
import { TransferExecutionService } from './TransferExecutionService.js';
import { TransferJobService } from './TransferJobService.js';

/**
 * A workflow is built from links that are bought separately and combined
 * freely. Written around what that makes possible and what it makes breakable:
 * a link that inherits from nothing, a link that hands on to nothing, and a
 * module that gets used without being paid for.
 */

/** Reads from the link before it, writes into a directory of its own. */
const CHAINED: StageConfig = {
  enabled: true,
  input: { from: 'PRECEDING' },
  output: { to: 'DIRECTORY', directory: '/out' },
};

/** The same link as the whole workflow: it has to name both ends itself. */
const STANDALONE: StageConfig = {
  enabled: true,
  input: { from: 'DIRECTORY', directory: '/verzeichnis-x' },
  output: { to: 'DIRECTORY', directory: '/verzeichnis-x-fertig' },
};

const OFF = { enabled: false } as const;

/** Ausliefern als Datei, mit eigenem Ergebnisverzeichnis. */
const EXPORT: DeliverConfig = { ...STANDALONE, ziel: 'DATEI' };

/** Ausliefern in eine Datenbank — kein Verzeichnis, es schreibt in Tabellen. */
const IN_DIE_DATENBANK: DeliverConfig = {
  enabled: true,
  input: { from: 'DIRECTORY', directory: '/verzeichnis-x' },
  ziel: 'DATENBANK',
};

test('consolidating a directory is a whole workflow on its own', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const saved = await service.create(
    createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE } })
  );

  assert.deepEqual(activeStages(saved), ['CONSOLIDATE']);
  // Only what it uses is charged for — no transfer, no conversion, no import.
  assert.deepEqual(requiredFeaturesFor(saved), ['CONSOLIDATION']);
  assert.ok(!requiredFeaturesFor(saved).includes('TRANSFER'), 'nobody pays for a transfer they never run');
});

/**
 * Ausliefern ist **ein** Glied mit einer Verzweigung — nicht zwei Glieder
 * hintereinander. Wer in eine Datenbank importiert, konvertiert davor keine
 * Datei; wer eine Datei ausliefert, importiert nichts. Als Kette gestellt las
 * das Konvertieren aus dem Import, der Tabellen füllt und keine Datei
 * hinterlässt.
 */
test('der Zweig entscheidet, welches Modul das Ausliefern verlangt', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const konvertiert = await service.create(
    createTransferJob({ transfer: OFF, delivery: { ...EXPORT, konvertieren: { format: 'JSON' } } })
  );
  const inDieDatenbank = await service.create(
    createTransferJob({ transfer: OFF, delivery: { ...IN_DIE_DATENBANK } })
  );

  assert.deepEqual(requiredFeaturesFor(konvertiert), ['CONVERSION']);
  assert.deepEqual(requiredFeaturesFor(inDieDatenbank), ['DATA_IMPORT']);

  // Eines zu kaufen darf das andere nicht mitliefern.
  assert.ok(!requiredFeaturesFor(konvertiert).includes('DATA_IMPORT'));
  assert.ok(!requiredFeaturesFor(inDieDatenbank).includes('CONVERSION'));
});

test('ein unveränderter Export verlangt eine der beiden Hälften, nicht beide', async () => {
  /*
   * Ein Export ohne Konvertierung ist selbst keine Konvertierung und kein
   * Datenbankimport. Verlangte man beide, könnte ein Kunde mit nur einer Hälfte
   * gar nichts ausliefern; verlangte man keine, ginge es ganz ohne Modul 3.
   */
  const nurImport = new TransferJobService(
    new InMemoryTransferJobRepository(),
    new StaticFeatureSet(['DATA_IMPORT'])
  );
  const nurKonvertierung = new TransferJobService(
    new InMemoryTransferJobRepository(),
    new StaticFeatureSet(['CONVERSION'])
  );
  const ohneModulDrei = new TransferJobService(
    new InMemoryTransferJobRepository(),
    new StaticFeatureSet(['CONSOLIDATION'])
  );

  await nurImport.create(createTransferJob({ transfer: OFF, delivery: { ...EXPORT } }));
  await nurKonvertierung.create(createTransferJob({ transfer: OFF, delivery: { ...EXPORT } }));

  await assert.rejects(
    () => ohneModulDrei.create(createTransferJob({ transfer: OFF, delivery: { ...EXPORT } })),
    /Daten importieren|Daten konvertieren/,
    'ohne Modul 3 verlässt keine Datei das Haus'
  );
});

test('transfer and delivery without consolidation chain directly', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const saved = await service.create(
    createTransferJob({ delivery: { ...CHAINED, ziel: 'DATEI', konvertieren: { format: 'CSV' } } })
  );

  assert.deepEqual(activeStages(saved), ['TRANSFER', 'DELIVER']);
  assert.deepEqual(requiredFeaturesFor(saved), ['TRANSFER', 'CONVERSION'], 'two links, two modules');
  assert.equal(precedingStage('DELIVER', saved), 'TRANSFER', 'it reads what the transfer put down');
  assert.equal(followingStage('DELIVER', saved), undefined, 'nothing follows the last link');
});

/**
 * The numbers mark the sequence of *this* workflow, not the identity of the
 * modules. Two customers with different modules therefore see different numbers
 * on the same link, which is the point: the number answers "when does this run",
 * and the name answers "what is this".
 */
test('the numbers count the links this workflow actually uses', () => {
  const full = createTransferJob({
    consolidation: { ...CHAINED, output: { to: 'FOLLOWING' } },
    delivery: { ...CHAINED, ziel: 'DATEI' },
  });

  assert.deepEqual(
    [...numberedStages(full)],
    [
      ['TRANSFER', 1],
      ['CONSOLIDATE', 2],
      ['DELIVER', 3],
    ]
  );

  // Dasselbe Ausliefern ist Nummer 2 für jemanden, der weniger gekauft hat.
  const two = createTransferJob({
    transfer: OFF,
    consolidation: { ...STANDALONE, output: { to: 'FOLLOWING' } },
    delivery: { ...CHAINED, ziel: 'DATEI' },
  });

  assert.deepEqual(
    [...numberedStages(two)],
    [
      ['CONSOLIDATE', 1],
      ['DELIVER', 2],
    ]
  );
});

test('a workflow of one link carries no number at all', () => {
  // A lone "1" would only suggest a missing "2".
  assert.equal(numberedStages(createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE } })).size, 0);
  assert.equal(numberedStages(createTransferJob({})).size, 0);
});

test('a workflow with nothing switched on is refused', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create(createTransferJob({ transfer: OFF })),
    /kein einziger Schritt eingeschaltet/,
    'otherwise it would run every night and do nothing'
  );
});

test('a link cannot inherit a source when nothing precedes it', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () => service.create(createTransferJob({ transfer: OFF, consolidation: { ...CHAINED } })),
    /keinen Schritt davor/
  );
});

test('a link cannot hand on when nothing follows it', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({ consolidation: { ...CHAINED, output: { to: 'FOLLOWING' } } })
      ),
    /folgt aber kein Schritt/
  );

  // With a link behind it there is somewhere for the result to go.
  await service.create(
    createTransferJob({
      consolidation: { ...CHAINED, output: { to: 'FOLLOWING' } },
      delivery: { ...CHAINED, ziel: 'DATEI' },
    })
  );
});

test('a directory that was chosen but left empty is refused', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({ consolidation: { ...CHAINED, input: { from: 'DIRECTORY', directory: '  ' } } })
      ),
    /Quelle von „Daten konsolidieren“ braucht ein Verzeichnis/
  );

  await assert.rejects(
    () => service.create(createTransferJob({ delivery: { ...CHAINED, ziel: 'DATEI', output: undefined } })),
    /braucht ein Verzeichnis/
  );
});

test('ein Datenbankimport braucht kein Verzeichnis, weil er in Tabellen schreibt', async () => {
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await service.create(
    createTransferJob({ delivery: { enabled: true, input: { from: 'PRECEDING' }, ziel: 'DATENBANK' } })
  );
});

test('ohne ein Glied dahinter braucht die Konsolidierung ein Ergebnisverzeichnis', async () => {
  /*
   * Festgelegt am 20.08.2026: „Wenn Modul 3 nicht ausgeführt werden kann (nicht
   * angehakt, nicht gekauft), dann brauchen wir bei Modul 2 ein
   * Ergebnis-Verzeichnis, das angegeben werden muss."
   *
   * Der Ergebnisbestand aus Etappe 7 hebt das **nicht** auf, so naheliegend der
   * Gedanke ist: Er ist Unikoms eigene Buchführung — geprüft, freigegeben, mit
   * Geschichte. Der Kunde kommt an seine Daten über ein Verzeichnis, und wer nur
   * Modul 2 gekauft hat, hat kein anderes Glied, das sie ihm hinlegt.
   */
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE, output: undefined } })
      ),
    /Ziel von „Daten konsolidieren“ braucht ein Verzeichnis/
  );
});

test('ein leer gelassenes Ergebnisverzeichnis ist keine Angabe', async () => {
  // Sonst schriebe der Lauf in ein Verzeichnis namens „" — und das Formular
  // hätte den Benutzer glauben lassen, er sei fertig.
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  await assert.rejects(
    () =>
      service.create(
        createTransferJob({
          transfer: OFF,
          consolidation: { ...STANDALONE, output: { to: 'DIRECTORY', directory: '   ' } },
        })
      ),
    /braucht ein Verzeichnis/
  );
});

test('mit einem Glied dahinter genügt das Weiterreichen', async () => {
  /*
   * Die Bedingung ist „wenn Modul 3 nicht ausgeführt werden kann". Läuft es,
   * nimmt es das Ergebnis entgegen — dann wäre ein Verzeichnis dazwischen eine
   * Ablage, die niemand leert.
   */
  const service = new TransferJobService(new InMemoryTransferJobRepository());

  const angelegt = await service.create(
    createTransferJob({
      transfer: OFF,
      consolidation: { ...STANDALONE, output: { to: 'FOLLOWING' } },
      delivery: {
        enabled: true,
        input: { from: 'PRECEDING' },
        output: { to: 'DIRECTORY', directory: 'C:/ergebnis' },
        ziel: 'DATEI',
      },
    })
  );

  assert.deepEqual(angelegt.consolidation?.output, { to: 'FOLLOWING' });
});

test('a stored job that predates the switches still transfers', () => {
  // Such a job carries no flags at all and must keep doing what it did.
  assert.deepEqual(activeStages(createTransferJob({})), ['TRANSFER']);
  assert.equal(precedingStage('TRANSFER', createTransferJob({})), undefined);
});

test('a job needing a module the installation lacks is refused when it is saved', async () => {
  const service = new TransferJobService(
    new InMemoryTransferJobRepository(),
    new StaticFeatureSet(['TRANSFER', 'CONVERSION'])
  );

  await assert.rejects(
    () => service.create(createTransferJob({ consolidation: { ...CHAINED } })),
    /Daten konsolidieren/,
    'the message has to name the module, not just say no'
  );

  // The ones they do have go through.
  await service.create(
    createTransferJob({ delivery: { ...CHAINED, ziel: 'DATEI', konvertieren: { format: 'XML' } } })
  );
});

test('a switched-off link costs nothing', () => {
  const job = createTransferJob({
    consolidation: { ...CHAINED, enabled: false },
    delivery: { ...CHAINED, ziel: 'DATEI', enabled: false },
  });

  // The transfer is still on, and it is a module like the others now.
  assert.deepEqual(requiredFeaturesFor(job), ['TRANSFER']);
  assert.deepEqual(requiredFeaturesFor(createTransferJob({ transfer: OFF, consolidation: { ...STANDALONE } })), [
    'CONSOLIDATION',
  ]);
});

/**
 * The wiring can be saved before the engines exist. What must not happen is
 * that such a job runs the transfer and quietly drops the rest: the files would
 * arrive unprocessed under the name of a workflow that promises processing, and
 * nothing in the result would say so.
 */
test('a workflow whose module is not built yet refuses to run instead of doing half of it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-stages-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'dest');

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'customer;amount\nMUELLER;42\n', 'utf8');

  const service = new TransferExecutionService({
    transferFileRepository: new InMemoryTransferFileRepository(),
    stagingRoot: path.join(root, 'application-data'),
  });

  const result = await service.execute(
    createTransferJob({
      sourceDirectory: source,
      destinationDirectory: destination,
      allowedExtensions: ['csv'],
      // Das Ausliefern ist das Glied, das noch aussteht — Modul 3.
      delivery: { ...CHAINED, ziel: 'DATEI' },
    }),
    new LocalSourceAdapter(source)
  );

  assert.equal(result.status, TransferRunStatus.FAILED);
  assert.match(result.message, /noch nicht gebaut/);
  assert.match(result.message, /Daten exportieren\/importieren/, 'the message names the link, not a number');
  assert.deepEqual(await fs.readdir(destination), [], 'nothing may have been delivered');
  assert.deepEqual(await fs.readdir(source), ['ORDER_001.csv'], 'and the source is untouched');
});

test('a workflow that only transfers still runs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-stages-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'dest');

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(source, 'ORDER_001.csv'), 'customer;amount\nMUELLER;42\n', 'utf8');

  const service = new TransferExecutionService({
    transferFileRepository: new InMemoryTransferFileRepository(),
    stagingRoot: path.join(root, 'application-data'),
  });

  const result = await service.execute(
    createTransferJob({
      sourceDirectory: source,
      destinationDirectory: destination,
      allowedExtensions: ['csv'],
      // Present but off — the guard must look at `enabled`, not at presence.
      consolidation: { ...CHAINED, enabled: false },
    }),
    new LocalSourceAdapter(source)
  );

  assert.equal(result.filesSucceeded, 1, result.message);
  assert.deepEqual(await fs.readdir(destination), ['ORDER_001.csv']);
});

/* ---------- Was aus gespeicherten Workflows wird ---------- */

test('ein gespeicherter Workflow mit zwei Ausliefer-Gliedern wird zu einem', () => {
  /*
   * „Daten importieren" und „Daten konvertieren" standen einmal als zwei
   * Kettenglieder nebeneinander. Wer so gespeichert hat, soll nach dem Umbau
   * nicht plötzlich einen Workflow haben, der nichts mehr ausliefert.
   */
  const alterExport = reviveJob({
    ...createTransferJob({}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversion: { enabled: true, input: { from: 'PRECEDING' }, output: { to: 'DIRECTORY', directory: '/aus' } },
  } as unknown as Record<string, unknown>);

  assert.equal(alterExport.delivery?.enabled, true);
  assert.equal(alterExport.delivery?.ziel, 'DATEI');
  assert.equal(alterExport.delivery?.konvertieren?.format, 'CSV');
  assert.deepEqual(activeStages(alterExport), ['TRANSFER', 'DELIVER']);
});

test('war beides eingeschaltet, gewinnt der Datenbankimport', () => {
  // Er ist der Zweig, der ein fremdes System berührt; ein stiller Wechsel auf
  // die Datei wäre die gefährlichere Auslegung.
  const beides = reviveJob({
    ...createTransferJob({}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataImport: { enabled: true, input: { from: 'PRECEDING' } },
    conversion: { enabled: true, input: { from: 'PRECEDING' }, output: { to: 'DIRECTORY', directory: '/aus' } },
  } as unknown as Record<string, unknown>);

  assert.equal(beides.delivery?.ziel, 'DATENBANK');
  assert.equal(beides.delivery?.konvertieren, undefined);
});

test('ein abgeschaltetes altes Glied wird nicht wieder eingeschaltet', () => {
  const aus = reviveJob({
    ...createTransferJob({}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversion: { enabled: false, input: { from: 'PRECEDING' } },
  } as unknown as Record<string, unknown>);

  assert.equal(aus.delivery, undefined);
  assert.deepEqual(activeStages(aus), ['TRANSFER']);
});
