import { describe, expect, it } from 'vitest';
import { readU16LE, readU32LE, readU64LE } from './littleEndian.js';

describe('littleEndian', () => {
  it('readU16LE', () => {
    const data = new Uint8Array([0x34, 0x12]); // 0x1234
    expect(readU16LE(data, 0)).toBe(0x1234);
  });

  it('readU32LE', () => {
    const data = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
    expect(readU32LE(data, 0)).toBe(0x12345678);
  });

  it('readU64LE', () => {
    const data = new Uint8Array([0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01]);
    expect(readU64LE(data, 0)).toBe(0x0123456789abcdefn);
  });

  it('throws on out of bounds', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(() => readU32LE(data, 0)).toThrow();
  });
});
