import { describe, expect, it } from 'vitest';
import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { BitWriter } from '../bitstream/bitWriter.js';
import { buildHuffmanDecodeTable, decodeHuffmanSymbol, weightsToNumBits } from '../entropy/huffman.js';
import { decodeCompressedLiterals, decodeTreelessLiterals, parseLiteralsSectionHeader } from './literals.js';

describe('literals header parsing', () => {
  it('parses compressed literals header with bit-accurate layout', () => {
    const writer = new BitWriter();
    writer.writeBits(2, 2); // blockType=Compressed
    writer.writeBits(2, 1); // sizeFormat=1 => 4 streams, 10-bit sizes
    writer.writeBits(10, 513); // regeneratedSize
    writer.writeBits(10, 700); // compressedSize
    const headerBytes = writer.flush();

    const { header, dataOffset } = parseLiteralsSectionHeader(headerBytes, 0);
    expect(header.blockType).toBe(2);
    expect(header.numStreams).toBe(4);
    expect(header.regeneratedSize).toBe(513);
    expect(header.compressedSize).toBe(700);
    expect(header.headerSize).toBe(3);
    expect(dataOffset).toBe(3);
  });

  it('parses raw literals header with sizeFormat=3', () => {
    const data = new Uint8Array([0x5c, 0x32, 0x00]); // blockType=0, sizeFormat=3, regeneratedSize=0x325
    const { header, dataOffset } = parseLiteralsSectionHeader(data, 0);
    expect(header.blockType).toBe(0);
    expect(header.regeneratedSize).toBe(0x325);
    expect(header.headerSize).toBe(3);
    expect(dataOffset).toBe(3);
  });

  it('parses RLE literals header with sizeFormat=3', () => {
    const data = new Uint8Array([0xad, 0x01, 0x00]); // blockType=1, sizeFormat=3, regeneratedSize=0x1a
    const { header, dataOffset } = parseLiteralsSectionHeader(data, 0);
    expect(header.blockType).toBe(1);
    expect(header.regeneratedSize).toBe(0x1a);
    expect(header.headerSize).toBe(3);
    expect(dataOffset).toBe(3);
  });
});

describe('decodeCompressedLiterals', () => {
  it('decodes minimal single-symbol Huffman (direct weights, 1 stream)', () => {
    // headerByte=129 => numWeights=2, then 1 byte with nibbles [1,0] => symbol 0 has weight 1 (1 bit)
    // stream: 1 byte; last byte must be non-zero (end marker). Bit 0 = data (0), bit 1 = end => 0x02
    const data = new Uint8Array([129, 0x10, 0x02]);
    const result = decodeCompressedLiterals(data, 0, 3, 1, 1);
    expect(result.literals).toEqual(new Uint8Array([0]));
    expect(result.bytesRead).toBe(3);
    expect(result.huffmanTable.table).toBeDefined();
    expect(result.huffmanTable.maxNumBits).toBe(1);
  });

  it('decodes multiple symbols with single-symbol tree', () => {
    // Same tree (symbol 0, 1 bit). Stream: 3 data bits (0,0,0) + end at bit 3 => 0x08
    const data = new Uint8Array([129, 0x10, 0x08]);
    const result = decodeCompressedLiterals(data, 0, 3, 3, 1);
    expect(result.literals).toEqual(new Uint8Array([0, 0, 0]));
    expect(result.bytesRead).toBe(3);
  });
});

describe('decodeTreelessLiterals', () => {
  it('decodes treeless literals reusing previous Huffman table (1 stream)', () => {
    // First get a table from compressed literals
    const compressed = new Uint8Array([129, 0x10, 0x02]);
    const { huffmanTable } = decodeCompressedLiterals(compressed, 0, 3, 1, 1);
    // Treeless: no tree, just stream. Same 1-symbol stream: 1 byte with end marker 0x02
    const treelessData = new Uint8Array([0x02]);
    const result = decodeTreelessLiterals(treelessData, 0, 1, 1, 1, huffmanTable);
    expect(result.literals).toEqual(new Uint8Array([0]));
    expect(result.bytesRead).toBe(1);
  });
});

describe('decodeCompressedLiterals regression', () => {
  it('single-stream decoding consumes symbol bit-length (not max bit-length)', () => {
    // Direct weights for 3 symbols: [1,1,2], plus computed last symbol.
    // This yields mixed Huffman bit-lengths (max=3, with some symbols using 2 bits).
    const weights = [1, 1, 2];
    let partialSum = 0;
    for (const w of weights) {
      partialSum += 1 << (w - 1);
    }
    const maxNumBits = 32 - Math.clz32(partialSum);
    const remainder = (1 << maxNumBits) - partialSum;
    const lastWeight = 32 - Math.clz32(remainder);
    const fullWeights = [...weights, lastWeight];
    const table = buildHuffmanDecodeTable(weightsToNumBits(fullWeights, maxNumBits), maxNumBits);

    const decodeRef = (streamByte: number, count: number): Uint8Array | null => {
      try {
        const out = new Uint8Array(count);
        const reader = new BitReaderReverse(new Uint8Array([streamByte]), 0, 1);
        reader.skipPadding();
        for (let i = 0; i < count; i++) {
          out[i] = decodeHuffmanSymbol(table, reader);
        }
        return out;
      } catch {
        return null;
      }
    };

    // Historical buggy behavior: consumes maxNumBits for every symbol.
    const decodeBuggy = (streamByte: number, count: number): Uint8Array | null => {
      try {
        const out = new Uint8Array(count);
        const reader = new BitReaderReverse(new Uint8Array([streamByte]), 0, 1);
        reader.skipPadding();
        for (let i = 0; i < count; i++) {
          const peek = reader.readBits(maxNumBits);
          if (peek < 0 || peek >= table.length) return null;
          if ((table.numBits[peek] ?? 0) === 0) return null;
          out[i] = table.symbol[peek]!;
        }
        return out;
      } catch {
        return null;
      }
    };

    const targetCount = 2;
    let chosenByte = -1;
    let expected: Uint8Array | null = null;
    for (let b = 1; b <= 0xff; b++) {
      const ref = decodeRef(b, targetCount);
      const buggy = decodeBuggy(b, targetCount);
      if (!ref || !buggy) continue;
      if (ref[0] === ref[1]) continue;
      if (ref[0] === buggy[0] && ref[1] === buggy[1]) continue;
      chosenByte = b;
      expected = ref;
      break;
    }

    expect(chosenByte).toBeGreaterThan(0);
    expect(expected).not.toBeNull();

    const treeHeader = new Uint8Array([130, 0x11, 0x20]); // headerByte + direct-weight bytes
    const payload = new Uint8Array([...treeHeader, chosenByte]);
    const decoded = decodeCompressedLiterals(payload, 0, payload.length, targetCount, 1);
    expect(decoded.literals).toEqual(expected!);
  });
});
