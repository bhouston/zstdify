import { describe, expect, it } from 'vitest';
import { writeFrameHeader } from './frameWriter.js';

const ZSTD_MAGIC_LE = [0x28, 0xb5, 0x2f, 0xfd];

describe('frameWriter', () => {
  it('writeFrameHeader writes magic and 1-byte content size for small content', () => {
    const h = writeFrameHeader(100, false);
    expect(h.length).toBeGreaterThanOrEqual(6);
    expect(h[0]).toBe(ZSTD_MAGIC_LE[0]);
    expect(h[1]).toBe(ZSTD_MAGIC_LE[1]);
    expect(h[2]).toBe(ZSTD_MAGIC_LE[2]);
    expect(h[3]).toBe(ZSTD_MAGIC_LE[3]);
    // FHD: single segment (1<<5), content size flag 0 (1 byte), no checksum
    expect(h[4]).toBe(1 << 5);
    expect(h[5]).toBe(100);
  });

  it('writeFrameHeader uses 2-byte content size for medium content', () => {
    const h = writeFrameHeader(256 + 100, false);
    expect(h.length).toBeGreaterThanOrEqual(7);
    expect(h[4]).toBe((1 << 6) | (1 << 5));
    // 256+100-256 = 100, LE
    expect(h[5]).toBe(100);
    expect(h[6]).toBe(0);
  });

  it('writeFrameHeader uses 4-byte content size for large content', () => {
    const h = writeFrameHeader(300_000, false);
    expect(h.length).toBeGreaterThanOrEqual(9);
    expect(h[4]).toBe((2 << 6) | (1 << 5));
    expect(h[5]).toBe(300_000 & 0xff);
    expect(h[6]).toBe((300_000 >> 8) & 0xff);
    expect(h[7]).toBe((300_000 >> 16) & 0xff);
    expect(h[8]).toBe((300_000 >> 24) & 0xff);
  });

  it('writeFrameHeader sets checksum flag when hasChecksum true', () => {
    const h = writeFrameHeader(5, true);
    expect(h[4]).toBe((1 << 5) | (1 << 2));
  });
});
