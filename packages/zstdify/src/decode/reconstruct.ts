/**
 * Sequence execution: copy literals + match copies with window.
 */

import { ZstdError } from '../errors.js';

export interface Sequence {
  literalsLength: number;
  offset: number; // Offset_Value from sequence decode.
  matchLength: number;
}

export interface PackedSequences {
  literalsLength: Uint32Array;
  offset: Uint32Array;
  matchLength: Uint32Array;
  length: number;
}

export interface HistoryWindow {
  buffer: Uint8Array;
  length: number;
  writePos: number;
}

const FAST_LITERAL_COPY_LOOP_THRESHOLD = 8;
const FAST_SMALL_OFFSET_LOOP_THRESHOLD = 16;
const FAST_HISTORY_COPY_LOOP_THRESHOLD = 16;

function isHistoryWindow(value: HistoryWindow | Uint8Array): value is HistoryWindow {
  return (
    typeof (value as HistoryWindow).length === 'number' &&
    typeof (value as HistoryWindow).writePos === 'number' &&
    (value as HistoryWindow).buffer instanceof Uint8Array
  );
}

export function createHistoryWindow(windowSize: number, initial?: Uint8Array): HistoryWindow {
  const initialLength = initial?.length ?? 0;
  const capacity = Math.max(windowSize, initialLength);
  if (capacity <= 0) {
    return { buffer: new Uint8Array(0), length: 0, writePos: 0 };
  }
  const buffer = new Uint8Array(capacity);
  const history: HistoryWindow = { buffer, length: 0, writePos: 0 };
  if (initialLength > 0 && initial) {
    appendToHistoryWindow(history, initial);
  }
  return history;
}

/** Internal: reuse bag for decoder context. */
export interface DecoderReuseBag {
  _history?: HistoryWindow;
  _sequences?: PackedSequences;
}

function createPackedSequences(capacity: number): PackedSequences {
  return {
    literalsLength: new Uint32Array(capacity),
    offset: new Uint32Array(capacity),
    matchLength: new Uint32Array(capacity),
    length: 0,
  };
}

export function ensurePackedSequencesCapacity(
  existing: PackedSequences | undefined,
  minLength: number,
): PackedSequences {
  if (existing && existing.literalsLength.length >= minLength) {
    existing.length = minLength;
    return existing;
  }
  let capacity = existing?.literalsLength.length ?? 0;
  if (capacity === 0) {
    capacity = 16;
  }
  while (capacity < minLength) {
    capacity *= 2;
  }
  return createPackedSequences(capacity);
}

export function packSequences(sequences: readonly Sequence[], reuse?: PackedSequences): PackedSequences {
  const packed = ensurePackedSequencesCapacity(reuse, sequences.length);
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    if (!seq) {
      throw new ZstdError('Invalid sequence object', 'corruption_detected');
    }
    packed.literalsLength[i] = seq.literalsLength;
    packed.offset[i] = seq.offset;
    packed.matchLength[i] = seq.matchLength;
  }
  packed.length = sequences.length;
  return packed;
}

export function packedSequencesToArray(sequences: PackedSequences): Sequence[] {
  const out: Sequence[] = new Array(sequences.length);
  for (let i = 0; i < sequences.length; i++) {
    out[i] = {
      literalsLength: sequences.literalsLength[i] ?? 0,
      offset: sequences.offset[i] ?? 0,
      matchLength: sequences.matchLength[i] ?? 0,
    };
  }
  return out;
}

/**
 * Get or create a history window, reusing from bag when buffer is large enough.
 * Caller may pass a mutable bag; it will be updated with the history used.
 */
