/**
 * Huffman decode: build decode table from weights, decode symbols.
 * Zstd Huffman streams are read backward.
 */

import type { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { ZstdError } from '../errors.js';

export interface HuffmanDecodeRow {
  symbol: number;
  numBits: number;
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
export function buildHuffmanDecodeTable(numBits: readonly number[], maxNumBits: number): HuffmanDecodeRow[] {
  const tableSize = 1 << maxNumBits;
  const table: HuffmanDecodeRow[] = new Array(tableSize);

  const codes: { symbol: number; len: number }[] = [];
  for (let s = 0; s < numBits.length; s++) {
    const len = numBits[s] ?? 0;
    if (len > 0) codes.push({ symbol: s, len });
  }

  codes.sort((a, b) => a.len - b.len || a.symbol - b.symbol);

  let code = 0;
  let lastLen = 0;
  for (const { symbol, len } of codes) {
    code <<= len - lastLen;
    const tableMask = (1 << len) - 1;
    const step = 1 << (maxNumBits - len);
    for (let i = code; i < tableSize; i += step) {
      for (let j = 0; j < step; j++) {
        const idx = (i + j) & tableMask;
        if (idx < tableSize) table[idx] = { symbol, numBits: len };
      }
    }
    code++;
    lastLen = len;
  }

  return table;
}

/**
 * Decode one Huffman symbol. Reader must be positioned at start of code.
 */
export function decodeHuffmanSymbol(
  table: readonly HuffmanDecodeRow[],
  maxNumBits: number,
  reader: BitReaderReverse,
): number {
  const peek = reader.readBits(maxNumBits);
  const row = table[peek];
  if (!row) throw new ZstdError('Huffman invalid code', 'corruption_detected');
  return row.symbol;
}
