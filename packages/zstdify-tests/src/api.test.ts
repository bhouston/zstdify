import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';

function assertZstdError(e: unknown): asserts e is { name: string; code: string; message: string } {
  expect(e).toBeInstanceOf(Error);
  expect((e as Error).name).toBe('ZstdError');
  expect((e as { code?: string }).code).toBeDefined();
}

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

  it('decompress throws ZstdError on empty input', () => {
    expect(() => decompress(new Uint8Array(0))).toThrow();
    try {
      decompress(new Uint8Array(0));
    } catch (e) {
      assertZstdError(e);
      expect(e.message).toMatch(/empty input/i);
      expect(e.code).toBe('corruption_detected');
    }
  });

  it('decompress throws on truncated input (too short for magic)', () => {
    for (const len of [1, 2, 3]) {
      expect(() => decompress(new Uint8Array(len))).toThrow();
    }
    try {
      decompress(new Uint8Array(3));
    } catch (e) {
      assertZstdError(e);
      expect(e.message).toMatch(/truncated|invalid magic/i);
    }
  });

  it('decompress skips skippable frame then decodes zstd frame', () => {
    // Build: skippable frame (magic 0x184D2A50 LE + 4-byte size LE + payload) then zstd frame
    const zstdFrame = compress(new TextEncoder().encode('hello'));
    const skippableSize = 4; // 4 bytes of payload
    const skippablePayload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const skippableMagic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]); // LE
    const skippableSizeBytes = new Uint8Array(4);
    new DataView(skippableSizeBytes.buffer).setUint32(0, skippableSize, true);
    const combined = new Uint8Array(skippableMagic.length + 4 + skippableSize + zstdFrame.length);
    let off = 0;
    combined.set(skippableMagic, off);
    off += 4;
    combined.set(skippableSizeBytes, off);
    off += 4;
    combined.set(skippablePayload, off);
    off += skippableSize;
    combined.set(zstdFrame, off);
    const result = decompress(combined);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('decompress throws on truncated skippable frame header', () => {
    // Only 4 bytes (skippable magic); getSkippableFrameSize needs 8
    const skippableMagicOnly = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    expect(() => decompress(skippableMagicOnly)).toThrow(/skippable|truncated/i);
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

  it('decompress merges multiple zstd frames', () => {
    const a = compress(new TextEncoder().encode('first'));
    const b = compress(new TextEncoder().encode('second'));
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a);
    combined.set(b, a.length);
    const result = decompress(combined);
    expect(new TextDecoder().decode(result)).toBe('firstsecond');
  });

  it('decompress with dictionary option (object form with id)', () => {
    const dictBytes = new TextEncoder().encode('alpha beta gamma delta ');
    const payload = new TextEncoder().encode('alpha beta');
    const compressed = compress(payload);
    const result = decompress(compressed, { dictionary: { bytes: dictBytes } });
    expect(new TextDecoder().decode(result)).toBe('alpha beta');
  });

  it('decompress throws when frame has dictionary ID but no dictionary option', () => {
    // Minimal frame with dictionaryIdFlag=1 and one byte dict ID (0x42)
    const frame = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x00, 0x42, 0x29, 0x00, 0x00]);
    const hello = new TextEncoder().encode('hello');
    const full = new Uint8Array(frame.length + hello.length);
    full.set(frame);
    full.set(hello, frame.length);
    expect(() => decompress(full)).toThrow(/dictionary|parameter_unsupported/i);
    try {
      decompress(full);
    } catch (e) {
      assertZstdError(e);
      expect(e.code).toBe('parameter_unsupported');
    }
  });

  it('decompress throws on dictionary ID mismatch', () => {
    const frame = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x00, 0x42, 0x29, 0x00, 0x00]);
    const hello = new TextEncoder().encode('hello');
    const full = new Uint8Array(frame.length + hello.length);
    full.set(frame);
    full.set(hello, frame.length);
    const dictBytes = new Uint8Array(64);
    expect(() => decompress(full, { dictionary: { bytes: dictBytes, id: 99 } })).toThrow(
      /Dictionary ID mismatch|corruption/i,
    );
    try {
      decompress(full, { dictionary: { bytes: dictBytes, id: 99 } });
    } catch (e) {
      assertZstdError(e);
      expect(e.code).toBe('corruption_detected');
    }
  });

  it('decompress returns empty when stream contains only skippable frame(s)', () => {
    // Single skippable frame: magic (4) + size LE (4) + payload; size=0 -> 8 bytes total, no zstd frame
    const skippableMagic = new Uint8Array([0x50, 0x2a, 0x4d, 0x18]);
    const sizeBytes = new Uint8Array(4); // size = 0
    const skippableOnly = new Uint8Array(8);
    skippableOnly.set(skippableMagic, 0);
    skippableOnly.set(sizeBytes, 4);
    const result = decompress(skippableOnly);
    expect(result).toEqual(new Uint8Array(0));
  });
});
