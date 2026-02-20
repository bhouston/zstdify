import { describe, expect, it } from 'vitest';
import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { buildHuffmanDecodeTable, decodeHuffmanSymbol } from './huffman.js';

describe('Huffman', () => {
  it('builds canonical decode table in rank order', () => {
    const table = buildHuffmanDecodeTable([1, 2, 2], 2);
    expect(table.map((r) => r?.symbol)).toEqual([1, 2, 0, 0]);
    expect(table.map((r) => r?.numBits)).toEqual([2, 2, 1, 1]);
  });

  it('decode consumes symbol bit length (not max bits)', () => {
    const table = buildHuffmanDecodeTable([1, 2, 2], 2);
    // Reverse bitstream payload is first byte; last byte is only the end-mark.
    // For first byte 0b10100000, the first 2-bit peek is binary 10 (index 2),
    // whose row has numBits=1, so one bit must remain unread.
    const reader = new BitReaderReverse(new Uint8Array([0xa0, 0x01]), 0, 2);
    reader.skipPadding();
    const symbol = decodeHuffmanSymbol(table, 2, reader);
    expect(symbol).toBe(0);
    expect(reader.readBits(1)).toBe(0);
  });
});
