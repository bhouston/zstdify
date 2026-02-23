import { describe, expect, it } from 'vitest';
import { decodeCompressedLiterals, decodeTreelessLiterals, parseLiteralsSectionHeader } from '../decode/literals.js';
import { buildCompressedBlockPayload, type SequenceEntropyContext } from './compressedBlock.js';

function buildLiteralsSectionPayload(literals: Uint8Array, context?: SequenceEntropyContext): Uint8Array {
  const payload = buildCompressedBlockPayload(literals, [{ literalsLength: literals.length, offset: 1, matchLength: 3 }], context);
  if (!payload) {
    throw new Error('Failed to build compressed block payload');
  }
  return payload;
}

describe('literals section round-trip', () => {
  it('uses raw for tiny literals and compressed for larger literals', () => {
    const small = new Uint8Array(7);
    for (let i = 0; i < small.length; i++) {
      small[i] = (i & 1) as 0 | 1;
    }
    const large = new Uint8Array(80);
    for (let i = 0; i < large.length; i++) {
      large[i] = (i & 1) as 0 | 1;
    }

    const smallPayload = buildLiteralsSectionPayload(small);
    const smallParsed = parseLiteralsSectionHeader(smallPayload, 0);
    expect(smallParsed.header.blockType).toBe(0);
    expect(smallParsed.header.regeneratedSize).toBe(small.length);
    expect(smallPayload.subarray(smallParsed.dataOffset, smallParsed.dataOffset + small.length)).toEqual(small);

    const largePayload = buildLiteralsSectionPayload(large);
    const largeParsed = parseLiteralsSectionHeader(largePayload, 0);
    expect(largeParsed.header.blockType).toBe(2);
    const largeDecoded = decodeCompressedLiterals(
      largePayload,
      largeParsed.dataOffset,
      largeParsed.header.compressedSize!,
      largeParsed.header.regeneratedSize,
      largeParsed.header.numStreams,
    );
    expect(largeDecoded.literals).toEqual(large);
  });

  it('round-trips compressed literals section for large repetitive input', () => {
    const literals = new Uint8Array(5000);
    for (let i = 0; i < literals.length; i++) {
      literals[i] = (i & 1) as 0 | 1;
    }

    const payload = buildLiteralsSectionPayload(literals);
    const { header, dataOffset } = parseLiteralsSectionHeader(payload, 0);
    expect(header.blockType).toBe(2);
    expect(header.numStreams).toBe(4);

    const decoded = decodeCompressedLiterals(payload, dataOffset, header.compressedSize!, header.regeneratedSize, header.numStreams);
    expect(decoded.literals).toEqual(literals);
  });

  it('round-trips compressed literals section for bounded higher-entropy input', () => {
    const literals = new Uint8Array(4096);
    let state = 0x12345678 >>> 0;
    for (let i = 0; i < literals.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      literals[i] = state & 0x0f;
    }

    const payload = buildLiteralsSectionPayload(literals);
    const { header, dataOffset } = parseLiteralsSectionHeader(payload, 0);
    expect(header.blockType).toBe(2);

    const decoded = decodeCompressedLiterals(payload, dataOffset, header.compressedSize!, header.regeneratedSize, header.numStreams);
    expect(decoded.literals).toEqual(literals);
  });

  it('round-trips literals section when bytes include values > 127', () => {
    const literals = new Uint8Array(6000);
    for (let i = 0; i < literals.length; i++) {
      literals[i] = (i & 1) === 0 ? 0x80 : 0x7f;
    }

    const payload = buildLiteralsSectionPayload(literals);
    const { header, dataOffset } = parseLiteralsSectionHeader(payload, 0);
    expect(header.regeneratedSize).toBe(literals.length);
    if (header.blockType === 2) {
      const decoded = decodeCompressedLiterals(payload, dataOffset, header.compressedSize!, header.regeneratedSize, header.numStreams);
      expect(decoded.literals).toEqual(literals);
    } else {
      expect(header.blockType).toBe(0);
      expect(payload.subarray(dataOffset, dataOffset + literals.length)).toEqual(literals);
    }
  });

  it('round-trips treeless literals section reusing previous table across blocks', () => {
    const firstLiterals = new Uint8Array(2048);
    const secondLiterals = new Uint8Array(2048);
    for (let i = 0; i < firstLiterals.length; i++) {
      firstLiterals[i] = (i & 1) as 0 | 1;
      secondLiterals[i] = ((i + 1) & 1) as 0 | 1;
    }

    const context: SequenceEntropyContext = { prevTables: null, prevLiteralsTable: null };

    const firstPayload = buildLiteralsSectionPayload(firstLiterals, context);
    const firstParsed = parseLiteralsSectionHeader(firstPayload, 0);
    expect(firstParsed.header.blockType).toBe(2);
    const firstDecoded = decodeCompressedLiterals(
      firstPayload,
      firstParsed.dataOffset,
      firstParsed.header.compressedSize!,
      firstParsed.header.regeneratedSize,
      firstParsed.header.numStreams,
    );
    expect(firstDecoded.literals).toEqual(firstLiterals);

    const secondPayload = buildLiteralsSectionPayload(secondLiterals, context);
    const secondParsed = parseLiteralsSectionHeader(secondPayload, 0);
    expect(secondParsed.header.blockType).toBe(3);
    const secondDecoded = decodeTreelessLiterals(
      secondPayload,
      secondParsed.dataOffset,
      secondParsed.header.compressedSize!,
      secondParsed.header.regeneratedSize,
      secondParsed.header.numStreams,
      firstDecoded.huffmanTable,
    );
    expect(secondDecoded.literals).toEqual(secondLiterals);
  });
});
