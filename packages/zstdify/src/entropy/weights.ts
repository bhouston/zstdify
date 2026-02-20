/**
 * Read compressed weight streams for Huffman tree description.
 * Weights can be FSE-compressed or direct (4 bits per weight).
 */

import { ZstdError } from '../errors.js';
import { buildFSEDecodeTable, readNCount } from './fse.js';

/**
 * Read Huffman weights from direct representation (headerByte >= 128).
 * Each weight is 4 bits, 2 per byte, first weight in high nibble.
 */
export function readWeightsDirect(
  data: Uint8Array,
  offset: number,
  numWeights: number,
): { weights: number[]; bytesRead: number } {
  const bytesNeeded = Math.ceil(numWeights / 2);
  if (offset + bytesNeeded > data.length) {
    throw new ZstdError('Huffman weights truncated', 'corruption_detected');
  }
  const weights: number[] = [];
  for (let i = 0; i < numWeights; i++) {
    const byteIdx = Math.floor(i / 2);
    const byte = data[offset + byteIdx];
    if (byte === undefined) throw new ZstdError('Huffman weights truncated', 'corruption_detected');
    const nibble = (i & 1) === 0 ? (byte >> 4) & 0xf : byte & 0xf;
    weights.push(nibble);
  }
  return { weights, bytesRead: bytesNeeded };
}

const MAX_WEIGHT_SYMBOL = 11;
const MAX_WEIGHT_TABLE_LOG = 7;

/**
 * Read Huffman weights from FSE-compressed stream.
 * Uses 2 interleaved FSE states decoding weight symbols (0-11).
 */
export function readWeightsFSE(
  data: Uint8Array,
  offset: number,
  compressedSize: number,
): { weights: number[]; bytesRead: number } {
  if (compressedSize < 2) {
    throw new ZstdError('FSE-compressed weights: need at least 2 bytes', 'corruption_detected');
  }
  if (offset + compressedSize > data.length) {
    throw new ZstdError('FSE-compressed weights truncated', 'corruption_detected');
  }

  const header = data.subarray(offset, offset + compressedSize);

  const { normalizedCounter, tableLog, bytesRead: ncountBytes } = readNCount(
    header,
    0,
    MAX_WEIGHT_SYMBOL,
    MAX_WEIGHT_TABLE_LOG,
  );

  const table = buildFSEDecodeTable(normalizedCounter, tableLog);
  const streamStart = ncountBytes;
  const streamLength = compressedSize - ncountBytes;

  if (streamLength <= 0) {
    throw new ZstdError('FSE-compressed weights: no stream after header', 'corruption_detected');
  }

  const stream = header.subarray(streamStart, streamStart + streamLength);
  const lastByte = stream[stream.length - 1] ?? 0;
  if (lastByte === 0) {
    throw new ZstdError('FSE-compressed weights: invalid end marker', 'corruption_detected');
  }
  const highestSetBit = 31 - Math.clz32(lastByte);
  const paddingBits = 8 - highestSetBit;
  let bitOffset = streamLength * 8 - paddingBits;

  const readBitsZeroExtended = (numBits: number): number => {
    if (numBits <= 0) return 0;
    bitOffset -= numBits;
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const abs = bitOffset + i;
      if (abs < 0) continue;
      const byteIndex = abs >>> 3;
      const bitInByte = abs & 7;
      const bit = ((stream[byteIndex] ?? 0) >>> bitInByte) & 1;
      value |= bit << i;
    }
    return value;
  };

  const weights: number[] = [];
  const state1 = { value: readBitsZeroExtended(tableLog) };
  const state2 = { value: readBitsZeroExtended(tableLog) };

  while (weights.length < 255) {
    const row1 = table[state1.value];
    if (!row1) throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
    weights.push(row1.symbol);
    state1.value = row1.baseline + readBitsZeroExtended(row1.numBits);
    if (bitOffset < 0) {
      const tail = table[state2.value];
      if (!tail) throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
      weights.push(tail.symbol);
      break;
    }
    if (weights.length >= 255) break;

    const row2 = table[state2.value];
    if (!row2) throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
    weights.push(row2.symbol);
    state2.value = row2.baseline + readBitsZeroExtended(row2.numBits);
    if (bitOffset < 0) {
      const tail = table[state1.value];
      if (!tail) throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
      weights.push(tail.symbol);
      break;
    }
  }

  if (weights.length < 2) {
    throw new ZstdError('FSE-compressed weights: need at least 2 weights', 'corruption_detected');
  }

  return { weights, bytesRead: compressedSize };
}
