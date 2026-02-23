import { describe, expect, it } from 'vitest';
import { getSkippableFrameSize, isSkippableFrame, SKIPPABLE_FRAME_MAGIC, skipSkippableFrame } from './skippable.js';

describe('skippable frame', () => {
  it('isSkippableFrame returns false when not enough bytes', () => {
    expect(isSkippableFrame(new Uint8Array(2), 0)).toBe(false);
    expect(isSkippableFrame(new Uint8Array([0x50, 0x2a]), 0)).toBe(false);
  });

  it('isSkippableFrame returns true for skippable magic (LE)', () => {
    const magic = new Uint8Array(4);
    new DataView(magic.buffer).setUint32(0, SKIPPABLE_FRAME_MAGIC, true);
    expect(isSkippableFrame(magic, 0)).toBe(true);
  });

  it('accepts full skippable magic range and rejects out-of-range value', () => {
    const minMagic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const maxMagic = new Uint8Array([0x5f, 0x2a, 0x4d, 0x18]);
    const outOfRange = new Uint8Array([0x60, 0x2a, 0x4d, 0x18]);
    expect(isSkippableFrame(minMagic, 0)).toBe(true);
    expect(isSkippableFrame(maxMagic, 0)).toBe(true);
    expect(isSkippableFrame(outOfRange, 0)).toBe(false);
  });

  it('getSkippableFrameSize returns payload size and throws when truncated', () => {
    const magic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const sizeBytes = new Uint8Array(4);
    new DataView(sizeBytes.buffer).setUint32(0, 10, true);
    const header = new Uint8Array(8);
    header.set(magic);
    header.set(sizeBytes, 4);
    expect(getSkippableFrameSize(header, 0)).toBe(10);
    expect(() => getSkippableFrameSize(new Uint8Array(7), 0)).toThrow(/truncated/);
  });

  it('skipSkippableFrame returns offset after frame', () => {
    const magic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const sizeBytes = new Uint8Array(4);
    new DataView(sizeBytes.buffer).setUint32(0, 4, true);
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = new Uint8Array(8 + 4);
    frame.set(magic, 0);
    frame.set(sizeBytes, 4);
    frame.set(payload, 8);
    expect(skipSkippableFrame(frame, 0)).toBe(12);
  });

  it('skipSkippableFrame throws when payload is truncated', () => {
    const magic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const sizeBytes = new Uint8Array(4);
    new DataView(sizeBytes.buffer).setUint32(0, 10, true);
    const truncated = new Uint8Array(8 + 4);
    truncated.set(magic, 0);
    truncated.set(sizeBytes, 4);
    expect(() => skipSkippableFrame(truncated, 0)).toThrow(/truncated payload/i);
  });

  it('returns full 32-bit size and rejects max-size truncation', () => {
    const magic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const sizeBytes = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    const header = new Uint8Array(8);
    header.set(magic, 0);
    header.set(sizeBytes, 4);
    expect(getSkippableFrameSize(header, 0)).toBe(0xffff_ffff);
    expect(() => skipSkippableFrame(header, 0)).toThrow(/truncated payload/i);
  });
});
