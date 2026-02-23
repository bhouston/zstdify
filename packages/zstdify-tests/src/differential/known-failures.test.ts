import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';
import {
  requireZstdCli,
  zstdCompress,
  zstdCompressWithDictionary,
  zstdDecompress,
  zstdDecompressWithDictionary,
} from '../helpers/zstdCli.js';

function makeProblemPayload(size: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = 1 >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const randomByte = x & 0xff;
    data[i] = i % 64 < 48 ? 65 + (i % 5) : randomByte;
  }
  return data;
}

describe('differential known failures: zstd -> zstdify', () => {
  requireZstdCli();
  const input = makeProblemPayload(123_912);

  it('decodes a valid zstd stream at level -1', async () => {
    const encoded = await zstdCompress(input, ['-1', '--no-check']);
    // Sanity check: stream itself is valid and decodes with reference zstd.
    expect(await zstdDecompress(encoded)).toEqual(input);
    expect(decompress(encoded)).toEqual(input);
  });

  it('decodes a valid zstd stream at level -9', async () => {
    const encoded = await zstdCompress(input, ['-9', '--no-check']);
    // Sanity check: stream itself is valid and decodes with reference zstd.
    expect(await zstdDecompress(encoded)).toEqual(input);
    expect(decompress(encoded)).toEqual(input);
  });

  it('decodes a dictionary-compressed zstd stream with a raw-content dictionary', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-test-'));
    try {
      const dictPath = join(tempRoot, 'test.dict');
      const dictionaryText =
        'alpha beta gamma delta vertex normal index texture repeated corpus tokens compressor dictionary training ';
      const dictionaryBytes = new TextEncoder().encode(dictionaryText);
      writeFileSync(dictPath, dictionaryText);

      const payload = new TextEncoder().encode('vertex normal index');
      const encoded = await zstdCompressWithDictionary(payload, dictPath);
      expect(await zstdDecompressWithDictionary(encoded, dictPath)).toEqual(payload);
      expect(decompress(encoded, { dictionary: dictionaryBytes })).toEqual(payload);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
