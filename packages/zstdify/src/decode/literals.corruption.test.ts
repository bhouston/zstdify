import { describe, expect, it } from 'vitest';
import {
  decodeCompressedLiterals,
  decodeRawLiterals,
  decodeRLELiterals,
  decodeTreelessLiterals,
  parseLiteralsSectionHeader,
} from './literals.js';

describe('literals corruption handling', () => {
  it('rejects truncated literals section header', () => {
    const data = new Uint8Array([0x24]); // compressed literals sizeFormat=1 requires 3-byte header
    expect(() => parseLiteralsSectionHeader(data, 0)).toThrowError(/header truncated/i);
  });

  it('rejects raw literals overrun', () => {
    const data = new Uint8Array([0x61, 0x62]);
    expect(() => decodeRawLiterals(data, 0, 3)).toThrowError(/Raw literals truncated/i);
  });

  it('rejects rle literals when source byte is missing', () => {
    const data = new Uint8Array([]);
    expect(() => decodeRLELiterals(data, 0, 10)).toThrowError(/RLE literals truncated/i);
  });

  it('rejects invalid compressed literals size', () => {
    const data = new Uint8Array([0x80]); // direct weights header with 1 weight; no stream payload
    expect(() => decodeCompressedLiterals(data, 0, 1, 16, 1)).toThrowError(
      /truncated|Invalid literals compressed size/i,
    );
  });

  it('rejects treeless 4-stream with compressedSize < 10', () => {
    const table = decodeCompressedLiterals(new Uint8Array([129, 0x10, 0x02]), 0, 3, 1, 1).huffmanTable;
    const data = new Uint8Array(9);
    expect(() => decodeTreelessLiterals(data, 0, 9, 100, 4, table)).toThrowError(
      /4-stream mode requires at least 10 bytes/i,
    );
  });

  it('rejects compressed literals 4-stream jump table with negative stream4', () => {
    const data = new Uint8Array([
      129,
      0x10, // tree
      0x0a,
      0x00, // s1 = 10
      0x0a,
      0x00, // s2 = 10
      0x0a,
      0x00, // s3 = 10
      0x01,
      0x01,
      0x01,
      0x01,
      0x01,
      0x01,
      0x01,
      0x01,
      0x01,
      0x01,
    ]);
    expect(() => decodeCompressedLiterals(data, 0, 12, 4, 4)).toThrowError(/Invalid jump table/i);
  });

  it('rejects treeless literals 4-stream jump table with negative stream4', () => {
    const table = decodeCompressedLiterals(new Uint8Array([129, 0x10, 0x02]), 0, 3, 1, 1).huffmanTable;
    const data = new Uint8Array([0x0a, 0x00, 0x0a, 0x00, 0x0a, 0x00, 0x01, 0x01, 0x01, 0x01]);
    expect(() => decodeTreelessLiterals(data, 0, 10, 4, 4, table)).toThrowError(/Invalid jump table/i);
  });

  it('rejects Huffman stream with invalid end marker in 4-stream treeless mode', () => {
    const table = decodeCompressedLiterals(new Uint8Array([129, 0x10, 0x02]), 0, 3, 1, 1).huffmanTable;
    // Jump table: 1,1,1 and stream4=1. First stream byte is 0x00 => invalid end marker.
    const data = new Uint8Array([0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x01, 0x01, 0x01]);
    expect(() => decodeTreelessLiterals(data, 0, 10, 4, 4, table)).toThrowError(/invalid end marker/i);
  });

  it('rejects malformed Huffman stream termination in 4-stream treeless mode', () => {
    const malformedTable: Parameters<typeof decodeTreelessLiterals>[5] = {
      table: [{ symbol: 0, numBits: 2 } as { symbol: number; numBits: number }],
      maxNumBits: 2,
    };
    const data = new Uint8Array([0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x01]);
    expect(() => decodeTreelessLiterals(data, 0, 10, 4, 4, malformedTable)).toThrowError(/did not end cleanly/i);
  });
});
