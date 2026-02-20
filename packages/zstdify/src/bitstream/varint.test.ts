import { describe, expect, it } from 'vitest';
import { decodeVarint, encodeVarint } from './varint.js';

describe('varint', () => {
  it('encodes and decodes small values', () => {
    for (const v of [0, 1, 127, 128, 255, 256, 16383]) {
      const encoded = encodeVarint(v);
      const { value, bytesRead } = decodeVarint(encoded, 0);
      expect(value).toBe(v);
      expect(bytesRead).toBe(encoded.length);
    }
  });

  it('decodes single-byte varint', () => {
    const data = new Uint8Array([0x7f]); // 127, no continuation
    const { value, bytesRead } = decodeVarint(data, 0);
    expect(value).toBe(127);
    expect(bytesRead).toBe(1);
  });

  it('decodes two-byte varint', () => {
    const data = new Uint8Array([0x80, 0x01]); // 128 = 0x80 | 0x01<<7
    const { value, bytesRead } = decodeVarint(data, 0);
    expect(value).toBe(128);
    expect(bytesRead).toBe(2);
  });
});
