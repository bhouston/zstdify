/**
 * Conformance test: decompress fixture produced by official zstd.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures');
const phrase =
  'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world ';

function readFixture(name: string): Uint8Array {
  const fixturePath = path.join(fixturesDir, name);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture ${name}. Regenerate with packages/zstdify-tests/fixtures/README.md commands.`);
  }
  return new Uint8Array(fs.readFileSync(fixturePath));
}

describe('zstd fixture conformance', () => {
  it('decompresses hello.zst from official zstd (no checksum)', () => {
    const compressed = readFixture('hello-no-check.zst');
    const result = decompress(compressed);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('decompresses level1.zst from official zstd (compressed block)', () => {
    const compressed = readFixture('level1.zst');
    const result = decompress(compressed);
    expect(new TextDecoder().decode(result)).toBe(phrase);
  });

  it('decompresses level3.zst from official zstd (compressed block)', () => {
    const compressed = readFixture('level3.zst');
    const result = decompress(compressed);
    expect(new TextDecoder().decode(result)).toBe(phrase);
  });

  it('decompresses level9.zst from official zstd (compressed block)', () => {
    const compressed = readFixture('level9.zst');
    const result = decompress(compressed);
    expect(new TextDecoder().decode(result)).toBe(phrase);
  });

  it('decompresses tiny level3 fixture (compressed block)', () => {
    const noCheck = readFixture('tiny-level3-no-check.zst');
    expect(new TextDecoder().decode(decompress(noCheck))).toBe('tiny-payload');
  });
});
