import { describe, expect, it } from 'vitest';
import { compress } from './compress.js';
import { decompress } from './decompress.js';

function u32le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

describe('decompress', () => {
  it('throws on truncated skippable frame payload', () => {
    const skippableMagic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const declaredSize = u32le(10);
    const truncatedPayload = new Uint8Array([1, 2, 3, 4]);
    const input = new Uint8Array(8 + truncatedPayload.length);
    input.set(skippableMagic, 0);
    input.set(declaredSize, 4);
    input.set(truncatedPayload, 8);
    expect(() => decompress(input)).toThrow(/truncated payload/i);
  });

  it('skips valid skippable frame then decodes zstd frame', () => {
    const skippableMagic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const skippablePayload = new Uint8Array([9, 8, 7, 6]);
    const payload = new TextEncoder().encode('hello from frame');
    const frame = compress(payload, { level: 0 });
    const input = new Uint8Array(8 + skippablePayload.length + frame.length);
    input.set(skippableMagic, 0);
    input.set(u32le(skippablePayload.length), 4);
    input.set(skippablePayload, 8);
    input.set(frame, 8 + skippablePayload.length);
    expect(decompress(input)).toEqual(payload);
  });
});
