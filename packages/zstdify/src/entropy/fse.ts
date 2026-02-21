/**
 * FSE (Finite State Entropy) decode: table build and symbol decode.
 * Zstd FSE streams are read backward.
 */

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

function readU32LESafe(data: Uint8Array, offset: number): number {
  return ((data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0);
}

function highbit32(v: number): number {
  return 31 - Math.clz32(v >>> 0);
}

function ctz32(v: number): number {
  const x = v >>> 0;
  if (x === 0) return 32;
  return 31 - Math.clz32((x & -x) >>> 0);
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
  const remainingInput = data.length - offset;
  if (remainingInput <= 0) {
    throw new ZstdError('FSE readNCount: truncated input', 'corruption_detected');
  }

  const parseBody = (buf: Uint8Array, hbSize: number) => {
    const normalizedCounter = new Array<number>(maxSymbolValue + 1).fill(0);
    let ip = 0;
    const iend = hbSize;
    const maxSV1 = maxSymbolValue + 1;
    let previous0 = false;
    let charnum = 0;

    let bitStream = readU32LESafe(buf, ip);
    let nbBits = (bitStream & 0x0f) + 5;
    if (nbBits > maxTableLog) {
      throw new ZstdError('FSE readNCount: tableLog too large', 'corruption_detected');
    }
    const tableLog = nbBits;
    bitStream >>>= 4;
    let bitCount = 4;
    let remaining = (1 << nbBits) + 1;
    let threshold = 1 << nbBits;
    nbBits += 1;

    const reload = () => {
      if (ip <= iend - 7 || ip + (bitCount >> 3) <= iend - 4) {
        ip += bitCount >> 3;
        bitCount &= 7;
      } else {
        bitCount -= 8 * (iend - 4 - ip);
        bitCount &= 31;
        ip = iend - 4;
      }
      bitStream = readU32LESafe(buf, ip) >>> bitCount;
    };

    while (true) {
      if (previous0) {
        let repeats = ctz32((~bitStream | 0x80000000) >>> 0) >> 1;
        while (repeats >= 12) {
          charnum += 3 * 12;
          if (ip <= iend - 7) {
            ip += 3;
          } else {
            bitCount -= 8 * (iend - 7 - ip);
            bitCount &= 31;
            ip = iend - 4;
          }
          bitStream = readU32LESafe(buf, ip) >>> bitCount;
          repeats = ctz32((~bitStream | 0x80000000) >>> 0) >> 1;
        }
        charnum += 3 * repeats;
        bitStream >>>= 2 * repeats;
        bitCount += 2 * repeats;

        const lastRepeat = bitStream & 3;
        if (lastRepeat >= 3) {
          throw new ZstdError('FSE readNCount: invalid zero repeat', 'corruption_detected');
        }
        charnum += lastRepeat;
        bitCount += 2;

        if (charnum >= maxSV1) break;
        reload();
      }

      const max = 2 * threshold - 1 - remaining;
      let count: number;
      if ((bitStream & (threshold - 1)) < max) {
        count = bitStream & (threshold - 1);
        bitCount += nbBits - 1;
      } else {
        count = bitStream & (2 * threshold - 1);
        if (count >= threshold) count -= max;
        bitCount += nbBits;
      }

      count -= 1;
      if (count >= 0) {
        remaining -= count;
      } else {
        remaining += count;
      }

      normalizedCounter[charnum] = count;
      charnum += 1;
      previous0 = count === 0;

      if (remaining < threshold) {
        if (remaining <= 1) break;
        nbBits = highbit32(remaining) + 1;
        threshold = 1 << (nbBits - 1);
      }

      if (charnum >= maxSV1) break;
      reload();
    }

    if (remaining !== 1) {
      throw new ZstdError('FSE readNCount: invalid probability sum', 'corruption_detected');
    }
    if (charnum > maxSV1 || bitCount > 32) {
      throw new ZstdError('FSE readNCount: corrupted header', 'corruption_detected');
    }

    ip += (bitCount + 7) >> 3;
    const outMaxSymbol = charnum - 1;
    for (let i = charnum; i <= maxSymbolValue; i++) {
      normalizedCounter[i] = 0;
    }

    return { normalizedCounter, tableLog, maxSymbolValue: outMaxSymbol, bytesRead: ip };
  };

  if (remainingInput < 8) {
    const scratch = new Uint8Array(8);
    scratch.set(data.subarray(offset));
    const parsed = parseBody(scratch, 8);
    if (parsed.bytesRead > remainingInput) {
      throw new ZstdError('FSE readNCount: truncated input', 'corruption_detected');
    }
    return parsed;
  }

  return parseBody(data.subarray(offset), remainingInput);
}
