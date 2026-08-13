import test from 'node:test';
import assert from 'node:assert/strict';
import { FileSelectionService } from './FileSelectionService.js';
import type { FileSelectionCriteria, SourceFile } from '../../domain/files/SourceFile.js';

const service = new FileSelectionService();
const now = new Date('2026-08-13T06:45:00.000Z');

function file(name: string, overrides: Partial<SourceFile> = {}): SourceFile {
  return {
    name,
    fullPath: `/export/orders/${name}`,
    size: 1024,
    lastModified: new Date(now.getTime() - 90_000),
    isDirectory: false,
    ...overrides,
  };
}

function criteria(overrides: Partial<FileSelectionCriteria> = {}): FileSelectionCriteria {
  return {
    filenamePrefix: 'ORDER_',
    allowedExtensions: ['.csv'],
    caseSensitivePrefix: false,
    includeSubdirectories: false,
    minimumFileAgeSeconds: 60,
    requireStableFile: false,
    ignoredTemporaryExtensions: ['.part', '.tmp', '.temp'],
    ...overrides,
  };
}

test('prefix comparison ignores case by default', () => {
  assert.equal(service.matches(file('Order_001.csv'), criteria(), now), true);
  assert.equal(service.matches(file('order_001.csv'), criteria(), now), true);
});

test('prefix comparison can be case sensitive', () => {
  const strict = criteria({ caseSensitivePrefix: true });
  assert.equal(service.matches(file('ORDER_001.csv'), strict, now), true);
  assert.equal(service.matches(file('order_001.csv'), strict, now), false);
});

test('prefix must appear at the start of the filename', () => {
  for (const name of ['INVOICE_ORDER_001.csv', 'TEST_ORDER_001.csv', 'MYORDER_001.csv']) {
    const result = service.evaluate(file(name), criteria(), now);
    assert.equal(result.selected, false, `${name} must not be selected`);
    assert.equal(result.reason, 'PREFIX_MISMATCH');
  }
});

test('several extensions can be allowed at once', () => {
  const multi = criteria({ allowedExtensions: ['.csv', 'xlsx', '.xml'] });
  assert.equal(service.matches(file('ORDER_001.csv'), multi, now), true);
  assert.equal(service.matches(file('ORDER_002.xlsx'), multi, now), true);
  assert.equal(service.matches(file('ORDER_003.xml'), multi, now), true);
  assert.equal(service.evaluate(file('ORDER_004.pdf'), multi, now).reason, 'EXTENSION_MISMATCH');
});

test('files below the minimum age are rejected', () => {
  const tooYoung = file('ORDER_001.csv', { lastModified: new Date(now.getTime() - 12_000) });
  const result = service.evaluate(tooYoung, criteria(), now);

  assert.equal(result.selected, false);
  assert.equal(result.reason, 'TOO_YOUNG');
});

test('files at or above the minimum age are accepted', () => {
  const exactlyOldEnough = file('ORDER_001.csv', { lastModified: new Date(now.getTime() - 60_000) });
  assert.equal(service.matches(exactlyOldEnough, criteria(), now), true);
});

test('a missing timestamp cannot satisfy a minimum age requirement', () => {
  const withoutTimestamp = file('ORDER_001.csv', { lastModified: undefined });

  assert.equal(service.evaluate(withoutTimestamp, criteria(), now).reason, 'AGE_UNKNOWN');
  assert.equal(service.matches(withoutTimestamp, criteria({ minimumFileAgeSeconds: 0 }), now), true);
});

test('temporary upload files are never picked up', () => {
  for (const name of ['ORDER_001.csv.part', 'ORDER_001.csv.tmp', 'ORDER_001.temp']) {
    const result = service.evaluate(file(name), criteria(), now);
    assert.equal(result.selected, false, `${name} must not be selected`);
    assert.equal(result.reason, 'TEMPORARY_EXTENSION');
  }

  // Section 38: once the upload is renamed to its final name it is picked up.
  assert.equal(service.matches(file('ORDER_001.csv'), criteria(), now), true);
});

test('directories are never selected', () => {
  const directory = file('ORDER_ARCHIVE', { isDirectory: true });
  assert.equal(service.evaluate(directory, criteria(), now).reason, 'DIRECTORY');
});

test('all active filters are combined with AND', () => {
  const directory = ['ORDER_001.csv', 'ORDER_002.csv', 'ORDER_003.xlsx', 'INVOICE_001.csv', 'TEST_ORDER_004.csv'];
  const selected = directory.filter((name) => service.matches(file(name), criteria(), now));

  assert.deepEqual(selected, ['ORDER_001.csv', 'ORDER_002.csv']);
});
