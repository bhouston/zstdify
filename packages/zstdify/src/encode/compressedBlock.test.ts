import { describe, expect, it } from 'vitest';
import { decompress } from '../decompress.js';
import { parseFrameHeader } from '../frame/frameHeader.js';
import { parseLiteralsSectionHeader } from '../decode/literals.js';
import { buildGreedySequences } from './greedySequences.js';
import { buildCompressedBlockPayload, writeCompressedBlock } from './compressedBlock.js';
import { compress } from '../compress.js';

describe('compressed block encoder', () => {
  it('builds decodable compressed-block payload for single-sequence case', () => {
    const input = new TextEncoder().encode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const plan = buildGreedySequences(input);
    expect(plan.sequences.length).toBeGreaterThan(0);
    const payload = buildCompressedBlockPayload(plan.literals, plan.sequences);
    expect(payload).not.toBeNull();
    const frameHeader = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x20, input.length & 0xff]);
    const block = writeCompressedBlock(payload!, true);
    const frame = new Uint8Array(frameHeader.length + block.length);
    frame.set(frameHeader, 0);
    frame.set(block, frameHeader.length);
    expect(decompress(frame)).toEqual(input);
  });

  it('compress(level=3) emits compressed block when beneficial', () => {
    const input = new TextEncoder().encode('abcdabcdabcdabcdabcdabcdabcdabcd');
    const encoded = compress(input, { level: 3 });
    const header = parseFrameHeader(encoded, 4);
    const blockHeaderOffset = 4 + header.headerSize;
    const blockType = ((encoded[blockHeaderOffset] ?? 0) >> 1) & 0x3;
    expect(blockType).toBe(2);
    expect(decompress(encoded)).toEqual(input);
  });

  it('encodes multi-sequence section using non-RLE modes', () => {
    const input = new TextEncoder().encode('abcdabcdXabcdabcdYabcdabcdZabcdabcd');
    const plan = buildGreedySequences(input);
    expect(plan.sequences.length).toBeGreaterThan(1);
    const payload = buildCompressedBlockPayload(plan.literals, plan.sequences);
    expect(payload).not.toBeNull();
    const { header } = parseLiteralsSectionHeader(payload!, 0);
    const litBytes = header.headerSize + (header.compressedSize ?? header.regeneratedSize);
    const numSeq = payload![litBytes] ?? 0;
    expect(numSeq).toBe(plan.sequences.length);
    const modes = payload![litBytes + 1] ?? 0xff;
    expect(modes).toBe(0); // predefined, i.e. non-RLE modes
    const frameHeader = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x20, input.length & 0xff]);
    const block = writeCompressedBlock(payload!, true);
    const frame = new Uint8Array(frameHeader.length + block.length);
    frame.set(frameHeader, 0);
    frame.set(block, frameHeader.length);
    expect(decompress(frame)).toEqual(input);
  });

  it('encodes multi-symbol compressed literals for bounded symbol sets', () => {
    const literals = new Uint8Array(40);
    for (let i = 0; i < literals.length; i++) {
      literals[i] = (i & 1) as 0 | 1;
    }
    const payload = buildCompressedBlockPayload(literals, [
      { literalsLength: literals.length, offset: 1, matchLength: 3 },
    ]);
    expect(payload).not.toBeNull();
    const { header } = parseLiteralsSectionHeader(payload!, 0);
    expect([0, 2]).toContain(header.blockType);
  });
});
