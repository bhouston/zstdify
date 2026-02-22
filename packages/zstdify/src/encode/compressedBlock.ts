import { BitWriter } from '../bitstream/bitWriter.js';
import type { Sequence } from '../decode/reconstruct.js';
import { buildFSEDecodeTable, normalizeCountsForTable, type FSEDecodeRow, writeNCount } from '../entropy/fse.js';
import { buildHuffmanDecodeTable, weightsToNumBits } from '../entropy/huffman.js';
import {
  LITERALS_LENGTH_DEFAULT_DISTRIBUTION,
  LITERALS_LENGTH_TABLE_LOG,
  MATCH_LENGTH_DEFAULT_DISTRIBUTION,
  MATCH_LENGTH_TABLE_LOG,
  OFFSET_CODE_DEFAULT_DISTRIBUTION,
  OFFSET_CODE_TABLE_LOG,
} from '../entropy/predefined.js';

// Predefined FSE tables built once and reused for sequence encoding.
let cachedLLTable: readonly FSEDecodeRow[] | null = null;
let cachedOFTable: readonly FSEDecodeRow[] | null = null;
let cachedMLTable: readonly FSEDecodeRow[] | null = null;
function getPredefinedFSETables(): {
  ll: readonly FSEDecodeRow[];
  of: readonly FSEDecodeRow[];
  ml: readonly FSEDecodeRow[];
} {
  if (!cachedLLTable) {
    cachedLLTable = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
    cachedOFTable = buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG);
    cachedMLTable = buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG);
  }
  return { ll: cachedLLTable, of: cachedOFTable!, ml: cachedMLTable! };
}

const LL_BASELINE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048,
  4096, 8192, 16384, 32768, 65536,
];
const LL_NUMBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];
const ML_BASELINE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539,
];
const ML_NUMBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3,
  3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

function writeU24LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
}

const U32_ALL_BITS = 0xffff_ffff >>> 0;
const pathTableCache = new WeakMap<readonly FSEDecodeRow[], PrecomputedPathTable>();
let pathMasksScratch: Uint32Array | null = null;
let pathNextChoiceScratch: Int32Array | null = null;

interface PrecomputedPathTable {
  tableSize: number;
  wordCount: number;
  statesBySymbol: number[][];
  symbolMasks: Uint32Array[];
  baselineByState: Int32Array;
  minNextByState: Int32Array;
  maxNextByState: Int32Array;
}

interface SequenceTablesState {
  llTable: readonly FSEDecodeRow[];
  llTableLog: number;
  ofTable: readonly FSEDecodeRow[];
  ofTableLog: number;
  mlTable: readonly FSEDecodeRow[];
  mlTableLog: number;
}

export interface SequenceEntropyContext {
  prevTables: SequenceTablesState | null;
}

function rangeMask(startBit: number, endBit: number): number {
  if (startBit === 0 && endBit === 31) return U32_ALL_BITS;
  const startMask = (U32_ALL_BITS << startBit) >>> 0;
  const endMask = endBit === 31 ? U32_ALL_BITS : ((1 << (endBit + 1)) - 1) >>> 0;
  return (startMask & endMask) >>> 0;
}

function setMaskBit(mask: Uint32Array, maskOffset: number, bit: number): void {
  const word = bit >>> 5;
  mask[maskOffset + word] = (mask[maskOffset + word]! | (1 << (bit & 31))) >>> 0;
}

function isMaskEmpty(mask: Uint32Array, maskOffset: number, wordCount: number): boolean {
  for (let i = 0; i < wordCount; i++) {
    if ((mask[maskOffset + i] ?? 0) !== 0) return false;
  }
  return true;
}

function firstBitInWord(word: number): number {
  const normalized = word >>> 0;
  const lsb = (normalized & -normalized) >>> 0;
  return 31 - Math.clz32(lsb);
}

function findFirstSetBit(mask: Uint32Array, maskOffset: number, wordCount: number): number {
  for (let wi = 0; wi < wordCount; wi++) {
    const word = mask[maskOffset + wi] ?? 0;
    if (word !== 0) {
      return (wi << 5) + firstBitInWord(word);
    }
  }
  return -1;
}

