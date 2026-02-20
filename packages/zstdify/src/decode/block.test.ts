import { describe, expect, it } from 'vitest';
import { parseBlockHeader } from './block.js';

describe('block', () => {
  it('parses raw block header (last=1, type=0, size=5)', () => {
    // last=1, type=0, size=5 -> (5<<3)|0<<1|1 = 41
    const data = new Uint8Array([0x29, 0x00, 0x00]);
    const block = parseBlockHeader(data, 0);
    expect(block.lastBlock).toBe(true);
    expect(block.blockType).toBe(0);
    expect(block.blockSize).toBe(5);
  });

  it('throws on reserved block type 3', () => {
    // last=0, type=3, size=0
    const data = new Uint8Array([0x06, 0x00, 0x00]);
    expect(() => parseBlockHeader(data, 0)).toThrow(/Reserved block type|corruption/i);
  });

  it('throws when block header is truncated', () => {
    const data = new Uint8Array([0x28, 0xb5]);
    expect(() => parseBlockHeader(data, 0)).toThrow(/Block header truncated|corruption/i);
  });

  it('throws when offset + 3 exceeds data length', () => {
    const data = new Uint8Array([0x29, 0x00]);
    expect(() => parseBlockHeader(data, 0)).toThrow(/truncated|corruption/i);
  });
});
