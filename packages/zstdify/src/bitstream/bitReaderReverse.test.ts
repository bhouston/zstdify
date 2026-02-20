import { describe, expect, it } from 'vitest';
import { BitReaderReverse } from './bitReaderReverse.js';

describe('BitReaderReverse', () => {
  it('supports unreadBits to rollback over-read', () => {
    const reader = new BitReaderReverse(new Uint8Array([0xa0, 0x01]), 0, 2);
    reader.skipPadding();
    const first = reader.readBits(2);
    expect(first).toBe(2);
    reader.unreadBits(1);
    expect(reader.readBits(1)).toBe(0);
  });

  it('zero-fills when reading past stream start', () => {
    const reader = new BitReaderReverse(new Uint8Array([0x80]), 0, 1);
    reader.skipPadding();
    // No payload bits remain after padding; reading still succeeds with zeros.
    expect(reader.readBits(4)).toBe(0);
  });

  it('position returns start byte when bitOffset <= startBit', () => {
    const reader = new BitReaderReverse(new Uint8Array([0x80]), 0, 1);
    reader.skipPadding();
    reader.readBits(4); // consume remaining (zeros)
    expect(reader.position).toBe(0);
  });

  it('position returns correct byte after reading bits', () => {
    const reader = new BitReaderReverse(new Uint8Array([0xa0, 0x01]), 0, 2);
    reader.skipPadding();
    reader.readBits(2);
    expect(reader.position).toBeGreaterThanOrEqual(0);
    expect(reader.position).toBeLessThanOrEqual(2);
  });

  it('skipBitsAtEnd advances logical position', () => {
    const reader = new BitReaderReverse(new Uint8Array([0x80]), 0, 1);
    reader.skipPadding();
    reader.skipBitsAtEnd(1);
    expect(reader.readBits(1)).toBe(0);
  });

  it('skipBitsAtEnd throws on buffer underflow', () => {
    const reader = new BitReaderReverse(new Uint8Array([0x80]), 0, 1);
    reader.skipPadding();
    expect(() => reader.skipBitsAtEnd(100)).toThrow(/underflow|RangeError/i);
  });

  it('unreadBits throws on overflow', () => {
    const reader = new BitReaderReverse(new Uint8Array([0xa0, 0x01]), 0, 2);
    reader.skipPadding();
    reader.readBits(2);
    expect(() => reader.unreadBits(20)).toThrow(/overflow|RangeError/i);
  });
});