function findFirstSetBitInRange(
  mask: Uint32Array,
  maskOffset: number,
  wordCount: number,
  minState: number,
  maxState: number,
): number {
  if (wordCount <= 0) return -1;
  let min = minState;
  let max = maxState;
  const maxBit = (wordCount << 5) - 1;
  if (min < 0) min = 0;
  if (max > maxBit) max = maxBit;
  if (min > max) return -1;
  const startWord = min >>> 5;
  const endWord = max >>> 5;
  if (startWord === endWord) {
    const masked = ((mask[maskOffset + startWord] ?? 0) & rangeMask(min & 31, max & 31)) >>> 0;
    if (masked === 0) return -1;
    return (startWord << 5) + firstBitInWord(masked);
  }
  const firstMasked = ((mask[maskOffset + startWord] ?? 0) & rangeMask(min & 31, 31)) >>> 0;
  if (firstMasked !== 0) {
    return (startWord << 5) + firstBitInWord(firstMasked);
  }
  for (let wi = startWord + 1; wi < endWord; wi++) {
    const word = mask[maskOffset + wi] ?? 0;
    if (word !== 0) return (wi << 5) + firstBitInWord(word);
  }
  const lastMasked = ((mask[maskOffset + endWord] ?? 0) & rangeMask(0, max & 31)) >>> 0;
  if (lastMasked === 0) return -1;
  return (endWord << 5) + firstBitInWord(lastMasked);
}

function getPrecomputedPathTable(table: readonly FSEDecodeRow[]): PrecomputedPathTable {
  const cached = pathTableCache.get(table);
  if (cached) return cached;
  const tableSize = table.length;
  const wordCount = Math.max(1, Math.ceil(tableSize / 32));
  const baselineByState = new Int32Array(tableSize);
  const minNextByState = new Int32Array(tableSize);
  const maxNextByState = new Int32Array(tableSize);
  let maxSymbol = -1;
  for (let s = 0; s < tableSize; s++) {
    const row = table[s];
    if (!row) {
      baselineByState[s] = 0;
      minNextByState[s] = 1;
      maxNextByState[s] = 0;
      continue;
    }
    baselineByState[s] = row.baseline;
    const width = row.numBits > 0 ? 1 << row.numBits : 1;
    const minNext = row.baseline;
    const maxNext = row.baseline + width - 1;
    minNextByState[s] = minNext < 0 ? 0 : minNext;
    maxNextByState[s] = maxNext >= tableSize ? tableSize - 1 : maxNext;
    if (row.symbol > maxSymbol) maxSymbol = row.symbol;
  }
  const statesBySymbol = Array.from({ length: maxSymbol + 1 }, () => [] as number[]);
  const symbolMasks = Array.from({ length: maxSymbol + 1 }, () => new Uint32Array(wordCount));
  for (let s = 0; s < tableSize; s++) {
    const row = table[s];
    if (!row) continue;
    const sym = row.symbol;
    const stateList = statesBySymbol[sym];
    const stateMask = symbolMasks[sym];
    if (!stateList || !stateMask) continue;
    stateList.push(s);
    stateMask[s >>> 5] = (stateMask[s >>> 5]! | (1 << (s & 31))) >>> 0;
  }
  const precomputed = {
    tableSize,
    wordCount,
    statesBySymbol,
    symbolMasks,
    baselineByState,
    minNextByState,
    maxNextByState,
  };
  pathTableCache.set(table, precomputed);
  return precomputed;
}

function getPathMasksScratch(requiredLength: number): Uint32Array {
  if (!pathMasksScratch || pathMasksScratch.length < requiredLength) {
    pathMasksScratch = new Uint32Array(requiredLength);
  }
  pathMasksScratch.fill(0, 0, requiredLength);
  return pathMasksScratch;
}

function getPathNextChoiceScratch(requiredLength: number): Int32Array {
  if (!pathNextChoiceScratch || pathNextChoiceScratch.length < requiredLength) {
    pathNextChoiceScratch = new Int32Array(requiredLength);
  }
  pathNextChoiceScratch.fill(-1, 0, requiredLength);
  return pathNextChoiceScratch;
}

