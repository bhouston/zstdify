import { describe, expect, it } from 'vitest';
import { writeRawBlock, writeRLEBlock } from './blockWriter.js';

describe('blockWriter', () => {
  it('writeRawBlock produces correct header and payload', () => {
    const data = new Uint8Array([0x61, 0x62, 0x63]);
    const block = writeRawBlock(data, 0, 3, true);
    expect(block.length).toBe(6);
    // Block header: last=1, type=0 (raw), size=3 -> (1 | 0<<1 | 3<<3) = 25 LE = 19 00 00
    expect(block[0]).toBe(25);
    expect(block[1]).toBe(0);
    expect(block[2]).toBe(0);
    expect(block[3]).toBe(0x61);
    expect(block[4]).toBe(0x62);
    expect(block[5]).toBe(0x63);
  });

  it('writeRawBlock with last=false sets last bit 0', () => {
    const data = new Uint8Array([1]);
    const block = writeRawBlock(data, 0, 1, false);
    expect(block[0]).toBe(1 << 3); // last=0, type=0, size=1
  });

  it('writeRLEBlock produces correct header and single byte', () => {
    const block = writeRLEBlock(0x61, 10, true);
    expect(block.length).toBe(4);
    // last=1, type=1 (RLE), size=10 -> (1 | 2 | 80) = 83 LE = 53 00 00
    expect(block[0]).toBe(83);
    expect(block[1]).toBe(0);
    expect(block[2]).toBe(0);
    expect(block[3]).toBe(0x61);
  });
});
