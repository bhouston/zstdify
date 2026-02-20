/**
 * FSE (Finite State Entropy) decode: table build and symbol decode.
 * Zstd FSE streams are read backward.
 */

import { BitReader } from '../bitstream/bitReader.js';
import type { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { ZstdError } from '../errors.js';

export interface FSEDecodeRow {
  symbol: number;
  numBits: number;
  baseline: number;
}

const FSE_TABLESTEP = (tableSize: number) => (tableSize >> 1) + (tableSize >> 3) + 3;

/**
 * Build FSE decode table from normalized counts.
 * Counts are -1 for "less than 1" (full state reset) symbols.
 * Based on zstd FSE_buildDTable logic.
 */
export function buildFSEDecodeTable(normalizedCounter: readonly number[], tableLog: number): FSEDecodeRow[] {
  if (!normalizedCounter || normalizedCounter.length === 0) {
    throw new ZstdError('FSE: invalid normalized counter', 'corruption_detected');
  }
  const tableSize = 1 << tableLog;
  const tableSymbol: number[] = new Array(tableSize);
  const maxSymbolValue = normalizedCounter.length - 1;

  const symbolNext: number[] = new Array(maxSymbolValue + 1);
  let highThreshold = tableSize - 1;

  for (let s = 0; s <= maxSymbolValue; s++) {
    const n = normalizedCounter[s] ?? 0;
    if (n === -1) {
      tableSymbol[highThreshold] = s;
      highThreshold--;
      symbolNext[s] = 1;
    } else {
      symbolNext[s] = n;
    }
  }

  const step = FSE_TABLESTEP(tableSize);
  const tableMask = tableSize - 1;
  let position = 0;

  for (let s = 0; s <= maxSymbolValue; s++) {
    const n = normalizedCounter[s] ?? 0;
    if (n <= 0) continue;
    for (let i = 0; i < n; i++) {
      tableSymbol[position] = s;
      do {
        position = (position + step) & tableMask;
      } while (position > highThreshold);
    }
  }

  const table: FSEDecodeRow[] = new Array(tableSize);
  for (let u = 0; u < tableSize; u++) {
    const symbol = tableSymbol[u];
    if (symbol === undefined) {
      throw new ZstdError('FSE invalid decode table', 'corruption_detected');
    }
    const nextState = symbolNext[symbol];
    if (nextState === undefined) throw new ZstdError('FSE invalid symbol', 'corruption_detected');
    symbolNext[symbol] = nextState + 1;

    const nbBits = tableLog - 31 + Math.clz32(nextState);
    const baseline = (nextState << nbBits) - tableSize;
    table[u] = { symbol, numBits: nbBits, baseline };
  }

  return table;
}

/**
 * Decode one FSE symbol. Updates state in place.
 */
export function decodeFSESymbol(
  table: readonly FSEDecodeRow[],
  _tableLog: number,
  reader: BitReaderReverse,
  state: { value: number },
): number {
  const row = table[state.value];
  if (!row) throw new ZstdError('FSE invalid state', 'corruption_detected');
  const symbol = row.symbol;
  const nbBits = row.numBits;
  const baseline = row.baseline;
  const bits = nbBits > 0 ? reader.readBits(nbBits) : 0;
  state.value = baseline + bits;
  return symbol;
}

/**
 * Read a variable-length packed value (0 to maxVal inclusive) from a forward bitstream.
 * Per zstd FSE Table Description variable bits scheme (Nigel Tao / RFC 8878).
 */
function readVariablePacked(reader: { readBits(n: number): number }, maxVal: number): number {
  if (maxVal <= 0) return 0;
  const maxValInclusive = maxVal;
  const bitCount = 32 - Math.clz32(maxValInclusive);
  if (bitCount <= 1) return reader.readBits(1) & 1;

  const threshold = (1 << bitCount) - 1 - maxValInclusive;
  const smallBits = bitCount - 1;
  const lowBits = reader.readBits(smallBits);

  if (lowBits < threshold) {
    return lowBits;
  }
  const highBit = reader.readBits(1);
  const fullValue = (lowBits << 1) | highBit;
  return fullValue - threshold;
}

/**
 * Read FSE normalized counts from compressed header (readNCount).
 * Used when symbol type uses RLE or Compressed mode (not Predefined).
 * Bitstream is read forward, little-endian.
 */
export function readNCount(
  data: Uint8Array,
  offset: number,
  maxSymbolValue: number,
  maxTableLog: number,
): { normalizedCounter: number[]; tableLog: number; maxSymbolValue: number; bytesRead: number } {
  if (offset >= data.length) {
    throw new ZstdError('FSE readNCount: truncated input', 'corruption_detected');
  }

  const reader = new BitReader(data, offset);
  const low4Bits = reader.readBits(4);
  const accuracyLog = low4Bits + 5;
  const tableSize = 1 << accuracyLog;

  if (accuracyLog > maxTableLog) {
    throw new ZstdError('FSE readNCount: tableLog too large', 'corruption_detected');
  }

  const normalizedCounter: number[] = [];
  let remaining = tableSize;
  let symbol = 0;

  while (remaining > 0) {
    if (symbol > maxSymbolValue) {
      throw new ZstdError('FSE readNCount: too many symbols', 'corruption_detected');
    }

    const maxRead = remaining + 1;
    const value = readVariablePacked(reader, maxRead);

    if (value === 0) {
      normalizedCounter[symbol] = -1;
      remaining -= 1;
      symbol++;
      continue;
    }

    let n = value - 1;
    if (n === 0) {
      let repeat = 0;
      let r = reader.readBits(2);
      while (r === 3) {
        repeat += 3;
        r = reader.readBits(2);
      }
      repeat += r;
      for (let i = 0; i <= repeat; i++) {
        if (symbol > maxSymbolValue) {
          throw new ZstdError('FSE readNCount: too many symbols', 'corruption_detected');
        }
        normalizedCounter[symbol] = 0;
        symbol++;
      }
      continue;
    }

    if (n > remaining) {
      throw new ZstdError('FSE readNCount: invalid probability sum', 'corruption_detected');
    }

    normalizedCounter[symbol] = n;
    remaining -= n;
    symbol++;
  }

  reader.align();
  const bytesRead = reader.position - offset;

  const maxSymbolValueOut = symbol - 1;
  for (let i = symbol; i <= maxSymbolValue; i++) {
    normalizedCounter[i] = 0;
  }

  return {
    normalizedCounter,
    tableLog: accuracyLog,
    maxSymbolValue: maxSymbolValueOut,
    bytesRead,
  };
}
