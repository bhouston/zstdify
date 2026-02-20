import { describe, expect, it } from 'vitest';
import { BitReader } from './bitReader.js';

describe('BitReader', () => {
  it('reads single bits', () => {
    // 0b10110100 = 0xB4
    const data = new Uint8Array([0xb4]);
    const r = new BitReader(data);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(1);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(1);
    expect(r.readBits(1)).toBe(1);
    expect(r.readBits(1)).toBe(0);
    expect(r.readBits(1)).toBe(1);
    expect(r.atEnd).toBe(true);
  });

  it('reads multi-bit values', () => {
    const data = new Uint8Array([0xff, 0x00]); // 11111111 00000000
    const r = new BitReader(data);
    expect(r.readBits(8)).toBe(0xff);
    expect(r.readBits(8)).toBe(0x00);
  });

  it('reads across byte boundaries', () => {
    // byte0: 1111 (low) 0000 (high), byte1: 1111 (low) 0000 (high)
    const data = new Uint8Array([0b00001111, 0b00001111]);
    const r = new BitReader(data);
    expect(r.readBits(4)).toBe(0b1111); // low 4 of byte0
    expect(r.readBits(8)).toBe(0b11110000); // high 4 of byte0 + low 4 of byte1
    expect(r.readBits(4)).toBe(0); // high 4 of byte1
  });

  it('align works', () => {
    const data = new Uint8Array([0xff, 0xab, 0xcd]);
    const r = new BitReader(data);
    r.readBits(3);
    r.align();
    expect(r.position).toBe(1);
    expect(r.readByte()).toBe(0xab);
  });

  it('throws on out of bounds', () => {
    const data = new Uint8Array([0xff]);
    const r = new BitReader(data);
    r.readBits(8);
    expect(() => r.readBits(1)).toThrow();
  });
});