function encodeReverseBitstream(bitCounts: ArrayLike<number>, bitValues: ArrayLike<number>): Uint8Array {
  let bitLength = 1; // end marker
  for (let i = 0; i < bitCounts.length; i++) {
    const n = bitCounts[i] ?? 0;
    if (n > 0) bitLength += n;
  }
  const paddedBits = (bitLength + 7) & ~7;
  const out = new Uint8Array(paddedBits >>> 3);
  let bitPos = 0;
  const writeBitsLSB = (n: number, value: number): void => {
    for (let i = 0; i < n; i++) {
      if (((value >>> i) & 1) !== 0) {
        const idx = bitPos >>> 3;
        out[idx] = (out[idx]! | (1 << (bitPos & 7))) & 0xff;
      }
      bitPos++;
    }
  };
  for (let i = bitCounts.length - 1; i >= 0; i--) {
    const n = bitCounts[i] ?? 0;
    if (n <= 0) continue;
    writeBitsLSB(n, bitValues[i] ?? 0);
  }
  {
    const idx = bitPos >>> 3;
    out[idx] = (out[idx]! | (1 << (bitPos & 7))) & 0xff;
  }
  return out;
}

function findLengthCode(
  value: number,
  baseline: readonly number[],
  extraBits: readonly number[],
  directMax: number,
  directBias: number,
): {
  code: number;
  extra: number;
  extraN: number;
} | null {
  if (value <= directMax) {
    const code = value - directBias;
    if (code < 0) return null;
    return { code, extra: 0, extraN: 0 };
  }
  for (let code = 0; code < baseline.length; code++) {
    const base = baseline[code] ?? 0;
    const n = extraBits[code] ?? 0;
    if (value >= base && value < base + (1 << n)) {
      return { code, extra: value - base, extraN: n };
    }
  }
  return null;
}

function buildSingleSymbolCompressedLiterals(literals: Uint8Array): Uint8Array | null {
  if (literals.length === 0 || literals.length > 1023) return null;
  const sym = literals[0] ?? 0;
  for (let i = 1; i < literals.length; i++) {
    if ((literals[i] ?? 0) !== sym) return null;
  }
  if (sym > 127) return null;
  const numWeights = sym + 1;
  if (numWeights < 1 || numWeights > 128) return null;

  const weights = new Array<number>(numWeights).fill(0);
  weights[sym] = 1;

  let partialSum = 0;
  for (const w of weights) {
    if (w > 0) partialSum += 1 << (w - 1);
  }
  if (partialSum === 0) return null;
  const maxNumBits = 32 - Math.clz32(partialSum);
  const total = 1 << maxNumBits;
  const remainder = total - partialSum;
  if (remainder <= 0 || (remainder & (remainder - 1)) !== 0) return null;
  const lastWeight = 32 - Math.clz32(remainder);
  const fullWeights = [...weights, lastWeight];
  while (fullWeights.length < 256) fullWeights.push(0);
  const numBits = weightsToNumBits(fullWeights, maxNumBits);
  const table = buildHuffmanDecodeTable(numBits, maxNumBits);
  const symbolCode = table.findIndex((row) => row?.symbol === sym);
  if (symbolCode < 0) return null;

  const bitCounts = new Uint8Array(literals.length);
  bitCounts.fill(maxNumBits);
  const bitValues = new Uint16Array(literals.length);
  bitValues.fill(symbolCode);
  const stream = encodeReverseBitstream(bitCounts, bitValues);

  const directHeader = 127 + numWeights;
  const weightWriter = new BitWriter();
  for (let i = 0; i < weights.length; i += 2) {
    const hi = weights[i] ?? 0;
    const lo = weights[i + 1] ?? 0;
    weightWriter.writeBits(8, ((hi & 0xf) << 4) | (lo & 0xf));
  }
  const weightBytes = weightWriter.flush();

  const compressedSize = 1 + weightBytes.length + stream.length;
  if (compressedSize > 1023) return null;

  const b0 = (2 | (0 << 2) | ((literals.length & 0x0f) << 4)) & 0xff;
  const b1 = (((literals.length >> 4) & 0x3f) | ((compressedSize & 0x03) << 6)) & 0xff;
  const b2 = (compressedSize >> 2) & 0xff;

  const out = new Uint8Array(3 + 1 + weightBytes.length + stream.length);
  out[0] = b0;
  out[1] = b1;
  out[2] = b2;
  out[3] = directHeader & 0xff;
  out.set(weightBytes, 4);
  out.set(stream, 4 + weightBytes.length);
  return out;
}

