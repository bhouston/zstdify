import { describe, expect, it } from 'vitest';
import { parseZstdFrame } from './frameHeader.js';

describe('frameHeader', () => {
  it('parses minimal frame header (no window, no content size, no dict)', () => {
    // FHD: 0x00 = FCS=0, single=0, unused=0, reserved=0, checksum=0, dict=0
    const data = new Uint8Array([
      0x28,
      0xb5,
      0x2f,
      0xfd, // magic
      0x00,
      0x00, // FHD=0, WD: exponent=0 (windowLog=10), mantissa=0 -> 1KB
    ]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.headerSize).toBe(2); // 1 FHD + 1 WD
    expect(header.windowSize).toBe(1024);
    expect(header.contentSize).toBe(null);
    expect(header.hasContentChecksum).toBe(false);
    expect(header.dictionaryId).toBe(null);
  });

  it('rejects invalid magic', () => {
    const data = new Uint8Array([0, 0, 0, 0]);
    expect(() => parseZstdFrame(data, 0)).toThrow('Invalid zstd magic');
  });

  it('rejects reserved bit set', () => {
    const data = new Uint8Array([
      0x28,
      0xb5,
      0x2f,
      0xfd, // magic
      0x08,
      0x40, // FHD with reserved bit (bit 3) set
    ]);
    expect(() => parseZstdFrame(data, 0)).toThrow('Reserved bit');
  });
});
