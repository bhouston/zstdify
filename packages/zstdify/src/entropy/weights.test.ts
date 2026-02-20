import { describe, expect, it } from 'vitest';
import { readWeightsDirect, readWeightsFSE } from './weights.js';

describe('weights', () => {
  describe('readWeightsDirect', () => {
    it('throws when data is truncated', () => {
      // numWeights=4 -> bytesNeeded=2; buffer length 1
      expect(() => readWeightsDirect(new Uint8Array([0x00]), 0, 4)).toThrow(/Huffman weights truncated/i);
    });

    it('returns weights for valid direct input', () => {
      // 2 weights in 1 byte: high nibble and low nibble
      const { weights, bytesRead } = readWeightsDirect(new Uint8Array([0x12]), 0, 2);
      expect(weights).toEqual([1, 2]);
      expect(bytesRead).toBe(1);
    });
  });

  describe('readWeightsFSE', () => {
    it('throws when compressed size < 2', () => {
      expect(() => readWeightsFSE(new Uint8Array(10), 0, 1)).toThrow(/FSE-compressed weights: need at least 2 bytes/i);
    });

    it('throws when input is truncated', () => {
      expect(() => readWeightsFSE(new Uint8Array([0x00, 0x00]), 0, 5)).toThrow(/FSE-compressed weights truncated/i);
    });

    it('throws when there is no stream after header', () => {
      // From fse.test: [0x10, 0x3f, 0x01] gives readNCount bytesRead=2. Use compressedSize=2
      // so streamLength = 2 - 2 = 0 (no stream bytes after header).
      const buf = new Uint8Array([0x10, 0x3f]);
      expect(() => readWeightsFSE(buf, 0, 2)).toThrow(/no stream after header/i);
    });

    it('throws when stream has invalid end marker (last byte zero)', () => {
      // 3 bytes: 2-byte ncount header + 1 stream byte. If stream last byte is 0, invalid.
      // We need readNCount to read exactly 2 bytes. Example from fse.test: [0x10, 0x3f, 0x01] gives bytesRead 2.
      // So [0x10, 0x3f, 0x00] = 2 byte header + stream [0x00], lastByte=0 -> invalid end marker
      const buf = new Uint8Array([0x10, 0x3f, 0x00]);
      expect(() => readWeightsFSE(buf, 0, 3)).toThrow(/invalid end marker/i);
    });
  });
});
