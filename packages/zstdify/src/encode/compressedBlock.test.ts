import { describe, expect, it } from 'vitest';
import { compress } from '../compress.js';
import { parseLiteralsSectionHeader } from '../decode/literals.js';
import { decompress } from '../decompress.js';
import { parseFrameHeader } from '../frame/frameHeader.js';
import { buildCompressedBlockPayload, type SequenceEntropyContext, writeCompressedBlock } from './compressedBlock.js';
import { buildGreedySequences } from './greedySequences.js';

function sequenceModesOffset(payload: Uint8Array, literalsSectionEnd: number): number {
  const first = payload[literalsSectionEnd] ?? 0;
  if (first < 128) return literalsSectionEnd + 1;
  if (first === 255) return literalsSectionEnd + 3;
  return literalsSectionEnd + 2;
}

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
    const modes = payload![sequenceModesOffset(payload!, litBytes)] ?? 0xff;
    expect((modes & 0x03) === 0).toBe(true); // reserved bits must stay zero
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

  it('encodes larger compressed literals using 4-stream headers', () => {
    const literals = new Uint8Array(5000);
    for (let i = 0; i < literals.length; i++) {
      literals[i] = (i & 1) as 0 | 1;
    }
    const payload = buildCompressedBlockPayload(literals, [
      { literalsLength: literals.length, offset: 1, matchLength: 3 },
    ]);
    expect(payload).not.toBeNull();
    const { header } = parseLiteralsSectionHeader(payload!, 0);
    expect(header.regeneratedSize).toBe(literals.length);
    expect(header.blockType).toBe(2);
    expect(header.numStreams).toBe(4);
  });

  it('reuses previous Huffman literals table with treeless mode when profitable', () => {
    const literals = new Uint8Array(2048);
    for (let i = 0; i < literals.length; i++) {
      literals[i] = (i & 1) as 0 | 1;
    }
    const sequences = [{ literalsLength: literals.length, offset: 1, matchLength: 3 }];
    const context: SequenceEntropyContext = { prevTables: null, prevLiteralsTable: null };
    const first = buildCompressedBlockPayload(literals, sequences, context);
    expect(first).not.toBeNull();
    const second = buildCompressedBlockPayload(literals, sequences, context);
    expect(second).not.toBeNull();
    const { header: firstHeader } = parseLiteralsSectionHeader(first!, 0);
    const { header: secondHeader } = parseLiteralsSectionHeader(second!, 0);
    expect(firstHeader.blockType).toBe(2);
    expect(secondHeader.blockType).toBe(3);
  });

  it('keeps sequence table context valid across consecutive payload builds', () => {
    const literals = new Uint8Array(64);
    const sequences = new Array(40).fill(0).map((_, i) => ({
      literalsLength: i % 5 === 0 ? 3 : 0,
      offset: i % 6 === 0 ? 32 : 1,
      matchLength: i % 4 === 0 ? 8 : 3,
    }));
    const context: SequenceEntropyContext = { prevTables: null };
    const first = buildCompressedBlockPayload(literals, sequences, context);
    expect(first).not.toBeNull();
    const second = buildCompressedBlockPayload(literals, sequences, context);
    expect(second).not.toBeNull();
    const { header } = parseLiteralsSectionHeader(second!, 0);
    const litBytes = header.headerSize + (header.compressedSize ?? header.regeneratedSize);
    const modes = second![sequenceModesOffset(second!, litBytes)] ?? 0;
    expect((modes & 0x03) === 0).toBe(true);
    expect(context.prevTables).not.toBeNull();
  });

  it('evaluates adaptive sequence table modes for skewed distributions', () => {
    const literals = new Uint8Array(512);
    const sequences = new Array(220).fill(0).map((_, i) => ({
      literalsLength: i % 31 === 0 ? 18 : 0,
      offset: i % 37 === 0 ? 64 : 1,
      matchLength: i % 29 === 0 ? 12 : 3,
    }));
    const payload = buildCompressedBlockPayload(literals, sequences);
    expect(payload).not.toBeNull();
    const { header } = parseLiteralsSectionHeader(payload!, 0);
    const litBytes = header.headerSize + (header.compressedSize ?? header.regeneratedSize);
    const modes = payload![sequenceModesOffset(payload!, litBytes)] ?? 0;
    expect((modes & 0x03) === 0).toBe(true);
    expect(((modes >> 6) & 0x3) !== 1 && ((modes >> 4) & 0x3) !== 1 && ((modes >> 2) & 0x3) !== 1).toBe(true);
  });
});
