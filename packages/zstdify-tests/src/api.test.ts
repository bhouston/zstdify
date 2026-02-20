import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';

describe('zstdify API', () => {
  it('compress produces valid zstd frame', () => {
    const input = new TextEncoder().encode('hello');
    const compressed = compress(input);
    expect(compressed.length).toBeGreaterThan(0);
    const decompressed = decompress(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe('hello');
  });

  it('decompress rejects invalid magic', () => {
    const input = new Uint8Array([0, 0, 0, 0]);
    expect(() => decompress(input)).toThrow();
  });

  it('decompress decodes raw block frame', () => {
    // Minimal zstd frame: magic + header (FHD=0, WD=0) + block (last=1, raw=0, size=5) + "hello"
    const frame = new Uint8Array([
      0x28,
      0xb5,
      0x2f,
      0xfd, // magic
      0x00,
      0x00, // FHD, WD
      0x29,
      0x00,
      0x00, // block: last=1, raw=0, size=5
    ]);
    const hello = new TextEncoder().encode('hello');
    const full = new Uint8Array(frame.length + hello.length);
    full.set(frame);
    full.set(hello, frame.length);
    const result = decompress(full);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });
});
