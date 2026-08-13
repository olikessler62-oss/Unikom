import test from 'node:test';
import assert from 'node:assert/strict';
import { allFeatures, coreOnly, StaticFeatureSet } from '../../domain/licensing/Feature.js';
import {
  advanceContext,
  type FileProcessingContext,
} from '../../domain/processing/FileProcessingContext.js';
import { ProcessingStageError, type ProcessingStage } from '../../domain/processing/ProcessingStage.js';
import { ProcessingStageRegistry } from './ProcessingStageRegistry.js';

function context(overrides: Partial<FileProcessingContext> = {}): FileProcessingContext {
  return {
    runId: 'TR-1',
    jobId: 'job-1',
    sourceFile: { name: 'ORDER_001.csv', fullPath: '/out/ORDER_001.csv', isDirectory: false },
    originalFilename: 'ORDER_001.csv',
    currentFilename: 'ORDER_001.csv',
    temporaryPath: '/staging/TR-1/ORDER_001.csv',
    currentFilePath: 'D:/Incoming/ORDER_001.csv',
    finalDestinationPath: 'D:/Incoming/ORDER_001.csv',
    fileSize: 24,
    sha256: 'a'.repeat(64),
    encrypted: false,
    metadata: {},
    ...overrides,
  };
}

/** Stands in for step 2: reads the file, records what it found, changes nothing. */
const consolidation: ProcessingStage = {
  name: 'consolidation',
  requiredFeature: 'STEP_2_CONSOLIDATION',
  process: async (incoming) =>
    advanceContext(incoming, { metadata: { recordsRead: 2, duplicateRecordsRemoved: 1 } }),
};

/** Stands in for step 3: writes an export next to the file it was handed. */
function exportStage(seen: FileProcessingContext[]): ProcessingStage {
  return {
    name: 'file-export',
    requiredFeature: 'STEP_3_FILE_EXPORT',
    process: async (incoming) => {
      seen.push(incoming);
      return advanceContext(incoming, { metadata: { exportedTo: `${incoming.currentFilePath}.xlsx` } });
    },
  };
}

test('a stage whose module is missing is never registered', () => {
  const registry = new ProcessingStageRegistry(coreOnly());

  assert.equal(registry.register(consolidation), false);
  assert.equal(registry.isEmpty, true);
});

test('registration follows the licence, module by module', () => {
  const registry = new ProcessingStageRegistry(new StaticFeatureSet(['STEP_3_FILE_EXPORT']));

  assert.equal(registry.register(consolidation), false);
  assert.equal(registry.register(exportStage([])), true);
  assert.deepEqual(
    registry.stages.map((stage) => stage.name),
    ['file-export']
  );
});

test('the stages run in order and each sees what the previous one added', async () => {
  const registry = new ProcessingStageRegistry(allFeatures());
  const seen: FileProcessingContext[] = [];
  registry.register(consolidation);
  registry.register(exportStage(seen));

  const result = await registry.run(context());

  assert.deepEqual(seen[0].metadata, { recordsRead: 2, duplicateRecordsRemoved: 1 });
  assert.deepEqual(result.metadata, {
    recordsRead: 2,
    duplicateRecordsRemoved: 1,
    exportedTo: 'D:/Incoming/ORDER_001.csv.xlsx',
  });
});

test('step 3 runs on step 1 output when step 2 was not bought', async () => {
  const registry = new ProcessingStageRegistry(new StaticFeatureSet(['STEP_3_FILE_EXPORT']));
  const seen: FileProcessingContext[] = [];
  registry.register(consolidation);
  registry.register(exportStage(seen));

  await registry.run(context());

  assert.equal(seen.length, 1);
  assert.equal(seen[0].currentFilePath, 'D:/Incoming/ORDER_001.csv');
  assert.deepEqual(seen[0].metadata, {}, 'no consolidation ran, so it must not pretend one did');
});

