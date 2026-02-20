/**
 * Sequence execution: copy literals + match copies with window.
 */

import { ZstdError } from '../errors.js';

export interface Sequence {
  literalsLength: number;
  offset: number;
  matchLength: number;
}

/**
 * Execute sequences to produce decompressed output.
 * repOffsets: [Repeated_Offset1, Repeated_Offset2, Repeated_Offset3], updated in place.
 */
export function executeSequences(
  literals: Uint8Array,
  sequences: Sequence[],
  windowSize: number,
  repOffsets: [number, number, number] = [1, 4, 8],
): Uint8Array {
  // Sequence literals are slices of `literals`, so only matches expand output size.
  const totalSize = literals.length + sequences.reduce((s, seq) => s + seq.matchLength, 0);
  const output = new Uint8Array(totalSize);
  let outPos = 0;
  let litPos = 0;

  for (const seq of sequences) {
    for (let i = 0; i < seq.literalsLength; i++) {
      output[outPos++] = literals[litPos++] ?? 0;
    }
    let offset: number;
    const ov = seq.offset;
    if (ov <= 3) {
      if (ov === 3 && seq.literalsLength === 0) {
        offset = repOffsets[0] - 1;
        if (offset === 0) {
          throw new ZstdError('Invalid match offset: repeat1-1 is 0', 'corruption_detected');
        }
      } else {
        offset = repOffsets[ov - 1] ?? 0;
      }
    } else {
      offset = ov;
    }
    if (offset > outPos || offset > windowSize) {
      throw new ZstdError('Invalid match offset', 'corruption_detected');
    }
    for (let i = 0; i < seq.matchLength; i++) {
      output[outPos] = output[outPos - offset] ?? 0;
      outPos++;
    }
    if (ov > 3 || (ov === 3 && seq.literalsLength === 0)) {
      repOffsets[2] = repOffsets[1];
      repOffsets[1] = repOffsets[0];
      repOffsets[0] = offset;
    } else {
      const used = repOffsets[ov - 1] ?? 0;
      if (ov === 1) {
      } else if (ov === 2) {
        repOffsets[1] = repOffsets[0];
        repOffsets[0] = used;
      } else {
        repOffsets[2] = repOffsets[1];
        repOffsets[1] = repOffsets[0];
        repOffsets[0] = used;
      }
    }
  }
  while (litPos < literals.length) {
    output[outPos++] = literals[litPos++] ?? 0;
  }
  return output;
}
