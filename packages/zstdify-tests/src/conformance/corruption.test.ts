import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures');

function readFixture(name: string): Uint8Array {
  const fixturePath = path.join(fixturesDir, name);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture ${name}.`);
  }
  return new Uint8Array(fs.readFileSync(fixturePath));
}

describe('zstd corruption handling', () => {
  it('rejects truncated compressed frame', () => {
    const level1 = readFixture('level1.zst');
    const truncated = level1.subarray(0, level1.length - 1);
    expect(() => decompress(truncated)).toThrow();
  });

  it('rejects checksum mismatch in checked frame', () => {
    const checked = readFixture('level1-check.zst').slice();
    checked[checked.length - 1] ^= 0x01;
    expect(() => decompress(checked)).toThrowError(/checksum/i);
  });
});
