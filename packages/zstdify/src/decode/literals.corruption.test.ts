import { describe, expect, it } from 'vitest';
import {
  decodeCompressedLiterals,
  decodeRawLiterals,
  decodeRLELiterals,
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
    expect(() => decodeCompressedLiterals(data, 0, 1, 16, 1)).toThrowError(/truncated|Invalid literals compressed size/i);
  });
});
