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
export function weightsToNumBits(weights: readonly number[], maxNumBits: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    result.push(w ? maxNumBits + 1 - w : 0);
  }
  return result;
}

/**
 * Build Huffman decode table from symbol bit lengths.
 * Returns table indexed by prefix code (first maxNumBits bits).
 */
export function buildHuffmanDecodeTable(numBits: readonly number[], maxNumBits: number): HuffmanDecodeTable {
  const tableSize = 1 << maxNumBits;
  const symbolByPrefix = new Uint8Array(tableSize);
  const bitsByPrefix = new Uint8Array(tableSize);
  const rankCount = new Array<number>(maxNumBits + 1).fill(0);
  for (let s = 0; s < numBits.length; s++) {
    const len = numBits[s] ?? 0;
    if (len < 0 || len > maxNumBits) {
      throw new ZstdError('Huffman invalid bit length', 'corruption_detected');
    }
    rankCount[len] = (rankCount[len] ?? 0) + 1;
  }

  const rankIdx = new Array<number>(maxNumBits + 1).fill(0);
  rankIdx[maxNumBits] = 0;
  for (let len = maxNumBits; len >= 1; len--) {
    const current = rankIdx[len] ?? 0;
    rankIdx[len - 1] = current + (rankCount[len] ?? 0) * (1 << (maxNumBits - len));
  }
  if (rankIdx[0] !== tableSize) {
    throw new ZstdError('Huffman invalid tree', 'corruption_detected');
  }

  for (let symbol = 0; symbol < numBits.length; symbol++) {
    const len = numBits[symbol] ?? 0;
    if (len === 0) continue;
    const code = rankIdx[len] ?? 0;
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
  const maxNumBits = table.maxNumBits;
  const peek = reader.readBits(maxNumBits);
  if (peek < 0 || peek >= table.length) {
    throw new ZstdError('Huffman invalid code', 'corruption_detected');
  }
  const bits = table.numBits[peek]!;
  if (bits === 0) {
    throw new ZstdError('Huffman invalid code', 'corruption_detected');
  }
  const unread = maxNumBits - bits;
  if (unread > 0) {
    reader.unreadBits(unread);
  }
  return table.symbol[peek]!;
}
