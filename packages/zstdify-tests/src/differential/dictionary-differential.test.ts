import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';
import { hasZstdCli } from '../helpers/zstdCli.js';

const hasZstd = hasZstdCli();
const describeIfZstd = hasZstd ? describe : describe.skip;

function zstdCompressWithDict(input: Uint8Array, dictPath: string): Uint8Array {
  const result = spawnSync('zstd', ['-q', '-c', '-D', dictPath, '--no-check'], {
    input: Buffer.from(input),
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(`zstd dictionary compress failed: ${result.stderr?.toString() ?? 'unknown error'}`);
  }
  return new Uint8Array(result.stdout);
}

function zstdDecompressWithDict(input: Uint8Array, dictPath: string): Uint8Array {
  const result = spawnSync('zstd', ['-q', '-d', '-c', '-D', dictPath], {
    input: Buffer.from(input),
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(`zstd dictionary decompress failed: ${result.stderr?.toString() ?? 'unknown error'}`);
  }
  return new Uint8Array(result.stdout);
}

describeIfZstd('differential dictionaries: zstd -> zstdify', () => {
  it('round-trips raw-content dictionary streams across a small payload matrix', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
    try {
      const dictPath = join(tempRoot, 'raw-content.dict');
      const dictionaryText =
        'alpha beta gamma delta vertex normal index texture repeated corpus tokens compressor dictionary training ';
      const dictionaryBytes = new TextEncoder().encode(dictionaryText);
      writeFileSync(dictPath, dictionaryText);

      const payloads = ['vertex normal index', 'alpha beta gamma', 'short', 'header vertex texture'];

      for (const text of payloads) {
        const payload = new TextEncoder().encode(text);
        const encoded = zstdCompressWithDict(payload, dictPath);
        expect(zstdDecompressWithDict(encoded, dictPath)).toEqual(payload);
        expect(decompress(encoded, { dictionary: dictionaryBytes })).toEqual(payload);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects dictionary-compressed frames when no dictionary is provided', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
    try {
      const dictPath = join(tempRoot, 'raw-content.dict');
      writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = new TextEncoder().encode('alpha beta gamma');
      const encoded = zstdCompressWithDict(payload, dictPath);
      expect(() => decompress(encoded)).toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('trained dictionaries with entropy/repeat-offset modes', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
    try {
      const dictPath = join(tempRoot, 'trained.dict');
      const sampleTexts = [
        'alpha alpha alpha beta beta gamma gamma delta delta epsilon epsilon zeta zeta',
        'header vertex texture vertex normal normal index index tangent bitangent',
        'compressor dictionary training corpus repeated tokens phrase phrase phrase',
        'mesh primitive material shader pipeline render scene graph transform',
        'packet stream frame header footer checksum block entropy symbols',
        'typescript package monorepo workspace pnpm vitest biome lint check',
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
      const payload = new TextEncoder().encode('offset match literal sequence table');
      const encoded = zstdCompressWithDict(payload, dictPath);

      expect(zstdDecompressWithDict(encoded, dictPath)).toEqual(payload);
      expect(() => decompress(encoded)).toThrow();
      expect(decompress(encoded, { dictionary: dictionaryBytes })).toEqual(payload);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
