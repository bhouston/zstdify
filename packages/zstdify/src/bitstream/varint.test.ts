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

  it('round-trips max uint32', () => {
    const max = 0xffff_ffff;
    const encoded = encodeVarint(max);
    const { value, bytesRead } = decodeVarint(encoded, 0);
    expect(value).toBe(max);
    expect(bytesRead).toBe(encoded.length);
  });

  it('rejects encode inputs outside uint32', () => {
    expect(() => encodeVarint(-1)).toThrow(/uint32|RangeError/i);
    expect(() => encodeVarint(1.5)).toThrow(/uint32|RangeError/i);
    expect(() => encodeVarint(0x1_0000_0000)).toThrow(/uint32|RangeError/i);
  });

  it('rejects malformed decode inputs outside uint32 varint bounds', () => {
    expect(() => decodeVarint(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x00]), 0)).toThrow(
      /exceeds 5 bytes|RangeError/i,
    );
    expect(() => decodeVarint(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x1f]), 0)).toThrow(/too large|RangeError/i);
    expect(() => decodeVarint(new Uint8Array([0x01]), -1)).toThrow(/offset|RangeError/i);
  });
});
