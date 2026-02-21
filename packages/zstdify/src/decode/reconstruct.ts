/**
 * Sequence execution: copy literals + match copies with window.
 */

import { ZstdError } from '../errors.js';

export interface Sequence {
  literalsLength: number;
  offset: number; // Offset_Value from sequence decode.
  matchLength: number;
}

export interface HistoryWindow {
  buffer: Uint8Array;
  length: number;
  writePos: number;
}

export function createHistoryWindow(windowSize: number, initial?: Uint8Array): HistoryWindow {
  if (windowSize <= 0) {
    return { buffer: new Uint8Array(0), length: 0, writePos: 0 };
  }
  const buffer = new Uint8Array(windowSize);
  const history: HistoryWindow = { buffer, length: 0, writePos: 0 };
  if (initial && initial.length > 0) {
    appendToHistoryWindow(history, initial);
  }
  return history;
}

export function appendToHistoryWindow(history: HistoryWindow, chunk: Uint8Array): void {
  const cap = history.buffer.length;
  if (cap === 0 || chunk.length === 0) {
    return;
  }
  if (chunk.length >= cap) {
    const tail = chunk.subarray(chunk.length - cap);
    history.buffer.set(tail, 0);
    history.length = cap;
    history.writePos = 0;
    return;
  }
  const firstLen = Math.min(chunk.length, cap - history.writePos);
  history.buffer.set(chunk.subarray(0, firstLen), history.writePos);
  const remaining = chunk.length - firstLen;
  if (remaining > 0) {
    history.buffer.set(chunk.subarray(firstLen), 0);
  }
  history.writePos = (history.writePos + chunk.length) % cap;
  history.length = Math.min(cap, history.length + chunk.length);
}

function readHistoryByte(history: HistoryWindow, indexFromOldest: number): number {
  const cap = history.buffer.length;
  if (cap === 0 || indexFromOldest < 0 || indexFromOldest >= history.length) {
    throw new ZstdError('Invalid history read', 'corruption_detected');
  }
  const oldestPos = (history.writePos - history.length + cap) % cap;
  return history.buffer[(oldestPos + indexFromOldest) % cap]!;
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
  history: HistoryWindow = { buffer: new Uint8Array(0), length: 0, writePos: 0 },
): Uint8Array {
  // Sequence literals are slices of `literals`, so only matches expand output size.
  const totalSize = literals.length + sequences.reduce((s, seq) => s + seq.matchLength, 0);
  const historyLength = history.length;
  const buffer = new Uint8Array(totalSize);
  let outPos = 0;
  let litPos = 0;

  for (const seq of sequences) {
    for (let i = 0; i < seq.literalsLength; i++) {
      if (litPos >= literals.length) {
        throw new ZstdError('Literals overrun while executing sequence', 'corruption_detected');
      }
      buffer[outPos++] = literals[litPos++]!;
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
      offset = repOffsets[repeatIndex]!;
    }
    const produced = outPos;
    const maxReachBack = produced <= windowSize ? produced + historyLength : windowSize;
    if (offset <= 0 || offset > maxReachBack) {
      throw new ZstdError(
        `Invalid match offset: offset=${offset} maxReachBack=${maxReachBack} produced=${produced} history=${historyLength} window=${windowSize}`,
        'corruption_detected',
      );
    }
    for (let i = 0; i < seq.matchLength; i++) {
      const srcIndex = outPos - offset;
      if (srcIndex >= 0) {
        buffer[outPos] = buffer[srcIndex]!;
      } else {
        const historyIndex = historyLength + srcIndex;
        buffer[outPos] = readHistoryByte(history, historyIndex);
      }
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
    buffer[outPos++] = literals[litPos++]!;
  }
  return outPos === buffer.length ? buffer : buffer.subarray(0, outPos);
}
