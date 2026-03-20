import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDictionary } from 'simple-zstd';
import { describe, expect, it } from 'vitest';
import { compress, decompress, generateDictionary } from 'zstdify';
import { requireZstdCli, zstdCompressWithDictionary, zstdDecompressWithDictionary } from '../helpers/zstdCli.js';

describe('differential dictionaries: zstd -> zstdify', () => {
  requireZstdCli();
  it('round-trips raw-content dictionary streams across a small payload matrix', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
    try {
      const dictPath = join(tempRoot, 'raw-content.dict');
      const dictionaryText =
        'alpha beta gamma delta vertex normal index texture repeated corpus tokens compressor dictionary training ';
      const dictionaryBytes = new TextEncoder().encode(dictionaryText);
      writeFileSync(dictPath, dictionaryText);

      const payloads = ['vertex normal index', 'alpha beta gamma', 'short', 'header vertex texture'];

      const checks = payloads.map(async (text) => {
        const payload = new TextEncoder().encode(text);
        const encoded = await zstdCompressWithDictionary(payload, dictPath);
        expect(await zstdDecompressWithDictionary(encoded, dictPath)).toEqual(payload);
        expect(decompress(encoded, { dictionary: dictionaryBytes })).toEqual(payload);
      });
      await Promise.all(checks);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects dictionary-compressed frames when no dictionary is provided', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
    try {
      const dictPath = join(tempRoot, 'raw-content.dict');
      writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = new TextEncoder().encode('alpha beta gamma');
      const encoded = await zstdCompressWithDictionary(payload, dictPath);
      expect(() => decompress(encoded)).toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('trained dictionaries with entropy/repeat-offset modes', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
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
      const dictBuffer = await createDictionary({
        trainingFiles: sampleTexts.map((t) => Buffer.from(t, 'utf8')),
        maxDictSize: 2048,
      });
      const dictionaryBytes = new Uint8Array(dictBuffer);
      writeFileSync(dictPath, dictBuffer);
      const payload = new TextEncoder().encode('offset match literal sequence table');
      const encoded = await zstdCompressWithDictionary(payload, dictPath);

      expect(await zstdDecompressWithDictionary(encoded, dictPath)).toEqual(payload);
      expect(() => decompress(encoded)).toThrow();
      expect(decompress(encoded, { dictionary: dictionaryBytes })).toEqual(payload);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('zstd interoperates with zstdify-generated raw dictionaries', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-diff-'));
    try {
      const dictPath = join(tempRoot, 'generated.dict');
      const sampleTexts = [
        'alpha beta gamma delta epsilon',
        'header vertex texture vertex normal normal index index tangent bitangent',
        'offset match literal sequence table repeat mode huffman fse decode',
      ];
      const samples = sampleTexts.map((text) => new TextEncoder().encode(text));
      const dictionaryBytes = generateDictionary(samples, {
        maxDictSize: 2048,
        algorithm: 'fastcover',
      });
      writeFileSync(dictPath, Buffer.from(dictionaryBytes));

      const payload = new TextEncoder().encode('header vertex texture offset match literal sequence table');
      const encodedByZstd = await zstdCompressWithDictionary(payload, dictPath);
      expect(decompress(encodedByZstd, { dictionary: dictionaryBytes })).toEqual(payload);

      const encodedByZstdify = compress(payload, { dictionary: dictionaryBytes, noDictId: true });
      expect(await zstdDecompressWithDictionary(encodedByZstdify, dictPath)).toEqual(payload);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
