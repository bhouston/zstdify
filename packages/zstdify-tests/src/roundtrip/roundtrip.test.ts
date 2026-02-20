/**
 * Round-trip tests: decompress(compress(x)) === x
 */

import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';
import { makeSeededPayload } from '../helpers/payloadHelpers.js';

describe('roundtrip', () => {
  it('empty input', () => {
    const input = new Uint8Array(0);
    const compressed = compress(input);
    const decompressed = decompress(compressed);
    expect(decompressed.length).toBe(0);
  });

  it('short string', () => {
    const input = new TextEncoder().encode('hello world');
    const compressed = compress(input);
    const decompressed = decompress(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe('hello world');
  });

  it('binary data', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const compressed = compress(input);
    const decompressed = decompress(compressed);
    expect(decompressed).toEqual(input);
  });

  it('large input (multiple blocks)', () => {
    const size = 200 * 1024;
    const input = new Uint8Array(size);
    for (let i = 0; i < size; i++) input[i] = i & 0xff;
    const compressed = compress(input);
    const decompressed = decompress(compressed);
    expect(decompressed).toEqual(input);
  });

  it('repeated byte input uses level>0 path', () => {
    const input = new Uint8Array(4096);
    input.fill(0x61);
    const compressed = compress(input, { level: 1 });
    const decompressed = decompress(compressed);
    expect(decompressed).toEqual(input);
  });

  it('round-trips with optional frame checksum enabled', () => {
    const input = new TextEncoder().encode('checksum-enabled roundtrip payload');
    const compressed = compress(input, { level: 3, checksum: true });
    const decompressed = decompress(compressed);
    expect(decompressed).toEqual(input);
  });

  for (const level of [1, 3, 5, 9] as const) {
    it(`round-trips seeded 4K payload at level ${level}`, () => {
      const input = makeSeededPayload(4 * 1024, 0xdecafbad);
      const compressed = compress(input, { level });
      const decompressed = decompress(compressed);
      expect(decompressed).toEqual(input);
    });
  }

  it('compress is deterministic (same input and options → same output)', () => {
    const input = makeSeededPayload(1024, 42);
    const a = compress(input, { level: 3 });
    const b = compress(input, { level: 3 });
    expect(a).toEqual(b);
  });
});
