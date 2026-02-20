/**
 * Sequence execution: copy literals + match copies with window.
 */

import { ZstdError } from '../errors.js';

export interface Sequence {
  literalsLength: number;
  offset: number; // Offset_Value from sequence decode.
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
  history: Uint8Array = new Uint8Array(0),
): Uint8Array {
  // Sequence literals are slices of `literals`, so only matches expand output size.
  const totalSize = literals.length + sequences.reduce((s, seq) => s + seq.matchLength, 0);
  const historyLength = history.length;
  const buffer = new Uint8Array(historyLength + totalSize);
  if (historyLength > 0) {
    buffer.set(history, 0);
  }
  let outPos = historyLength;
  let litPos = 0;

  for (const seq of sequences) {
    for (let i = 0; i < seq.literalsLength; i++) {
      buffer[outPos++] = literals[litPos++] ?? 0;
    }
    const ov = seq.offset; // Offset_Value from sequence decode.
    const ll0 = seq.literalsLength === 0;
    let offset: number;
    let repeatIndex: 0 | 1 | 2 | null = null;
    const isNonRepeat = ov > 3 || (ov === 3 && ll0);
    if (isNonRepeat) {
      if (ov === 3) {
        offset = repOffsets[0] - 1;
        if (offset === 0) {
          throw new ZstdError('Invalid match offset: repeat1-1 is 0', 'corruption_detected');
        }
      } else {
        offset = ov - 3;
      }
    } else {
      if (ll0) {
        repeatIndex = ov === 1 ? 1 : 2;
      } else {
        repeatIndex = (ov - 1) as 0 | 1 | 2;
      }
      offset = repOffsets[repeatIndex] ?? 0;
    }
    const produced = outPos - historyLength;
    const maxReachBack = produced <= windowSize ? produced + historyLength : windowSize;
    if (offset <= 0 || offset > maxReachBack) {
      throw new ZstdError('Invalid match offset', 'corruption_detected');
    }
    for (let i = 0; i < seq.matchLength; i++) {
      buffer[outPos] = buffer[outPos - offset] ?? 0;
      outPos++;
    }
    if (isNonRepeat) {
      repOffsets[2] = repOffsets[1];
      repOffsets[1] = repOffsets[0];
      repOffsets[0] = offset;
    } else {
      // Move the used repeated offset to the front.
      if (repeatIndex === 1) {
        repOffsets[1] = repOffsets[0];
        repOffsets[0] = offset;
      } else if (repeatIndex === 2) {
        repOffsets[2] = repOffsets[1];
        repOffsets[1] = repOffsets[0];
        repOffsets[0] = offset;
      }
    }
  }
  while (litPos < literals.length) {
    buffer[outPos++] = literals[litPos++] ?? 0;
  }
  return buffer.subarray(historyLength, outPos).slice();
}
