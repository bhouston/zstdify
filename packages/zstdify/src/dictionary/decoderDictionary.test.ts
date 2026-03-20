import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeDecoderDictionary } from './decoderDictionary.js';

function hasZstdCli(): boolean {
  const result = spawnSync('zstd', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function requireZstdCli(): void {
  if (!hasZstdCli()) {
    throw new Error(
      'zstd CLI is required for dictionary parser interop tests. Please install zstd and ensure it is available on PATH.',
    );
  }
}

describe('normalizeDecoderDictionary', () => {
  it('keeps raw-content dictionary bytes as history prefix', () => {
    const dictionaryBytes = new TextEncoder().encode('alpha beta gamma dictionary content');
    const parsed = normalizeDecoderDictionary(dictionaryBytes);
    expect(parsed.historyPrefix).toEqual(dictionaryBytes);
    expect(parsed.dictionaryId).toBe(null);
    expect(parsed.repOffsets).toEqual([1, 4, 8]);
    expect(parsed.huffmanTable).toBe(null);
    expect(parsed.sequenceTables).toBe(null);
  });

  it('rejects malformed trained dictionaries with truncated entropy tables', () => {
    const malformed = new Uint8Array([
      0x37,
      0xa4,
      0x30,
      0xec, // dictionary magic
      0x01,
      0x00,
      0x00,
      0x00, // dictionary id
      0x82, // direct-weight header: expects 3 nibbles => 2 bytes, but none provided
    ]);
    expect(() => normalizeDecoderDictionary(malformed)).toThrow();
  });

  it('parses trained dictionary metadata and content using zstd cli', () => {
    requireZstdCli();
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-parse-'));
    try {
      const dictPath = join(tempRoot, 'trained.dict');
      const sampleTexts = [
        'alpha alpha alpha beta beta gamma gamma delta delta epsilon epsilon zeta zeta',
        'header vertex texture vertex normal normal index index tangent bitangent',
        'compressor dictionary training corpus repeated tokens phrase phrase phrase',
        'mesh primitive material shader pipeline render scene graph transform',
        'packet stream frame header footer checksum block entropy symbols',
        'typescript package monorepo workspace pnpm vitest oxlint lint check',
        'offset match literal sequence table repeat mode huffman fse decode',
        'browser node runtime buffer array uint8array encoder decoder api',
      ];
      const samplePaths = sampleTexts.map((_, index) => join(tempRoot, `sample-${index}.txt`));
      for (const [index, samplePath] of samplePaths.entries()) {
        const sampleText = sampleTexts[index];
        if (sampleText === undefined) {
          throw new Error('Sample text missing');
        }
        writeFileSync(samplePath, sampleText);
      }

      const train = spawnSync('zstd', ['--train', ...samplePaths, '--maxdict=2048', '-o', dictPath, '--quiet'], {
        encoding: null,
      });
      if (train.status !== 0) {
        throw new Error(`zstd dictionary training failed: ${train.stderr?.toString() ?? 'unknown error'}`);
      }

      const dictionaryBytes = new Uint8Array(readFileSync(dictPath));
      const parsed = normalizeDecoderDictionary(dictionaryBytes);
      const dictIdFromHeader =
        (dictionaryBytes[4] ?? 0) |
        ((dictionaryBytes[5] ?? 0) << 8) |
        ((dictionaryBytes[6] ?? 0) << 16) |
        ((dictionaryBytes[7] ?? 0) << 24);

      expect(parsed.dictionaryId).toBe(dictIdFromHeader >>> 0);
      expect(parsed.historyPrefix.length).toBeGreaterThan(0);
      expect(parsed.repOffsets[0]).toBeGreaterThan(0);
      expect(parsed.repOffsets[1]).toBeGreaterThan(0);
      expect(parsed.repOffsets[2]).toBeGreaterThan(0);
      expect(parsed.repOffsets[0]).toBeLessThanOrEqual(parsed.historyPrefix.length);
      expect(parsed.repOffsets[1]).toBeLessThanOrEqual(parsed.historyPrefix.length);
      expect(parsed.repOffsets[2]).toBeLessThanOrEqual(parsed.historyPrefix.length);
      expect(parsed.huffmanTable).not.toBe(null);
      expect(parsed.sequenceTables).not.toBe(null);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
