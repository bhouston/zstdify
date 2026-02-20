import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';
import { hasZstdCli, zstdCompress, zstdDecompress } from '../helpers/zstdCli.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const hasZstd = hasZstdCli();
const describeIfZstd = hasZstd ? describe : describe.skip;

function makeProblemPayload(size: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = 1 >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const randomByte = x & 0xff;
    data[i] = (i % 64) < 48 ? 65 + (i % 5) : randomByte;
  }
  return data;
}

describeIfZstd('differential known failures: zstd -> zstdify', () => {
  const input = makeProblemPayload(123_912);

  it('decodes a valid zstd stream at level -1', () => {
    const encoded = zstdCompress(input, ['-1', '--no-check']);
    // Sanity check: stream itself is valid and decodes with reference zstd.
    expect(zstdDecompress(encoded)).toEqual(input);
    expect(decompress(encoded)).toEqual(input);
  });

  it('decodes a valid zstd stream at level -9', () => {
    const encoded = zstdCompress(input, ['-9', '--no-check']);
    // Sanity check: stream itself is valid and decodes with reference zstd.
    expect(zstdDecompress(encoded)).toEqual(input);
    expect(decompress(encoded)).toEqual(input);
  });

  it('decodes a dictionary-compressed zstd stream with a raw-content dictionary', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-test-'));
    try {
      const dictPath = join(tempRoot, 'test.dict');
      const dictionaryText =
        'alpha beta gamma delta vertex normal index texture repeated corpus tokens compressor dictionary training ';
      const dictionaryBytes = new TextEncoder().encode(dictionaryText);
      writeFileSync(dictPath, dictionaryText);

      const payload = new TextEncoder().encode(
        'vertex vertex normal index alpha beta gamma dictionary compatibility test',
      );
      const encodedWithDict = spawnSync('zstd', ['-q', '-c', '-D', dictPath, '--no-check'], {
        input: Buffer.from(payload),
        encoding: null,
      });
      if (encodedWithDict.status !== 0) {
        throw new Error(`zstd dictionary compress failed: ${encodedWithDict.stderr?.toString() ?? 'unknown error'}`);
      }

      const encoded = new Uint8Array(encodedWithDict.stdout);
      const decodedWithDict = spawnSync('zstd', ['-q', '-d', '-c', '-D', dictPath], {
        input: Buffer.from(encoded),
        encoding: null,
      });
      if (decodedWithDict.status !== 0) {
        throw new Error(
          `zstd dictionary decompress failed: ${decodedWithDict.stderr?.toString() ?? 'unknown error'}`,
        );
      }

      expect(new Uint8Array(decodedWithDict.stdout)).toEqual(payload);
      expect(decompress(encoded, { dictionary: dictionaryBytes })).toEqual(payload);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
