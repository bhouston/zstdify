import { describe, expect, it } from 'vitest';
import { encodeReverseBitstream, ReverseBitWriter } from './reverseBitWriter.js';

function encodeReverseBitstreamReference(bitCounts: ArrayLike<number>, bitValues: ArrayLike<number>): Uint8Array {
  let bitLength = 1; // End marker.
  for (let i = 0; i < bitCounts.length; i++) {
    bitLength += bitCounts[i] ?? 0;
  }
  const out = new Uint8Array((bitLength + 7) >>> 3);
  let bitPos = 0;
  const writeBitsLSB = (n: number, value: number): void => {
    for (let i = 0; i < n; i++) {
      if (((value >>> i) & 1) !== 0) {
        out[bitPos >>> 3] = (out[bitPos >>> 3]! | (1 << (bitPos & 7))) & 0xff;
      }
      bitPos++;
    }
  };
  for (let i = bitCounts.length - 1; i >= 0; i--) {
    const n = bitCounts[i] ?? 0;
    if (n > 0) writeBitsLSB(n, bitValues[i] ?? 0);
  }
  out[bitPos >>> 3] = (out[bitPos >>> 3]! | (1 << (bitPos & 7))) & 0xff;
  return out;
}

describe('encodeReverseBitstream', () => {
  it('matches reference output for mixed-width values', () => {
    const bitCounts = new Uint8Array([3, 0, 5, 1, 8, 13, 2, 9]);
    const bitValues = new Uint32Array([5, 0, 0b11101, 1, 0xab, 0x1a2b, 2, 0x1ff]);
    expect(encodeReverseBitstream(bitCounts, bitValues)).toEqual(encodeReverseBitstreamReference(bitCounts, bitValues));
  });

  it('handles larger batches and chunked writes correctly', () => {
    const bitCounts = new Uint8Array(4096);
    const bitValues = new Uint32Array(4096);
    for (let i = 0; i < bitCounts.length; i++) {
      const width = (i % 28) + 1;
      bitCounts[i] = width;
      bitValues[i] = width === 28 ? 0x0fff_ffff : ((1 << width) - 1) >>> 0;
    }
    expect(encodeReverseBitstream(bitCounts, bitValues)).toEqual(encodeReverseBitstreamReference(bitCounts, bitValues));
  });

  it('supports explicit writer reuse across a single encode run', () => {
    const writer = new ReverseBitWriter();
    const countsA = new Uint8Array([3, 1, 5, 7]);
    const valuesA = new Uint32Array([0b101, 1, 0b11010, 0b1010110]);
    const countsB = new Uint8Array([8, 0, 4, 2, 6]);
    const valuesB = new Uint32Array([0xaa, 0, 0x5, 0x3, 0x2d]);

    expect(encodeReverseBitstream(countsA, valuesA, writer)).toEqual(encodeReverseBitstreamReference(countsA, valuesA));
    expect(encodeReverseBitstream(countsB, valuesB, writer)).toEqual(encodeReverseBitstreamReference(countsB, valuesB));
  });

  it('is re-entrant safe when nested encode happens during iteration', () => {
    const nestedCounts = new Uint8Array([5, 3, 2]);
    const nestedValues = new Uint32Array([0b11001, 0b111, 0b10]);
    const counts = [6, 4, 3, 1];
    const values = [0b101011, 0b1100, 0b101, 1];
    let triggered = false;

    const reentrantCounts = new Proxy(counts, {
      get(target, prop, receiver) {
        if (prop === '2' && !triggered) {
          triggered = true;
          encodeReverseBitstream(nestedCounts, nestedValues);
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const output = encodeReverseBitstream(reentrantCounts, values);
    expect(output).toEqual(encodeReverseBitstreamReference(counts, values));
    expect(triggered).toBe(true);
  });
});