export function getOrCreateHistoryWindow(
  windowSize: number,
  initial: Uint8Array | undefined,
  reuse: DecoderReuseBag | undefined,
): HistoryWindow {
  const existing = reuse?._history;
  if (existing && existing.buffer.length >= windowSize) {
    existing.length = 0;
    existing.writePos = 0;
    if (initial && initial.length > 0) {
      appendToHistoryWindow(existing, initial);
    }
    return existing;
  }
  const history = createHistoryWindow(windowSize, initial);
  if (reuse) {
    reuse._history = history;
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

const APPEND_RANGE_LOOP_THRESHOLD = 16;

export function appendRangeToHistoryWindow(
  history: HistoryWindow,
  source: Uint8Array,
  start: number,
  length: number,
): void {
  const cap = history.buffer.length;
  if (cap === 0 || length <= 0) {
    return;
  }
  if (start < 0 || length < 0 || start + length > source.length) {
    throw new RangeError('Invalid source range for history append');
  }
  if (length >= cap) {
    const tailStart = start + length - cap;
    history.buffer.set(source.subarray(tailStart, start + length), 0);
    history.length = cap;
    history.writePos = 0;
    return;
  }
  const firstLen = Math.min(length, cap - history.writePos);
  const remaining = length - firstLen;
  if (length <= APPEND_RANGE_LOOP_THRESHOLD) {
    let wp = history.writePos;
    for (let i = 0; i < length; i++) {
      history.buffer[wp] = source[start + i]!;
      wp = wp + 1 === cap ? 0 : wp + 1;
    }
  } else {
    history.buffer.set(source.subarray(start, start + firstLen), history.writePos);
    if (remaining > 0) {
      history.buffer.set(source.subarray(start + firstLen, start + firstLen + remaining), 0);
    }
  }
  history.writePos = (history.writePos + length) % cap;
  history.length = Math.min(cap, history.length + length);
}

export function appendRLEToHistoryWindow(history: HistoryWindow, byte: number, length: number): void {
  const cap = history.buffer.length;
  if (cap === 0 || length <= 0) {
    return;
  }
  const fillByte = byte & 0xff;
  if (length >= cap) {
    history.buffer.fill(fillByte, 0, cap);
    history.length = cap;
    history.writePos = 0;
    return;
  }
  const firstLen = Math.min(length, cap - history.writePos);
  history.buffer.fill(fillByte, history.writePos, history.writePos + firstLen);
  const remaining = length - firstLen;
  if (remaining > 0) {
    history.buffer.fill(fillByte, 0, remaining);
  }
  history.writePos = (history.writePos + length) % cap;
  history.length = Math.min(cap, history.length + length);
}

export function executeSequencesInto(
  literals: Uint8Array,
  sequences: PackedSequences,
  windowSize: number,
  target: Uint8Array,
  targetOffset: number,
  repOffsets: [number, number, number] = [1, 4, 8],
  historyInput: HistoryWindow | Uint8Array = { buffer: new Uint8Array(0), length: 0, writePos: 0 },
  updateHistory = false,
): number {
  const history = isHistoryWindow(historyInput) ? historyInput : createHistoryWindow(windowSize, historyInput);
  const historyLength = history.length;
  const historyCap = history.buffer.length;
  const historyOldestPos = historyCap > 0 ? (history.writePos - historyLength + historyCap) % historyCap : 0;
  const historyBuffer = history.buffer;
  let outPos = targetOffset;
  let litPos = 0;
  const LIT_COPY_LOOP_THRESHOLD = 16;
  const HISTORY_COPY_LOOP_THRESHOLD = 16;
  const seqCount = sequences.length;
  const literalsLengthBySeq = sequences.literalsLength;
  const offsetBySeq = sequences.offset;
  const matchLengthBySeq = sequences.matchLength;

  for (let seqIndex = 0; seqIndex < seqCount; seqIndex++) {
    const seqLiteralsLength = literalsLengthBySeq[seqIndex]!;
    if (seqLiteralsLength > 0) {
      const litOutStart = outPos;
      const litEnd = litPos + seqLiteralsLength;
      if (litEnd > literals.length) {
        throw new ZstdError('Literals overrun while executing sequence', 'corruption_detected');
      }
      if (seqLiteralsLength <= LIT_COPY_LOOP_THRESHOLD) {
        for (let i = 0; i < seqLiteralsLength; i++) {
          target[outPos + i] = literals[litPos + i]!;
        }
      } else {
        target.set(literals.subarray(litPos, litEnd), outPos);
      }
      outPos += seqLiteralsLength;
      litPos = litEnd;
      if (updateHistory) {
        appendRangeToHistoryWindow(history, target, litOutStart, seqLiteralsLength);
      }
    }
    const ov = offsetBySeq[seqIndex]!; // Offset_Value from sequence decode.
    const ll0 = seqLiteralsLength === 0;
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
    const produced = outPos - targetOffset;
    const maxReachBack = Math.min(windowSize, produced + historyLength);
    if (offset <= 0 || offset > maxReachBack) {
      throw new ZstdError(
        `Invalid match offset: offset=${offset} maxReachBack=${maxReachBack} produced=${produced} history=${historyLength} window=${windowSize}`,
        'corruption_detected',
      );
    }
    let remainingMatch = matchLengthBySeq[seqIndex]!;
    const historyBytesNeeded = Math.max(0, offset - produced);
    if (historyBytesNeeded > 0) {
      if (historyCap === 0) {
        throw new ZstdError('Invalid history read', 'corruption_detected');
      }
      const historyCopyLen = Math.min(historyBytesNeeded, remainingMatch);
      const historyStart = historyLength - historyBytesNeeded;
      if (historyStart < 0 || historyStart + historyCopyLen > historyLength) {
        throw new ZstdError('Invalid history read', 'corruption_detected');
      }
      let physicalStart = historyOldestPos + historyStart;
      if (physicalStart >= historyCap) {
        physicalStart -= historyCap;
      }
      const firstHistoryChunk = Math.min(historyCopyLen, historyCap - physicalStart);
      const remainingHistoryChunk = historyCopyLen - firstHistoryChunk;
      const historyOutStart = outPos;
      if (historyCopyLen <= HISTORY_COPY_LOOP_THRESHOLD) {
        let phys = physicalStart;
        for (let i = 0; i < historyCopyLen; i++) {
          target[outPos + i] = historyBuffer[phys]!;
          phys = phys + 1 === historyCap ? 0 : phys + 1;
        }
        outPos += historyCopyLen;
      } else {
        target.set(historyBuffer.subarray(physicalStart, physicalStart + firstHistoryChunk), outPos);
        outPos += firstHistoryChunk;
        if (remainingHistoryChunk > 0) {
          target.set(historyBuffer.subarray(0, remainingHistoryChunk), outPos);
          outPos += remainingHistoryChunk;
        }
      }
      if (updateHistory) {
        appendRangeToHistoryWindow(history, target, historyOutStart, historyCopyLen);
      }
      remainingMatch -= historyCopyLen;
    }
    if (remainingMatch > 0) {
      const matchOutStart = outPos;
      const copyStart = outPos - offset;
      if (offset >= remainingMatch) {
        target.copyWithin(outPos, copyStart, copyStart + remainingMatch);
        outPos += remainingMatch;
      } else {
        // Handle overlapping copies with exponentially growing chunks.
        let copied = offset;
        target.copyWithin(outPos, copyStart, copyStart + copied);
        outPos += copied;
        while (copied < remainingMatch) {
          const toCopy = Math.min(copied, remainingMatch - copied);
          target.copyWithin(outPos, outPos - copied, outPos - copied + toCopy);
          outPos += toCopy;
          copied += toCopy;
        }
      }
      if (updateHistory) {
        appendRangeToHistoryWindow(history, target, matchOutStart, remainingMatch);
      }
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
  if (litPos < literals.length) {
    const tailOutStart = outPos;
    const remaining = literals.length - litPos;
    if (remaining <= LIT_COPY_LOOP_THRESHOLD) {
      for (let i = 0; i < remaining; i++) {
        target[outPos + i] = literals[litPos + i]!;
      }
    } else {
      target.set(literals.subarray(litPos), outPos);
    }
    outPos += remaining;
    if (updateHistory) {
      appendRangeToHistoryWindow(history, target, tailOutStart, remaining);
    }
  }
  return outPos - targetOffset;
}

export function executeSequencesIntoFast(
  literals: Uint8Array,
  sequences: PackedSequences,
  windowSize: number,
  target: Uint8Array,
  targetOffset: number,
  repOffsets: [number, number, number] = [1, 4, 8],
  historyInput: HistoryWindow | Uint8Array = { buffer: new Uint8Array(0), length: 0, writePos: 0 },
  updateHistory = false,
): number {
  const history = isHistoryWindow(historyInput) ? historyInput : createHistoryWindow(windowSize, historyInput);
  if (history.length === 0) {
    return executeSequencesIntoFastNoHistory(
      literals,
      sequences,
      windowSize,
      target,
      targetOffset,
      repOffsets,
      history,
      updateHistory,
    );
  }
  const historyLength = history.length;
  const historyCap = history.buffer.length;
  const historyOldestPos = historyCap > 0 ? (history.writePos - historyLength + historyCap) % historyCap : 0;
  const historyBuffer = history.buffer;

  let outPos = targetOffset;
  let litPos = 0;
  const seqCount = sequences.length;
  const literalsLengthBySeq = sequences.literalsLength;
  const offsetBySeq = sequences.offset;
  const matchLengthBySeq = sequences.matchLength;
  let rep0 = repOffsets[0];
  let rep1 = repOffsets[1];
  let rep2 = repOffsets[2];

  for (let seqIndex = 0; seqIndex < seqCount; seqIndex++) {
    const seqLiteralsLength = literalsLengthBySeq[seqIndex]!;
    if (seqLiteralsLength > 0) {
      const litEnd = litPos + seqLiteralsLength;
      if (litEnd > literals.length) {
        throw new ZstdError('Literals overrun while executing sequence', 'corruption_detected');
      }
      if (seqLiteralsLength <= FAST_LITERAL_COPY_LOOP_THRESHOLD) {
        for (let i = 0; i < seqLiteralsLength; i++) {
          target[outPos + i] = literals[litPos + i]!;
        }
      } else {
        target.set(literals.subarray(litPos, litEnd), outPos);
      }
      outPos += seqLiteralsLength;
      litPos = litEnd;
    }

    const ov = offsetBySeq[seqIndex]!;
    const ll0 = seqLiteralsLength === 0;
    let offset: number;
    let repeatIndex: 0 | 1 | 2 | null = null;
    const isNonRepeat = ov > 3 || (ov === 3 && ll0);
    if (isNonRepeat) {
      if (ov === 3) {
        offset = rep0 - 1;
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
      offset = repeatIndex === 0 ? rep0 : repeatIndex === 1 ? rep1 : rep2;
    }

    const produced = outPos - targetOffset;
    const producedPlusHistory = produced + historyLength;
    const maxReachBack = producedPlusHistory < windowSize ? producedPlusHistory : windowSize;
    if (offset <= 0 || offset > maxReachBack) {
      throw new ZstdError(
        `Invalid match offset: offset=${offset} maxReachBack=${maxReachBack} produced=${produced} history=${historyLength} window=${windowSize}`,
        'corruption_detected',
      );
    }

    const remainingMatch = matchLengthBySeq[seqIndex]!;
    const historyBytesNeeded = offset > produced ? offset - produced : 0;
    if (remainingMatch > 0) {
      if (historyBytesNeeded === 0) {
        const copyStart = outPos - offset;
        if (offset >= remainingMatch) {
          target.copyWithin(outPos, copyStart, copyStart + remainingMatch);
          outPos += remainingMatch;
        } else if (offset <= FAST_SMALL_OFFSET_LOOP_THRESHOLD) {
          for (let i = 0; i < remainingMatch; i++) {
            target[outPos + i] = target[outPos - offset + i]!;
          }
          outPos += remainingMatch;
        } else {
          let copied = offset;
          target.copyWithin(outPos, copyStart, copyStart + copied);
          outPos += copied;
          while (copied < remainingMatch) {
            const toCopy = Math.min(copied, remainingMatch - copied);
            target.copyWithin(outPos, outPos - copied, outPos - copied + toCopy);
            outPos += toCopy;
            copied += toCopy;
          }
        }
      } else {
        if (historyCap === 0) {
          throw new ZstdError('Invalid history read', 'corruption_detected');
        }
        const historyCopyLen = Math.min(historyBytesNeeded, remainingMatch);
        const historyStart = historyLength - historyBytesNeeded;
        if (historyStart < 0 || historyStart + historyCopyLen > historyLength) {
          throw new ZstdError('Invalid history read', 'corruption_detected');
        }
        let physicalStart = historyOldestPos + historyStart;
        if (physicalStart >= historyCap) {
          physicalStart -= historyCap;
        }
        const firstHistoryChunk = Math.min(historyCopyLen, historyCap - physicalStart);
        const remainingHistoryChunk = historyCopyLen - firstHistoryChunk;
        if (historyCopyLen <= FAST_HISTORY_COPY_LOOP_THRESHOLD) {
          let phys = physicalStart;
          for (let i = 0; i < historyCopyLen; i++) {
            target[outPos + i] = historyBuffer[phys]!;
            phys = phys + 1 === historyCap ? 0 : phys + 1;
          }
          outPos += historyCopyLen;
        } else {
          target.set(historyBuffer.subarray(physicalStart, physicalStart + firstHistoryChunk), outPos);
          outPos += firstHistoryChunk;
          if (remainingHistoryChunk > 0) {
            target.set(historyBuffer.subarray(0, remainingHistoryChunk), outPos);
            outPos += remainingHistoryChunk;
          }
        }

        const matchRemaining = remainingMatch - historyCopyLen;
        if (matchRemaining > 0) {
          const copyStart = outPos - offset;
          if (offset >= matchRemaining) {
            target.copyWithin(outPos, copyStart, copyStart + matchRemaining);
            outPos += matchRemaining;
          } else if (offset <= FAST_SMALL_OFFSET_LOOP_THRESHOLD) {
            for (let i = 0; i < matchRemaining; i++) {
              target[outPos + i] = target[outPos - offset + i]!;
            }
            outPos += matchRemaining;
          } else {
            let copied = offset;
            target.copyWithin(outPos, copyStart, copyStart + copied);
            outPos += copied;
            while (copied < matchRemaining) {
              const toCopy = Math.min(copied, matchRemaining - copied);
              target.copyWithin(outPos, outPos - copied, outPos - copied + toCopy);
              outPos += toCopy;
              copied += toCopy;
            }
          }
        }
      }
    }

    if (isNonRepeat) {
      rep2 = rep1;
      rep1 = rep0;
      rep0 = offset;
    } else if (repeatIndex === 1) {
      rep1 = rep0;
      rep0 = offset;
    } else if (repeatIndex === 2) {
      rep2 = rep1;
      rep1 = rep0;
      rep0 = offset;
    }
  }

  if (litPos < literals.length) {
    const remaining = literals.length - litPos;
    if (remaining <= FAST_LITERAL_COPY_LOOP_THRESHOLD) {
      for (let i = 0; i < remaining; i++) {
        target[outPos + i] = literals[litPos + i]!;
      }
      outPos += remaining;
    } else {
      target.set(literals.subarray(litPos), outPos);
      outPos += remaining;
    }
  }

  if (updateHistory && outPos > targetOffset) {
    appendRangeToHistoryWindow(history, target, targetOffset, outPos - targetOffset);
  }

  repOffsets[0] = rep0;
  repOffsets[1] = rep1;
  repOffsets[2] = rep2;

  return outPos - targetOffset;
}

function executeSequencesIntoFastNoHistory(
  literals: Uint8Array,
  sequences: PackedSequences,
  windowSize: number,
  target: Uint8Array,
  targetOffset: number,
  repOffsets: [number, number, number],
  history: HistoryWindow,
  updateHistory: boolean,
): number {
  let outPos = targetOffset;
  let litPos = 0;
  const seqCount = sequences.length;
  const literalsLengthBySeq = sequences.literalsLength;
  const offsetBySeq = sequences.offset;
  const matchLengthBySeq = sequences.matchLength;
  let rep0 = repOffsets[0];
  let rep1 = repOffsets[1];
  let rep2 = repOffsets[2];

  for (let seqIndex = 0; seqIndex < seqCount; seqIndex++) {
    const seqLiteralsLength = literalsLengthBySeq[seqIndex]!;
    if (seqLiteralsLength > 0) {
      const litEnd = litPos + seqLiteralsLength;
      if (litEnd > literals.length) {
        throw new ZstdError('Literals overrun while executing sequence', 'corruption_detected');
      }
      if (seqLiteralsLength <= FAST_LITERAL_COPY_LOOP_THRESHOLD) {
        for (let i = 0; i < seqLiteralsLength; i++) {
          target[outPos + i] = literals[litPos + i]!;
        }
      } else {
        target.set(literals.subarray(litPos, litEnd), outPos);
      }
      outPos += seqLiteralsLength;
      litPos = litEnd;
    }

    const ov = offsetBySeq[seqIndex]!;
    const ll0 = seqLiteralsLength === 0;
    let offset: number;
    let repeatIndex: 0 | 1 | 2 | null = null;
    const isNonRepeat = ov > 3 || (ov === 3 && ll0);
    if (isNonRepeat) {
      if (ov === 3) {
        offset = rep0 - 1;
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
      offset = repeatIndex === 0 ? rep0 : repeatIndex === 1 ? rep1 : rep2;
    }

    const produced = outPos - targetOffset;
    const maxReachBack = produced < windowSize ? produced : windowSize;
    if (offset <= 0 || offset > maxReachBack) {
      throw new ZstdError(
        `Invalid match offset: offset=${offset} maxReachBack=${maxReachBack} produced=${produced} history=0 window=${windowSize}`,
        'corruption_detected',
      );
    }

    const remainingMatch = matchLengthBySeq[seqIndex]!;
    if (remainingMatch > 0) {
      const copyStart = outPos - offset;
      if (offset >= remainingMatch) {
        target.copyWithin(outPos, copyStart, copyStart + remainingMatch);
        outPos += remainingMatch;
      } else if (offset <= FAST_SMALL_OFFSET_LOOP_THRESHOLD) {
        for (let i = 0; i < remainingMatch; i++) {
          target[outPos + i] = target[outPos - offset + i]!;
        }
        outPos += remainingMatch;
      } else {
        let copied = offset;
        target.copyWithin(outPos, copyStart, copyStart + copied);
        outPos += copied;
        while (copied < remainingMatch) {
          const toCopy = Math.min(copied, remainingMatch - copied);
          target.copyWithin(outPos, outPos - copied, outPos - copied + toCopy);
          outPos += toCopy;
          copied += toCopy;
        }
      }
    }

    if (isNonRepeat) {
      rep2 = rep1;
      rep1 = rep0;
      rep0 = offset;
    } else if (repeatIndex === 1) {
      rep1 = rep0;
      rep0 = offset;
    } else if (repeatIndex === 2) {
      rep2 = rep1;
      rep1 = rep0;
      rep0 = offset;
    }
  }

  if (litPos < literals.length) {
    const remaining = literals.length - litPos;
    if (remaining <= FAST_LITERAL_COPY_LOOP_THRESHOLD) {
      for (let i = 0; i < remaining; i++) {
        target[outPos + i] = literals[litPos + i]!;
      }
      outPos += remaining;
    } else {
      target.set(literals.subarray(litPos), outPos);
      outPos += remaining;
    }
  }

  if (updateHistory && outPos > targetOffset) {
    appendRangeToHistoryWindow(history, target, targetOffset, outPos - targetOffset);
  }

  repOffsets[0] = rep0;
  repOffsets[1] = rep1;
  repOffsets[2] = rep2;

  return outPos - targetOffset;
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
  historyInput: HistoryWindow | Uint8Array = { buffer: new Uint8Array(0), length: 0, writePos: 0 },
): Uint8Array {
  const packed = packSequences(sequences);
  // Sequence literals are slices of `literals`, so only matches expand output size.
  let totalSize = literals.length;
  for (let i = 0; i < packed.length; i++) {
    totalSize += packed.matchLength[i]!;
  }
  const buffer = new Uint8Array(totalSize);
  const outSize = executeSequencesInto(literals, packed, windowSize, buffer, 0, repOffsets, historyInput);
  const outPos = outSize;
  return outPos === buffer.length ? buffer : buffer.subarray(0, outPos);
}
