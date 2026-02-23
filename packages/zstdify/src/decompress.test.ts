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

  it('decodes mixed stream of zstd and skippable frames', () => {
    const a = new TextEncoder().encode('first frame payload');
    const b = new TextEncoder().encode('second frame payload');
    const frameA = compress(a, { level: 0 });
    const frameB = compress(b, { level: 3, checksum: true });

    const skip1Payload = new Uint8Array([1, 2, 3]);
    const skip2Payload = new Uint8Array([9, 8, 7, 6, 5]);
    const skip1 = new Uint8Array(8 + skip1Payload.length);
    skip1.set([0x50, 0x2a, 0x4d, 0x18], 0);
    skip1.set(u32le(skip1Payload.length), 4);
    skip1.set(skip1Payload, 8);
    const skip2 = new Uint8Array(8 + skip2Payload.length);
    skip2.set([0x5f, 0x2a, 0x4d, 0x18], 0);
    skip2.set(u32le(skip2Payload.length), 4);
    skip2.set(skip2Payload, 8);

    const input = new Uint8Array(frameA.length + skip1.length + frameB.length + skip2.length);
    let pos = 0;
    input.set(frameA, pos);
    pos += frameA.length;
    input.set(skip1, pos);
    pos += skip1.length;
    input.set(frameB, pos);
    pos += frameB.length;
    input.set(skip2, pos);

    const expected = new Uint8Array(a.length + b.length);
    expected.set(a, 0);
    expected.set(b, a.length);
    expect(decompress(input)).toEqual(expected);
  });

  it('fails when malformed skippable frame appears after a valid frame', () => {
    const payload = new TextEncoder().encode('valid frame first');
    const frame = compress(payload, { level: 0 });
    const badSkippable = new Uint8Array(8 + 2);
    badSkippable.set([0x50, 0x2a, 0x4d, 0x18], 0);
    badSkippable.set(u32le(99), 4);
    badSkippable.set([1, 2], 8);

    const input = new Uint8Array(frame.length + badSkippable.length);
    input.set(frame, 0);
    input.set(badSkippable, frame.length);
    expect(() => decompress(input)).toThrow(/truncated payload/i);
  });
});
