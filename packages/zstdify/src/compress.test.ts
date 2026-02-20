import { describe, expect, it } from 'vitest';
import { compress } from './compress.js';
import { parseBlockHeader } from './decode/block.js';
import { parseZstdFrame } from './frame/frameHeader.js';

function firstBlockType(frame: Uint8Array): number {
  const { header } = parseZstdFrame(frame, 0);
  const blockOffset = 4 + header.headerSize;
  return parseBlockHeader(frame, blockOffset).blockType;
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
});
