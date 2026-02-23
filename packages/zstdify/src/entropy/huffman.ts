/**
 * Huffman decode: build decode table from weights, decode symbols.
 * Zstd Huffman streams are read backward.
 */

import type { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { ZstdError } from '../errors.js';

export interface HuffmanDecodeTable {
  symbol: Uint8Array;
  numBits: Uint8Array;
  maxNumBits: number;
  length: number;
}

/**
 * Convert weights to number of bits per symbol.
 * Weight = 0 means symbol not present. Weight 1 = least frequent, max weight = most frequent.
 * Number_of_Bits = Weight ? (Max_Number_of_Bits + 1 - Weight) : 0
 */
export function weightsToNumBits(weights: ArrayLike<number>, maxNumBits: number): Uint8Array {
  const len = weights.length;
  const result = new Uint8Array(len);
  const scale = (maxNumBits + 1) | 0;
  for (let i = 0; i < len; i++) {
    const w = weights[i]!;
    result[i] = w ? (scale - w) : 0;
  }
  return result;
}

/**
 * Build Huffman decode table from symbol bit lengths.
 * Returns table indexed by prefix code (first maxNumBits bits).
 */
export function buildHuffmanDecodeTable(numBits: ArrayLike<number>, maxNumBits: number): HuffmanDecodeTable {
  const tableSize = 1 << maxNumBits;
  const symbolByPrefix = new Uint8Array(tableSize);
  const bitsByPrefix = new Uint8Array(tableSize);
  const rankLen = (maxNumBits + 1) | 0;
  const rankCount = new Uint32Array(rankLen);
  for (let s = 0; s < numBits.length; s++) {
    const len = numBits[s]! | 0;
    if (len < 0 || len > maxNumBits) {
      throw new ZstdError('Huffman invalid bit length', 'corruption_detected');
    }
    rankCount[len] = rankCount[len]! + 1;
  }

  const rankIdx = new Uint32Array(rankLen);
  rankIdx[maxNumBits] = 0;
  for (let len = maxNumBits; len >= 1; len--) {
    const current = rankIdx[len]!;
    rankIdx[len - 1] = current + rankCount[len]! * (1 << (maxNumBits - len));
  }
  if (rankIdx[0] !== tableSize) {
    throw new ZstdError('Huffman invalid tree', 'corruption_detected');
  }

  for (let symbol = 0; symbol < numBits.length; symbol++) {
    const len = numBits[symbol]! | 0;
    if (len === 0) continue;
    const code = rankIdx[len]!;
    const span = 1 << (maxNumBits - len);
    for (let i = 0; i < span; i++) {
      symbolByPrefix[code + i] = symbol;
      bitsByPrefix[code + i] = len;
    }
    rankIdx[len] = code + span;
  }

  return {
    symbol: symbolByPrefix,
    numBits: bitsByPrefix,
    maxNumBits,
    length: tableSize,
  };
}

/**
 * Decode one Huffman symbol. Reader must be positioned at start of code.
 */
export function decodeHuffmanSymbol(table: HuffmanDecodeTable, reader: BitReaderReverse): number {
  const maxNumBits = table.maxNumBits | 0;
  const peek = reader.readBits(maxNumBits) >>> 0;
  if (peek >= table.length) {
    throw new ZstdError('Huffman invalid code', 'corruption_detected');
  }
  const bits = table.numBits[peek]!;
  if (bits === 0) {
    throw new ZstdError('Huffman invalid code', 'corruption_detected');
  }
  const unread = (maxNumBits - bits) | 0;
  if (unread > 0) {
    reader.unreadBits(unread);
  }
  return table.symbol[peek]!;
}
