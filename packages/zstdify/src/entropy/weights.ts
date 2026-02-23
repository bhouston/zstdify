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
): { weights: Uint8Array; bytesRead: number } {
  const bytesNeeded = (numWeights + 1) >>> 1;
  if (offset + bytesNeeded > data.length) {
    throw new ZstdError('Huffman weights truncated', 'corruption_detected');
  }
  const weights = new Uint8Array(numWeights);
  for (let i = 0; i < numWeights; i++) {
    const byteIdx = i >>> 1;
    const byte = data[offset + byteIdx]!;
    weights[i] = (i & 1) === 0 ? (byte >>> 4) & 0xf : byte & 0xf;
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
): { weights: Uint8Array; bytesRead: number } {
  if (compressedSize < 2) {
    throw new ZstdError('FSE-compressed weights: need at least 2 bytes', 'corruption_detected');
  }
  if (offset + compressedSize > data.length) {
    throw new ZstdError('FSE-compressed weights truncated', 'corruption_detected');
  }

  const header = data.subarray(offset, offset + compressedSize);

  const {
    normalizedCounter,
    tableLog,
    bytesRead: ncountBytes,
  } = readNCount(header, 0, MAX_WEIGHT_SYMBOL, MAX_WEIGHT_TABLE_LOG);

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
      value |= ((stream[byteIndex]! >>> bitInByte) & 1) << i;
    }
    return value;
  };

  const weights = new Uint8Array(255);
  let weightIdx = 0;
  const state1 = { value: readBitsZeroExtended(tableLog) };
  const state2 = { value: readBitsZeroExtended(tableLog) };

  while (weightIdx < 255) {
    if (state1.value < 0 || state1.value >= table.length) {
      throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
    }
    const sym1 = table.symbol[state1.value]!;
    const bits1 = table.numBits[state1.value]!;
    const baseline1 = table.baseline[state1.value]!;
    weights[weightIdx++] = sym1;
    state1.value = baseline1 + readBitsZeroExtended(bits1);
    if (bitOffset < 0) {
      if (state2.value < 0 || state2.value >= table.length) {
        throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
      }
      weights[weightIdx++] = table.symbol[state2.value]!;
      break;
    }
    if (weightIdx >= 255) break;

    if (state2.value < 0 || state2.value >= table.length) {
      throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
    }
    const sym2 = table.symbol[state2.value]!;
    const bits2 = table.numBits[state2.value]!;
    const baseline2 = table.baseline[state2.value]!;
    weights[weightIdx++] = sym2;
    state2.value = baseline2 + readBitsZeroExtended(bits2);
    if (bitOffset < 0) {
      if (state1.value < 0 || state1.value >= table.length) {
        throw new ZstdError('FSE-compressed weights: invalid state', 'corruption_detected');
      }
      weights[weightIdx++] = table.symbol[state1.value]!;
      break;
    }
  }

  if (weightIdx < 2) {
    throw new ZstdError('FSE-compressed weights: need at least 2 weights', 'corruption_detected');
  }

  return { weights: weights.subarray(0, weightIdx), bytesRead: compressedSize };
}
