import { describe, expect, it } from 'vitest';
import { compress } from './compress.js';
import { parseBlockHeader } from './decode/block.js';
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
});
