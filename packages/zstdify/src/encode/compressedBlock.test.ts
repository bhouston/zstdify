import { describe, expect, it, vi } from 'vitest';
import { compress } from '../compress.js';
import { parseLiteralsSectionHeader } from '../decode/literals.js';
import { decodeSequences } from '../decode/sequences.js';
import * as fse from '../entropy/fse.js';
import { decompress } from '../decompress.js';
import { parseFrameHeader } from '../frame/frameHeader.js';
import { __benchInternals, buildCompressedBlockPayload, type SequenceEntropyContext, writeCompressedBlock } from './compressedBlock.js';
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

  it('surfaces sequence entropy table build failures instead of swallowing them', () => {
    const injected = new Error('injected normalize failure');
    const spy = vi.spyOn(fse, 'normalizeCountsForTable').mockImplementation(() => {
      throw injected;
    });
    const literals = new Uint8Array(512);
    const sequences = new Array(80).fill(0).map((_, i) => ({
      literalsLength: i % 5 === 0 ? 3 : 0,
      offset: i % 7 === 0 ? 32 : 1,
      matchLength: i % 4 === 0 ? 9 : 3,
    }));

    try {
      expect(() => buildCompressedBlockPayload(literals, sequences)).toThrow(/injected normalize failure/);
    } finally {
      spy.mockRestore();
    }
  });

  it('round-trips sequence tuples for json-event-like payload', () => {
    const input = new TextEncoder().encode(
      Array.from(
        { length: 240 },
        (_, i) =>
          `{"event":"view","screen":"home","user":"u-${100 + (i % 30)}","platform":"ios","version":"1.2.0","exp":"A"}`,
      ).join('\n'),
    );
    const plan = buildGreedySequences(input, { strategy: 'fast' });
    const seqSection = __benchInternals.buildSequenceSection(plan.sequences)?.section;
    expect(seqSection).not.toBeNull();
    const decoded = decodeSequences(seqSection!, 0, seqSection!.length, null);
    expect(
      decoded.metadata.llMode === 2 || decoded.metadata.ofMode === 2 || decoded.metadata.mlMode === 2,
    ).toBe(true);
    expect(decoded.sequences.length).toBe(plan.sequences.length);
    let mismatchIndex = -1;
    let mismatchMessage = '';
    for (let i = 0; i < plan.sequences.length; i++) {
      const expected = plan.sequences[i]!;
      if (
        decoded.sequences.literalsLength[i] !== expected.literalsLength ||
        decoded.sequences.offset[i] !== expected.offset ||
        decoded.sequences.matchLength[i] !== expected.matchLength
      ) {
        mismatchIndex = i;
        mismatchMessage =
          `expected={ll:${expected.literalsLength},off:${expected.offset},ml:${expected.matchLength}} ` +
          `actual={ll:${decoded.sequences.literalsLength[i]},off:${decoded.sequences.offset[i]},ml:${decoded.sequences.matchLength[i]}}`;
        break;
      }
    }
    if (mismatchIndex !== -1) {
      throw new Error(
        `Sequence mismatch at index ${mismatchIndex}: ${mismatchMessage} ` +
          `modes={ll:${decoded.metadata.llMode},of:${decoded.metadata.ofMode},ml:${decoded.metadata.mlMode}} ` +
          `tableLogs={ll:${decoded.metadata.llTableLog},of:${decoded.metadata.ofTableLog},ml:${decoded.metadata.mlTableLog}}`,
      );
    }
    expect(mismatchIndex).toBe(-1);
  });

  it('round-trips sequence tuples for code-token-like payload', () => {
    const input = new TextEncoder().encode(
      Array.from(
        { length: 220 },
        (_, i) =>
          `const token${i} = parseToken("identifier:node:zstd:${i % 7}"); if (token${i}[0] === "identifier") emitSymbol(token${i}[1]);`,
      ).join('\n'),
    );
    const plan = buildGreedySequences(input, { strategy: 'fast' });
    const seqSection = __benchInternals.buildSequenceSection(plan.sequences)?.section;
    expect(seqSection).not.toBeNull();
    const decoded = decodeSequences(seqSection!, 0, seqSection!.length, null);
    expect(decoded.sequences.length).toBe(plan.sequences.length);
    for (let i = 0; i < plan.sequences.length; i++) {
      const expected = plan.sequences[i]!;
      expect(decoded.sequences.literalsLength[i]).toBe(expected.literalsLength);
      expect(decoded.sequences.offset[i]).toBe(expected.offset);
      expect(decoded.sequences.matchLength[i]).toBe(expected.matchLength);
    }
  });
});