function splitPowerTerms(targetSum: number, count: number): number[] | null {
  if (count < 1 || count > targetSum) return null;
  const terms: number[] = [];
  for (let bit = 31; bit >= 0; bit--) {
    const value = 1 << bit;
    if ((targetSum & value) !== 0) {
      terms.push(value);
    }
  }
  while (terms.length < count) {
    let splitIndex = -1;
    let largest = 0;
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i] ?? 0;
      if (term > largest) {
        largest = term;
        splitIndex = i;
      }
    }
    if (splitIndex < 0 || largest <= 1) {
      return null;
    }
    const half = largest >>> 1;
    terms.splice(splitIndex, 1, half, half);
  }
  return terms;
}

function buildGeneralCompressedLiterals(literals: Uint8Array): Uint8Array | null {
  if (literals.length === 0 || literals.length > 1023) return null;
  const seen = new Uint8Array(256);
  let numSymbols = 0;
  let maxSymbol = 0;
  for (let i = 0; i < literals.length; i++) {
    const b = literals[i]!;
    if (seen[b] === 0) {
      seen[b] = 1;
      numSymbols++;
      if (b > maxSymbol) maxSymbol = b;
    }
  }
  if (numSymbols === 0 || numSymbols > 128) return null;
  if (maxSymbol > 127) return null;

  const sortedSymbols: number[] = [];
  for (let s = 0; s <= maxSymbol; s++) {
    if (seen[s] !== 0) sortedSymbols.push(s);
  }

  // Construct a valid direct-weight table over symbols <= 127.
  const partialTarget = 128; // maxNumBits=8 => total 256, remainder is 128 (power of two).
  const contributions = splitPowerTerms(partialTarget, sortedSymbols.length);
  if (!contributions) return null;
  contributions.sort((a, b) => b - a);

  const weights = new Array<number>(maxSymbol + 1).fill(0);
  for (let i = 0; i < sortedSymbols.length; i++) {
    const symbol = sortedSymbols[i] ?? 0;
    const contribution = contributions[i] ?? 1;
    const weight = 32 - Math.clz32(contribution);
    if (weight < 1 || weight > 15) return null;
    weights[symbol] = weight;
  }

  const fullWeights = [...weights, 8];
  while (fullWeights.length < 256) fullWeights.push(0);
  const numBits = weightsToNumBits(fullWeights, 8);
  const table = buildHuffmanDecodeTable(numBits, 8);

  const codeBySymbol = new Int32Array(256).fill(-1);
  for (let i = 0; i < sortedSymbols.length; i++) {
    const symbol = sortedSymbols[i]!;
    const code = table.findIndex((row) => row?.symbol === symbol);
    if (code < 0) return null;
    codeBySymbol[symbol] = code;
  }

  const readCounts = new Uint8Array(literals.length);
  const readValues = new Uint16Array(literals.length);
  for (let i = 0; i < literals.length; i++) {
    const code = codeBySymbol[literals[i]!]!;
    if (code < 0) return null;
    readCounts[i] = 8;
    readValues[i] = code;
  }
  const stream = encodeReverseBitstream(readCounts, readValues);

  const numWeights = weights.length;
  if (numWeights < 1 || numWeights > 128) return null;
  const directHeader = 127 + numWeights;
  const weightWriter = new BitWriter();
  for (let i = 0; i < weights.length; i += 2) {
    const hi = weights[i] ?? 0;
    const lo = weights[i + 1] ?? 0;
    weightWriter.writeBits(8, ((hi & 0xf) << 4) | (lo & 0xf));
  }
  const weightBytes = weightWriter.flush();

  const compressedSize = 1 + weightBytes.length + stream.length;
  if (compressedSize > 1023) return null;
  const b0 = (2 | (0 << 2) | ((literals.length & 0x0f) << 4)) & 0xff;
  const b1 = (((literals.length >> 4) & 0x3f) | ((compressedSize & 0x03) << 6)) & 0xff;
  const b2 = (compressedSize >> 2) & 0xff;

  const out = new Uint8Array(3 + 1 + weightBytes.length + stream.length);
  out[0] = b0;
  out[1] = b1;
  out[2] = b2;
  out[3] = directHeader & 0xff;
  out.set(weightBytes, 4);
  out.set(stream, 4 + weightBytes.length);
  return out;
}

