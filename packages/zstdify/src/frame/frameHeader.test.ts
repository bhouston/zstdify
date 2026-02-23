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

  it('parses single-segment frame with 1-byte content size and checksum', () => {
    // FHD: FCS=0 (1 byte), single=1, checksum=1, dict=0 -> 0x24. Then 1 byte content size = 5
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x05]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.singleSegment).toBe(true);
    expect(header.contentSize).toBe(5);
    expect(header.hasContentChecksum).toBe(true);
    expect(header.headerSize).toBe(2);
  });

  it('parses frame with 2-byte content size', () => {
    // FHD: FCS=1 (2 bytes), single=1, dict=0 -> 0x60. Single-segment skips WD, so FCS starts immediately.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x60, 0x01, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.singleSegment).toBe(true);
    expect(header.contentSize).toBe(257);
  });

  it('parses frame with dictionary ID (1 byte)', () => {
    // FHD: FCS=0, single=1, dict=1 -> 0x21. Per spec: [Dict_ID] then [FCS]; so 1 byte dict ID = 42, then 1 byte FCS = 0.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x21, 0x2a, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.dictionaryId).toBe(0x2a);
  });

  it('parses frame with dictionary ID 0 as null', () => {
    // dict=1, 1 byte dict ID = 0; per spec dictionary ID 0 means "no dictionary"
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x21, 0x00, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.dictionaryId).toBe(null);
  });

  it('parses large window size without 32-bit shift overflow', () => {
    // FHD=0 => non-single-segment, no dict, no content size.
    // WD=0xff => exponent=31 (windowLog=41), mantissa=7.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xff]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.windowSize).toBe(4_123_168_604_160);
  });

  it('parses frame with 4-byte content size', () => {
    // FHD: bits 7-6=FCS(2)=4 bytes, bit 5=single=1, bits 1-0=dict=0 -> 0xA0. Then 4 bytes LE = 0x10000.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0x00, 0x00, 0x01, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.contentSize).toBe(0x10000);
    expect(header.headerSize).toBe(5);
  });

  it('parses frame with 8-byte content size', () => {
    // FHD: bits 7-6=FCS(3)=8 bytes, bit 5=single=1 -> 0xE0. Then 8 bytes LE = 2^32.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.contentSize).toBe(0x1_0000_0000);
    expect(header.headerSize).toBe(9);
  });

  it('rejects input too short for magic', () => {
    const data = new Uint8Array([0x28, 0xb5, 0x2f]);
    expect(() => parseZstdFrame(data, 0)).toThrow(/too short|magic/i);
  });
});
