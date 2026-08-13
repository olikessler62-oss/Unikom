import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileIntegrityService } from './FileIntegrityService.js';

const service = new FileIntegrityService();

test('file integrity service computes sha256 and validates size', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unikom-integrity-'));
  const filePath = path.join(tempDir, 'order_001.csv');
  const expectedContents = 'customer;amount\nA;42\n';

  await fs.writeFile(filePath, expectedContents);

  const result = await service.verifyFile(filePath, {
    expectedSize: Buffer.byteLength(expectedContents),
    expectedSha256: 'cdb41fb1e4eb71a15a95653d79c6a51160dfed9d9244dc86af407fa585f0222c',
  });

  assert.equal(result.ok, true);
  assert.ok(result.sha256);
  assert.equal(result.sha256?.length, 64);
});
