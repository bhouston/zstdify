/**
 * Read compressed weight streams for Huffman tree description.
 * Weights can be FSE-compressed or direct (4 bits per weight).
 */

import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { ZstdError } from '../errors.js';
import { buildFSEDecodeTable, decodeFSESymbol, readNCount } from './fse.js';

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
  const reader = new BitReaderReverse(stream, 0, streamLength);
  reader.skipPadding();

  const weights: number[] = [];
  let state1: { value: number };
  let state2: { value: number };

  try {
    state1 = { value: reader.readBits(tableLog) };
    state2 = { value: reader.readBits(tableLog) };
  } catch {
    throw new ZstdError('FSE-compressed weights: truncated initial states', 'corruption_detected');
  }

  while (weights.length < 255) {
    try {
      const sym1 = decodeFSESymbol(table, tableLog, reader, state1);
      weights.push(sym1);
    } catch {
      const tail = table[state2.value];
      if (tail) weights.push(tail.symbol);
      break;
    }
    if (weights.length >= 255) break;

    try {
      const sym2 = decodeFSESymbol(table, tableLog, reader, state2);
      weights.push(sym2);
    } catch {
      const tail = table[state1.value];
      if (tail) weights.push(tail.symbol);
      break;
    }
  }

  if (weights.length < 2) {
    throw new ZstdError('FSE-compressed weights: need at least 2 weights', 'corruption_detected');
  }

  return { weights, bytesRead: compressedSize };
}
