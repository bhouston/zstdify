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

describe('zstd fixture conformance', () => {
  it('decompresses hello.zst from official zstd (no checksum)', () => {
    const fixturePath = path.join(fixturesDir, 'hello-no-check.zst');
    if (!fs.existsSync(fixturePath)) {
      console.warn(
        'Skipping: run "echo -n hello | zstd -c --no-check > packages/zstdify-tests/fixtures/hello-no-check.zst"',
      );
      return;
    }
    const compressed = new Uint8Array(fs.readFileSync(fixturePath));
    const result = decompress(compressed);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('decompresses level1.zst from official zstd (compressed block)', () => {
    const fixturePath = path.join(fixturesDir, 'level1.zst');
    if (!fs.existsSync(fixturePath)) {
      console.warn(
        'Skipping: run "echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -c --no-check -1 > packages/zstdify-tests/fixtures/level1.zst"',
      );
      return;
    }
    const compressed = new Uint8Array(fs.readFileSync(fixturePath));
    const result = decompress(compressed);
    const expected =
      'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world ';
    expect(new TextDecoder().decode(result)).toBe(expected);
  });
});
