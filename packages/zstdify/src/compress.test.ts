import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compress } from './compress.js';
import { parseBlockHeader } from './decode/block.js';
import { decompress } from './decompress.js';
import { parseZstdFrame } from './frame/frameHeader.js';

function firstBlockType(frame: Uint8Array): number {
  const { header } = parseZstdFrame(frame, 0);
  const blockOffset = 4 + header.headerSize;
  return parseBlockHeader(frame, blockOffset).blockType;
}

function allBlockTypes(frame: Uint8Array): number[] {
  const { header } = parseZstdFrame(frame, 0);
  let pos = 4 + header.headerSize;
  const out: number[] = [];
  while (pos + 3 <= frame.length) {
    const parsed = parseBlockHeader(frame, pos);
    out.push(parsed.blockType);
    pos += 3 + parsed.blockSize;
    if (parsed.lastBlock) break;
  }
  return out;
}

function hasZstdCli(): boolean {
  const result = spawnSync('zstd', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function requireZstdCli(): void {
  if (!hasZstdCli()) {
    throw new Error(
      'zstd CLI is required for formatted dictionary compression tests. Please install zstd and ensure it is available on PATH.',
    );
  }
}

function trainDictionaryBytes(sampleTexts: string[], maxDictSize = 2048): Uint8Array {
  requireZstdCli();
  const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-compress-dict-'));
  try {
    const dictPath = join(tempRoot, 'trained.dict');
    const expandedSamples: string[] = [];
    for (let i = 0; i < 96; i++) {
      const base = sampleTexts[i % sampleTexts.length] ?? 'dictionary training sample';
      const repeated = `${base} ${base} ${base} ${base}`;
      expandedSamples.push(`${repeated} marker=${i} variant=${i % 13}`);
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

describe('compress branch behavior', () => {
  it('uses raw block path at level=0', () => {
    const input = new Uint8Array(4096);
    input.fill(0x61);
    const encoded = compress(input, { level: 0 });
    expect(firstBlockType(encoded)).toBe(0);
  });

  it('uses RLE for repeated bytes and raw for non-repeated bytes at level=1', () => {
    const repeated = new Uint8Array(2048);
    repeated.fill(0x7a);
    const repeatedEncoded = compress(repeated, { level: 1 });
    expect(firstBlockType(repeatedEncoded)).toBe(1);

    const mixed = new Uint8Array(2048);
    for (let i = 0; i < mixed.length; i++) mixed[i] = i & 0xff;
    const mixedEncoded = compress(mixed, { level: 1 });
    expect(firstBlockType(mixedEncoded)).toBe(0);
  });

  it('at level>1 chooses compressed block when smaller and falls back when not smaller', () => {
    const repeatedPattern = new TextEncoder().encode('abcabcabcabcabcabcabcabcabcabc'.repeat(256));
    const compressedChoice = compress(repeatedPattern, { level: 3 });
    expect(firstBlockType(compressedChoice)).toBe(2);

    const noMatches = new Uint8Array(64);
    for (let i = 0; i < noMatches.length; i++) noMatches[i] = i;
    const fallbackChoice = compress(noMatches, { level: 3 });
    expect(firstBlockType(fallbackChoice)).toBe(0);
  });

  it('uses cross-block history matching at higher levels', () => {
    const blockA = new Uint8Array(128 * 1024);
    let state = 0x12345678;
    for (let i = 0; i < blockA.length; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      blockA[i] = state & 0xff;
    }
    const input = new Uint8Array(blockA.length * 2);
    input.set(blockA, 0);
    input.set(blockA, blockA.length);

    const encoded = compress(input, { level: 8 });
    const blockTypes = allBlockTypes(encoded);
    expect(blockTypes.length).toBe(2);
    expect(blockTypes[1]).toBe(2);
  });

  it('uses raw-content dictionary as initial history and strictly reduces size', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < input.length; i++) {
      input[i] = i;
    }
    const dictionary = input.slice();
    const withoutDictionary = compress(input, { level: 3 });
    const withDictionary = compress(input, { level: 3, dictionary, noDictId: true });
    expect(firstBlockType(withoutDictionary)).toBe(0);
    expect(firstBlockType(withDictionary)).toBe(2);
    expect(withDictionary.length).toBeLessThan(withoutDictionary.length);
  });

  it('uses formatted zstd dictionary history/rep offsets and strictly reduces size', () => {
    const dictionary = trainDictionaryBytes([
      'GET /api/users?page=1 host=example.com status=200 content-type=application/json',
      'GET /api/users?page=2 host=example.com status=200 content-type=application/json',
      'GET /api/users?page=3 host=example.com status=200 content-type=application/json',
      'POST /api/login host=example.com status=200 content-type=application/json',
      'GET /assets/app.js host=cdn.example.com status=200 content-type=application/javascript',
      'GET /api/users?page=4 host=example.com status=200 content-type=application/json',
    ]);
    const input = new TextEncoder().encode(
      Array.from(
        { length: 128 },
        (_, i) =>
          `GET /api/users?page=${(i % 8) + 1} host=example.com status=200 content-type=application/json request-id=${1000 + i}`,
      ).join('\n'),
    );
    const withoutDictionary = compress(input, { level: 3 });
    const withDictionary = compress(input, { level: 3, dictionary });
    const { header } = parseZstdFrame(withDictionary, 0);
    const parsedDictId =
      (dictionary[4] ?? 0) | ((dictionary[5] ?? 0) << 8) | ((dictionary[6] ?? 0) << 16) | ((dictionary[7] ?? 0) << 24);
    expect(header.dictionaryId).toBe(parsedDictId >>> 0);
    expect(withDictionary.length).toBeLessThan(withoutDictionary.length);
    expect(decompress(withDictionary, { dictionary })).toEqual(input);
  });
});