function buildRawLiteralsSection(literals: Uint8Array): Uint8Array | null {
  const size = literals.length;
  if (size <= 31) {
    const out = new Uint8Array(1 + size);
    out[0] = (size << 3) | 0;
    out.set(literals, 1);
    return out;
  }
  if (size <= 0x0fff) {
    const out = new Uint8Array(2 + size);
    out[0] = ((size & 0x0f) << 4) | (1 << 2);
    out[1] = (size >>> 4) & 0xff;
    out.set(literals, 2);
    return out;
  }
  if (size <= 0x0f_ffff) {
    const out = new Uint8Array(3 + size);
    out[0] = ((size & 0x0f) << 4) | (3 << 2);
    out[1] = (size >>> 4) & 0xff;
    out[2] = (size >>> 12) & 0xff;
    out.set(literals, 3);
    return out;
  }
  return null;
}

function encodeNumSequences(numSequences: number): Uint8Array | null {
  if (numSequences < 0 || numSequences > 0xffff + 0x7f00) return null;
  if (numSequences < 128) {
    return new Uint8Array([numSequences & 0xff]);
  }
  if (numSequences < 0x7f00) {
    const hi = ((numSequences >>> 8) & 0x7f) + 0x80;
    const lo = numSequences & 0xff;
    return new Uint8Array([hi, lo]);
  }
  const value = numSequences - 0x7f00;
  return new Uint8Array([0xff, value & 0xff, (value >>> 8) & 0xff]);
}

function buildStatePath(
  codes: ArrayLike<number>,
  table: readonly FSEDecodeRow[],
): { states: number[]; updateBits: number[] } | null {
  if (codes.length === 0) return { states: [], updateBits: [] };
  const pre = getPrecomputedPathTable(table);
  const { tableSize, wordCount, statesBySymbol, symbolMasks, minNextByState, maxNextByState, baselineByState } = pre;
  if (tableSize <= 0) return null;
  const rowCount = codes.length;
  const masks = getPathMasksScratch(rowCount * wordCount);
  const nextChoice = getPathNextChoiceScratch(Math.max(0, rowCount - 1) * tableSize);
  const maskOffset = (rowIndex: number) => rowIndex * wordCount;
  const nextChoiceOffset = (rowIndex: number) => rowIndex * tableSize;
  const lastCode = codes[rowCount - 1] ?? -1;
  if (lastCode < 0 || lastCode >= symbolMasks.length) return null;
  const lastMask = symbolMasks[lastCode];
  if (!lastMask) return null;
  const lastMaskOffset = maskOffset(rowCount - 1);
  for (let wi = 0; wi < wordCount; wi++) {
    masks[lastMaskOffset + wi] = lastMask[wi] ?? 0;
  }
  if (isMaskEmpty(masks, lastMaskOffset, wordCount)) return null;

  for (let i = rowCount - 2; i >= 0; i--) {
    const code = codes[i] ?? -1;
    if (code < 0 || code >= statesBySymbol.length) return null;
    const candidates = statesBySymbol[code];
    if (!candidates || candidates.length === 0) return null;
    const curMaskOffset = maskOffset(i);
    const nextMaskOffset = maskOffset(i + 1);
    const curNextOffset = nextChoiceOffset(i);
    for (let ci = 0; ci < candidates.length; ci++) {
      const state = candidates[ci];
      if (state === undefined) continue;
      const chosenNext = findFirstSetBitInRange(
        masks,
        nextMaskOffset,
        wordCount,
        minNextByState[state]!,
        maxNextByState[state]!,
      );
      if (chosenNext >= 0) {
        setMaskBit(masks, curMaskOffset, state);
        nextChoice[curNextOffset + state] = chosenNext;
      }
    }
    if (isMaskEmpty(masks, curMaskOffset, wordCount)) return null;
  }

  const states: number[] = new Array(rowCount);
  const updateBits: number[] = new Array(Math.max(0, rowCount - 1));
  let state = findFirstSetBit(masks, maskOffset(0), wordCount);
  if (state < 0) return null;
  states[0] = state;
  for (let i = 0; i < rowCount - 1; i++) {
    const nextState = nextChoice[nextChoiceOffset(i) + state] ?? -1;
    if (nextState < 0) return null;
    states[i + 1] = nextState;
    updateBits[i] = nextState - baselineByState[state]!;
    state = nextState;
  }
  return { states, updateBits };
}

interface SymbolizedSequences {
  llCodes: Uint8Array;
  llExtraN: Uint8Array;
  llExtraValue: Uint32Array;
  mlCodes: Uint8Array;
  mlExtraN: Uint8Array;
  mlExtraValue: Uint32Array;
  ofCodes: Uint8Array;
  ofExtraN: Uint8Array;
  ofExtraValue: Uint32Array;
}