test('an empty chain hands the context back unchanged', async () => {
  const registry = new ProcessingStageRegistry(coreOnly());
  const incoming = context();

  assert.deepEqual(await registry.run(incoming), incoming);
});

test('completed stages are reported by name', async () => {
  const registry = new ProcessingStageRegistry(allFeatures());
  registry.register(consolidation);
  registry.register(exportStage([]));

  const completed: string[] = [];
  await registry.run(context(), (stage) => completed.push(stage));

  assert.deepEqual(completed, ['consolidation', 'file-export']);
});

test('a failing stage stops the chain and names itself', async () => {
  const registry = new ProcessingStageRegistry(allFeatures());
  const seen: FileProcessingContext[] = [];
  registry.register({
    name: 'consolidation',
    requiredFeature: 'STEP_2_CONSOLIDATION',
    process: async () => {
      throw new Error('column "amount" is missing');
    },
  });
  registry.register(exportStage(seen));

  await assert.rejects(
    () => registry.run(context()),
    (error: unknown) => {
      assert.ok(error instanceof ProcessingStageError);
      assert.equal(error.stage, 'consolidation');
      assert.match(error.message, /column "amount" is missing/);
      return true;
    }
  );

  assert.equal(seen.length, 0, 'the export must not run on an input that was never produced');
});

test('a stage that rewrites the file must supply the new hash', async () => {
  const registry = new ProcessingStageRegistry(allFeatures());
  registry.register({
    name: 'consolidation',
    requiredFeature: 'STEP_2_CONSOLIDATION',
    // Writes a new file but leaves the checksum of the old one in place.
    process: async (incoming) =>
      advanceContext(incoming, { currentFilePath: 'D:/Incoming/ORDER_001.consolidated.csv' }),
  });

  await assert.rejects(
    () => registry.run(context()),
    (error: unknown) => {
      assert.ok(error instanceof ProcessingStageError);
      assert.match(error.message, /kept the previous SHA-256/);
      return true;
    }
  );
});

test('encrypting keeps the checksum, because only the representation changed', async () => {
  const registry = new ProcessingStageRegistry(allFeatures());
  registry.register({
    name: 'encrypt-result',
    requiredFeature: 'ENCRYPTION',
    process: async (incoming) =>
      advanceContext(incoming, {
        currentFilePath: 'D:/Incoming/ORDER_001.csv.enc',
        currentFilename: 'ORDER_001.csv.enc',
        encrypted: true,
      }),
  });

  const result = await registry.run(context());

  // The checksum identifies the content, and the content is the same one.
  assert.equal(result.sha256, 'a'.repeat(64));
  assert.equal(result.encrypted, true);
});

test('rewriting the file with a new hash is accepted', async () => {
  const registry = new ProcessingStageRegistry(allFeatures());
  registry.register({
    name: 'consolidation',
    requiredFeature: 'STEP_2_CONSOLIDATION',
    process: async (incoming) =>
      advanceContext(incoming, {
        currentFilePath: 'D:/Incoming/ORDER_001.consolidated.csv',
        currentFilename: 'ORDER_001.consolidated.csv',
        sha256: 'b'.repeat(64),
        fileSize: 18,
      }),
  });

  const result = await registry.run(context());

  assert.equal(result.currentFilename, 'ORDER_001.consolidated.csv');
  assert.equal(result.sha256, 'b'.repeat(64));
  // The origin stays visible, whatever the later stages do to the file.
  assert.equal(result.originalFilename, 'ORDER_001.csv');
});

test('advanceContext keeps untouched fields and merges metadata', () => {
  const before = context({ metadata: { recordsRead: 2 } });
  const after = advanceContext(before, { metadata: { exportedTo: 'x.xlsx' } });

  assert.equal(after.currentFilePath, before.currentFilePath);
  assert.equal(after.sha256, before.sha256);
  assert.deepEqual(after.metadata, { recordsRead: 2, exportedTo: 'x.xlsx' });
  assert.deepEqual(before.metadata, { recordsRead: 2 }, 'the previous context must stay as it was');
});
