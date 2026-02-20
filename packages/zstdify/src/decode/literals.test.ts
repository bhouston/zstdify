import { describe, expect, it } from 'vitest';
import { BitWriter } from '../bitstream/bitWriter.js';
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