interface StreamChoice {
  mode: 0 | 2 | 3;
  table: readonly FSEDecodeRow[];
  tableLog: number;
  path: { states: number[]; updateBits: number[] };
  tableHeader: Uint8Array;
}

function symbolRange(codes: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < codes.length; i++) {
    const value = codes[i] ?? 0;
    if (value > max) max = value;
  }
  return max + 1;
}

function buildHistogram(codes: ArrayLike<number>, alphabetSize: number): Uint32Array {
  const out = new Uint32Array(alphabetSize);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] ?? 0;
    if (c < 0 || c >= alphabetSize) continue;
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

function scorePath(path: { states: number[] }, table: readonly FSEDecodeRow[], tableLog: number): number {
  if (path.states.length === 0) return 0;
  let bits = tableLog;
  for (let i = 0; i < path.states.length - 1; i++) {
    const row = table[path.states[i] ?? 0];
    if (!row) return Number.POSITIVE_INFINITY;
    bits += row.numBits;
  }
  return bits;
}

const normalizedTableCache = new Map<string, { table: readonly FSEDecodeRow[]; tableLog: number; header: Uint8Array }>();

function getNormalizedTableCandidates(
  codes: ArrayLike<number>,
  maxTableLog: number,
): Array<{ table: readonly FSEDecodeRow[]; tableLog: number; header: Uint8Array }> {
  const alphabetSize = symbolRange(codes);
  if (alphabetSize <= 0) return [];
  const histogram = buildHistogram(codes, alphabetSize);
  let distinct = 0;
  for (let i = 0; i < histogram.length; i++) {
    if ((histogram[i] ?? 0) > 0) distinct++;
  }
  if (distinct <= 1) return [];
  let minTableLog = 5;
  while ((1 << minTableLog) < distinct && minTableLog < maxTableLog) minTableLog++;
  if ((1 << minTableLog) < distinct) return [];
  const maxLogFromSamples = codes.length > 1 ? 31 - Math.clz32(codes.length - 1) : 5;
  const limit = Math.max(minTableLog, Math.min(maxTableLog, maxLogFromSamples + 1));
  const results: Array<{ table: readonly FSEDecodeRow[]; tableLog: number; header: Uint8Array }> = [];
  const histogramKey = Array.from(histogram).join(',');
  for (let tableLog = minTableLog; tableLog <= limit; tableLog++) {
    const key = `${tableLog}:${histogramKey}`;
    const cached = normalizedTableCache.get(key);
    if (cached) {
      results.push(cached);
      continue;
    }
    try {
      const { normalizedCounter, maxSymbolValue } = normalizeCountsForTable(Array.from(histogram), tableLog);
      const header = writeNCount(normalizedCounter, maxSymbolValue, tableLog);
      const table = buildFSEDecodeTable(normalizedCounter, tableLog);
      const out = { table, tableLog, header };
      normalizedTableCache.set(key, out);
      results.push(out);
    } catch {
      // Skip invalid normalizations for this table log.
    }
  }
  return results;
}

function symbolizedSequences(sequences: readonly Sequence[]): SymbolizedSequences | null {
  if (sequences.length === 0) return null;
  const numSequences = sequences.length;
  const llCodes = new Uint8Array(numSequences);
  const llExtraN = new Uint8Array(numSequences);
  const llExtraValue = new Uint32Array(numSequences);
  const mlCodes = new Uint8Array(numSequences);
  const mlExtraN = new Uint8Array(numSequences);
  const mlExtraValue = new Uint32Array(numSequences);
  const ofCodes = new Uint8Array(numSequences);
  const ofExtraN = new Uint8Array(numSequences);
  const ofExtraValue = new Uint32Array(numSequences);

  for (let i = 0; i < numSequences; i++) {
    const sequence = sequences[i]!;
    const ll = findLengthCode(sequence.literalsLength, LL_BASELINE, LL_NUMBITS, 15, 0);
    const ml = findLengthCode(sequence.matchLength, ML_BASELINE, ML_NUMBITS, 34, 3);
    if (!ll || !ml) return null;
    const offsetValue = sequence.offset;
    if (offsetValue < 1) return null;
    const ofCode = 31 - Math.clz32(offsetValue);
    if (ofCode < 0 || ofCode > 28) return null;
    const ofEx = offsetValue - (1 << ofCode);

    llCodes[i] = ll.code;
    llExtraN[i] = ll.extraN;
    llExtraValue[i] = ll.extra;
    mlCodes[i] = ml.code;
    mlExtraN[i] = ml.extraN;
    mlExtraValue[i] = ml.extra;
    ofCodes[i] = ofCode;
    ofExtraN[i] = ofCode;
    ofExtraValue[i] = ofEx;
  }
  return { llCodes, llExtraN, llExtraValue, mlCodes, mlExtraN, mlExtraValue, ofCodes, ofExtraN, ofExtraValue };
}

