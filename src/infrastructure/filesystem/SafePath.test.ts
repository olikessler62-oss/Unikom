import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertSafeFilename, isSafeFilename, resolveWithin, UnsafeFilenameError } from './SafePath.js';

test('ordinary filenames are accepted', () => {
  for (const name of ['ORDER_001.csv', 'order-2026-08-13.xlsx', 'Rechnung Nr. 5.pdf']) {
    assert.equal(assertSafeFilename(name), name);
  }
});

test('path traversal attempts are rejected', () => {
  for (const name of ['../../Windows/System32/example', '..', '../ORDER_001.csv', 'sub/ORDER_001.csv']) {
    assert.equal(isSafeFilename(name), false, `${name} must be rejected`);
  }
});

test('backslash separators are rejected as well', () => {
  assert.equal(isSafeFilename('..\\..\\Windows\\System32\\example'), false);
  assert.equal(isSafeFilename('sub\\ORDER_001.csv'), false);
});

test('absolute paths and drive letters are rejected', () => {
  assert.equal(isSafeFilename('/etc/passwd'), false);
  assert.equal(isSafeFilename('C:\\Windows\\System32\\example'), false);
});

test('empty names and null bytes are rejected', () => {
  assert.equal(isSafeFilename(''), false);
  assert.equal(isSafeFilename('ORDER_001.csv\0.txt'), false);
});

test('operating system reserved names are rejected', () => {
  for (const name of ['CON', 'nul.txt', 'COM1.csv', 'LPT9']) {
    assert.equal(isSafeFilename(name), false, `${name} must be rejected`);
  }
});

test('a safe filename resolves inside the base directory', () => {
  const base = path.resolve('D:', 'Data', 'Incoming', 'CustomerA');
  const resolved = resolveWithin(base, 'ORDER_001.csv');

  assert.equal(resolved, path.join(base, 'ORDER_001.csv'));
});

test('resolving refuses to leave the base directory', () => {
  const base = path.resolve('D:', 'Data', 'Incoming', 'CustomerA');

  assert.throws(() => resolveWithin(base, '../../Windows/System32/example'), UnsafeFilenameError);
});
