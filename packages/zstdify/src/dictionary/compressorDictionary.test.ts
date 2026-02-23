import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveDictionaryContextForCompression,
  resolveDictionaryHistoryForCompression,
  resolveDictionaryIdForCompression,
  resolveDictionaryRepOffsetsForCompression,
} from './compressorDictionary.js';

function hasZstdCli(): boolean {
  const result = spawnSync('zstd', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function requireZstdCli(): void {
  if (!hasZstdCli()) {
    throw new Error(
      'zstd CLI is required for compressor dictionary parser tests. Please install zstd and ensure it is available on PATH.',
    );
  }
}

function trainDictionaryBytes(sampleTexts: string[], maxDictSize = 2048): Uint8Array {
  requireZstdCli();
  const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-compressor-dict-'));
  try {
    const dictPath = join(tempRoot, 'trained.dict');
    const expandedSamples: string[] = [];
    for (let i = 0; i < 96; i++) {
      const base = sampleTexts[i % sampleTexts.length] ?? 'dictionary training sample';
      const repeated = `${base} ${base} ${base} ${base}`;
      expandedSamples.push(`${repeated} marker=${i} variant=${i % 11}`);
    }
    const samplePaths = expandedSamples.map((_, index) => join(tempRoot, `sample-${index}.txt`));
    for (const [index, samplePath] of samplePaths.entries()) {
      const sampleText = expandedSamples[index];
      if (sampleText === undefined) {
        throw new Error('Sample text missing');
      }
      writeFileSync(samplePath, sampleText);
    }
    const train = spawnSync('zstd', ['--train', ...samplePaths, `--maxdict=${maxDictSize}`, '-o', dictPath, '--quiet'], {
      encoding: null,
    });
    if (train.status !== 0) {
      throw new Error(`zstd dictionary training failed: ${train.stderr?.toString() ?? 'unknown error'}`);
    }
    return new Uint8Array(readFileSync(dictPath));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('resolveDictionaryIdForCompression', () => {
  it('returns provided id for raw-content dictionary', () => {
    const dictionaryBytes = new TextEncoder().encode('alpha beta gamma dictionary content');
    expect(resolveDictionaryIdForCompression(dictionaryBytes, 42)).toBe(42);
  });

  it('returns parsed id for trained zstd dictionaries', () => {
    const dictionaryBytes = trainDictionaryBytes([
      'alpha beta gamma delta epsilon zeta',
      'header vertex texture normal index tangent',
      'offset match literal sequence table repeat',
    ]);
    const parsedId = resolveDictionaryIdForCompression(dictionaryBytes);
    expect(parsedId).toBeGreaterThan(0);
  });
});

describe('resolveDictionaryHistoryForCompression', () => {
  it('returns raw-content dictionary bytes for history matching', () => {
    const dictionaryBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(resolveDictionaryHistoryForCompression(dictionaryBytes)).toEqual(dictionaryBytes);
  });

  it('returns parsed history for zstd-formatted dictionaries', () => {
    const dictionaryBytes = trainDictionaryBytes([
      'login request user id status code headers accept language',
      'login response user id status code headers set cookie',
      'api request users page include profile expand preferences',
      'api response users page include profile expand preferences',
    ]);
    const history = resolveDictionaryHistoryForCompression(dictionaryBytes);
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('resolveDictionaryContextForCompression', () => {
  it('uses default rep offsets for raw dictionaries', () => {
    const dictionaryBytes = new TextEncoder().encode('raw dictionary bytes');
    const context = resolveDictionaryContextForCompression(dictionaryBytes);
    expect(context.dictionaryId).toBe(null);
    expect(context.historyPrefix).toEqual(dictionaryBytes);
    expect(context.repOffsets).toEqual([1, 4, 8]);
  });

  it('parses formatted dictionaries including rep offsets', () => {
    const dictionaryBytes = trainDictionaryBytes([
      'order create update delete query list response status code',
      'order id customer id item id quantity subtotal tax total',
      'inventory reserve release adjust stock count movement log',
      'order create update delete query list response status code order id',
    ]);
    const context = resolveDictionaryContextForCompression(dictionaryBytes);
    expect(context.dictionaryId).toBeGreaterThan(0);
    expect(context.historyPrefix.length).toBeGreaterThan(0);
    expect(context.repOffsets[0]).toBeGreaterThan(0);
    expect(context.repOffsets[1]).toBeGreaterThan(0);
    expect(context.repOffsets[2]).toBeGreaterThan(0);
    expect(resolveDictionaryRepOffsetsForCompression(dictionaryBytes)).toEqual(context.repOffsets);
  });
});