function chooseStreamMode(
  codes: ArrayLike<number>,
  predefinedTable: readonly FSEDecodeRow[],
  predefinedTableLog: number,
  maxTableLog: number,
  prevTable: readonly FSEDecodeRow[] | null,
  prevTableLog: number | null,
): StreamChoice | null {
  const predefinedPath = buildStatePath(codes, predefinedTable);
  if (!predefinedPath) return null;
  let best: StreamChoice = {
    mode: 0,
    table: predefinedTable,
    tableLog: predefinedTableLog,
    path: predefinedPath,
    tableHeader: new Uint8Array(0),
  };
  let bestScore = scorePath(predefinedPath, predefinedTable, predefinedTableLog);

  if (prevTable && prevTableLog !== null) {
    const repeatPath = buildStatePath(codes, prevTable);
    if (repeatPath) {
      const repeatScore = scorePath(repeatPath, prevTable, prevTableLog);
      if (repeatScore < bestScore) {
        best = { mode: 3, table: prevTable, tableLog: prevTableLog, path: repeatPath, tableHeader: new Uint8Array(0) };
        bestScore = repeatScore;
      }
    }
  }

  const compressedCandidates = getNormalizedTableCandidates(codes, maxTableLog);
  for (const compressed of compressedCandidates) {
    const compressedPath = buildStatePath(codes, compressed.table);
    if (compressedPath) {
      const compressedScore = scorePath(compressedPath, compressed.table, compressed.tableLog) + compressed.header.length * 8;
      if (compressedScore < bestScore) {
        best = {
          mode: 2,
          table: compressed.table,
          tableLog: compressed.tableLog,
          path: compressedPath,
          tableHeader: compressed.header,
        };
        bestScore = compressedScore;
      }
    }
  }
  return best;
}

function buildSequenceSection(
  sequences: readonly Sequence[],
  context?: SequenceEntropyContext,
): { section: Uint8Array; tables: SequenceTablesState } | null {
  const encoded = symbolizedSequences(sequences);
  if (!encoded) return null;
  const numSequences = sequences.length;
  const numSequencesBytes = encodeNumSequences(numSequences);
  if (!numSequencesBytes) return null;
  const { ll: llTable, of: ofTable, ml: mlTable } = getPredefinedFSETables();
  const llChoice = chooseStreamMode(
    encoded.llCodes,
    llTable,
    LITERALS_LENGTH_TABLE_LOG,
    9,
    context?.prevTables?.llTable ?? null,
    context?.prevTables?.llTableLog ?? null,
  );
  const ofChoice = chooseStreamMode(
    encoded.ofCodes,
    ofTable,
    OFFSET_CODE_TABLE_LOG,
    8,
    context?.prevTables?.ofTable ?? null,
    context?.prevTables?.ofTableLog ?? null,
  );
  const mlChoice = chooseStreamMode(
    encoded.mlCodes,
    mlTable,
    MATCH_LENGTH_TABLE_LOG,
    9,
    context?.prevTables?.mlTable ?? null,
    context?.prevTables?.mlTableLog ?? null,
  );
  if (!llChoice || !ofChoice || !mlChoice) return null;

  const chunkCount = numSequences * 6;
  const readCounts = new Uint8Array(chunkCount);
  const readValues = new Uint32Array(chunkCount);
  let readPos = 0;
  readCounts[readPos] = llChoice.tableLog;
  readValues[readPos++] = llChoice.path.states[0] ?? 0;
  readCounts[readPos] = ofChoice.tableLog;
  readValues[readPos++] = ofChoice.path.states[0] ?? 0;
  readCounts[readPos] = mlChoice.tableLog;
  readValues[readPos++] = mlChoice.path.states[0] ?? 0;
  for (let i = 0; i < numSequences; i++) {
    readCounts[readPos] = encoded.ofExtraN[i] ?? 0;
    readValues[readPos++] = encoded.ofExtraValue[i] ?? 0;
    readCounts[readPos] = encoded.mlExtraN[i] ?? 0;
    readValues[readPos++] = encoded.mlExtraValue[i] ?? 0;
    readCounts[readPos] = encoded.llExtraN[i] ?? 0;
    readValues[readPos++] = encoded.llExtraValue[i] ?? 0;
    if (i !== numSequences - 1) {
      const llState = llChoice.path.states[i] ?? 0;
      const mlState = mlChoice.path.states[i] ?? 0;
      const ofState = ofChoice.path.states[i] ?? 0;
      const llRow = llChoice.table[llState];
      const mlRow = mlChoice.table[mlState];
      const ofRow = ofChoice.table[ofState];
      if (!llRow || !mlRow || !ofRow) return null;
      readCounts[readPos] = llRow.numBits;
      readValues[readPos++] = llChoice.path.updateBits[i] ?? 0;
      readCounts[readPos] = mlRow.numBits;
      readValues[readPos++] = mlChoice.path.updateBits[i] ?? 0;
      readCounts[readPos] = ofRow.numBits;
      readValues[readPos++] = ofChoice.path.updateBits[i] ?? 0;
    }
  }

  const bitstream = encodeReverseBitstream(readCounts, readValues);
  const tableHeaderSize = llChoice.tableHeader.length + ofChoice.tableHeader.length + mlChoice.tableHeader.length;
  const out = new Uint8Array(numSequencesBytes.length + 1 + tableHeaderSize + bitstream.length);
  out.set(numSequencesBytes, 0);
  const modeByte = (llChoice.mode << 6) | (ofChoice.mode << 4) | (mlChoice.mode << 2);
  out[numSequencesBytes.length] = modeByte & 0xff;
  let pos = numSequencesBytes.length + 1;
  out.set(llChoice.tableHeader, pos);
  pos += llChoice.tableHeader.length;
  out.set(ofChoice.tableHeader, pos);
  pos += ofChoice.tableHeader.length;
  out.set(mlChoice.tableHeader, pos);
  pos += mlChoice.tableHeader.length;
  out.set(bitstream, pos);
  return {
    section: out,
    tables: {
      llTable: llChoice.table,
      llTableLog: llChoice.tableLog,
      ofTable: ofChoice.table,
      ofTableLog: ofChoice.tableLog,
      mlTable: mlChoice.table,
      mlTableLog: mlChoice.tableLog,
    },
  };
}

export function buildCompressedBlockPayload(
  literals: Uint8Array,
  sequences: Sequence[],
  context?: SequenceEntropyContext,
): Uint8Array | null {
  const literalsLength = literals.length;
  const rawSection = buildRawLiteralsSection(literals);
  if (!rawSection) return null;
  let literalsSection = rawSection;

  if (literalsLength >= 8 && literalsLength <= 1023) {
    const single = buildSingleSymbolCompressedLiterals(literals);
    if (single && single.length < literalsSection.length) {
      literalsSection = single;
    }
  }

  if (literalsLength >= 16 && literalsLength <= 1023) {
    const general = buildGeneralCompressedLiterals(literals);
    if (general && general.length < literalsSection.length) {
      literalsSection = general;
    }
  }
  const seqSection = buildSequenceSection(sequences, context);
  if (!seqSection) return null;
  const out = new Uint8Array(literalsSection.length + seqSection.section.length);
  out.set(literalsSection, 0);
  out.set(seqSection.section, literalsSection.length);
  if (context) {
    context.prevTables = seqSection.tables;
  }
  return out;
}

export function writeCompressedBlock(payload: Uint8Array, last: boolean): Uint8Array {
  const header = new Uint8Array(3);
  const blockHeader = (last ? 1 : 0) | (2 << 1) | (payload.length << 3);
  writeU24LE(header, 0, blockHeader);
  const out = new Uint8Array(3 + payload.length);
  out.set(header, 0);
  out.set(payload, 3);
  return out;
}

// Internal benchmark hooks for hot-path profiling.
export const __benchInternals = {
  encodeReverseBitstream,
  buildRawLiteralsSection,
  buildGeneralCompressedLiterals,
  buildSequenceSection,
};
