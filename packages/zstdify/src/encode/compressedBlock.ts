import type { Sequence } from '../decode/reconstruct.js';
import { buildFSEDecodeTable, type FSEDecodeTable, normalizeCountsForTable, writeNCount } from '../entropy/fse.js';
import { encodeReverseBitstream } from '../bitstream/reverseBitWriter.js';
import {
  LITERALS_LENGTH_DEFAULT_DISTRIBUTION,
  LITERALS_LENGTH_TABLE_LOG,
  MATCH_LENGTH_DEFAULT_DISTRIBUTION,
  MATCH_LENGTH_TABLE_LOG,
  OFFSET_CODE_DEFAULT_DISTRIBUTION,
  OFFSET_CODE_TABLE_LOG,
} from '../entropy/predefined.js';
import {
  buildGeneralCompressedLiteralsForBench,
  encodeLiteralsSection,
  type LiteralEntropyContext,
  type LiteralEntropyTable,
} from './literalsEncoder.js';

// Predefined FSE tables built once and reused for sequence encoding.
let cachedLLTable: FSEDecodeTable | null = null;
let cachedOFTable: FSEDecodeTable | null = null;
let cachedMLTable: FSEDecodeTable | null = null;
function getPredefinedFSETables(): {
  ll: FSEDecodeTable;
  of: FSEDecodeTable;
  ml: FSEDecodeTable;
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
const pathTableCache = new WeakMap<FSEDecodeTable, PrecomputedPathTable>();
let pathMasksScratch: Uint32Array | null = null;
let pathNextChoiceScratch: Int32Array | null = null;
let sequenceReadCountsScratch: Uint8Array | null = null;
let sequenceReadValuesScratch: Uint32Array | null = null;

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
  llTable: FSEDecodeTable;
  llTableLog: number;
  ofTable: FSEDecodeTable;
  ofTableLog: number;
  mlTable: FSEDecodeTable;
  mlTableLog: number;
}

export interface SequenceEntropyContext {
  prevTables: SequenceTablesState | null;
  prevLiteralsTable?: LiteralEntropyTable | null;
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

function getPrecomputedPathTable(table: FSEDecodeTable): PrecomputedPathTable {
  const cached = pathTableCache.get(table);
  if (cached) return cached;
  const tableSize = table.length;
  const wordCount = Math.max(1, Math.ceil(tableSize / 32));
  const baselineByState = new Int32Array(tableSize);
  const minNextByState = new Int32Array(tableSize);
  const maxNextByState = new Int32Array(tableSize);
  let maxSymbol = -1;
  for (let s = 0; s < tableSize; s++) {
    const baseline = table.baseline[s]!;
    const bits = table.numBits[s]!;
    baselineByState[s] = baseline;
    const width = bits > 0 ? 1 << bits : 1;
    const minNext = baseline;
    const maxNext = baseline + width - 1;
    minNextByState[s] = minNext < 0 ? 0 : minNext;
    maxNextByState[s] = maxNext >= tableSize ? tableSize - 1 : maxNext;
    const symbol = table.symbol[s]!;
    if (symbol > maxSymbol) maxSymbol = symbol;
  }
  const statesBySymbol = Array.from({ length: maxSymbol + 1 }, () => [] as number[]);
  const symbolMasks = Array.from({ length: maxSymbol + 1 }, () => new Uint32Array(wordCount));
  for (let s = 0; s < tableSize; s++) {
    const sym = table.symbol[s]!;
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
  return pathNextChoiceScratch;
}

function getSequenceReadCountsScratch(requiredLength: number): Uint8Array {
  if (!sequenceReadCountsScratch || sequenceReadCountsScratch.length < requiredLength) {
    sequenceReadCountsScratch = new Uint8Array(requiredLength);
  }
  return sequenceReadCountsScratch;
}

function getSequenceReadValuesScratch(requiredLength: number): Uint32Array {
  if (!sequenceReadValuesScratch || sequenceReadValuesScratch.length < requiredLength) {
    sequenceReadValuesScratch = new Uint32Array(requiredLength);
  }
  return sequenceReadValuesScratch;
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
  table: FSEDecodeTable,
): { states: number[]; updateBits: number[] } | null {
  if (codes.length === 0) return { states: [], updateBits: [] };
  const pre = getPrecomputedPathTable(table);
  const { tableSize, wordCount, statesBySymbol, symbolMasks, minNextByState, maxNextByState, baselineByState } = pre;
  if (tableSize <= 0) return null;
  const rowCount = codes.length;
  if (rowCount === 1) {
    const onlyCode = codes[0] ?? -1;
    if (onlyCode < 0 || onlyCode >= statesBySymbol.length) return null;
    const onlyStates = statesBySymbol[onlyCode];
    if (!onlyStates || onlyStates.length === 0) return null;
    const firstState = onlyStates[0];
    if (firstState === undefined) return null;
    return { states: [firstState], updateBits: [] };
  }
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
    masks[lastMaskOffset + wi] = lastMask[wi]!;
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
    const nextState = nextChoice[nextChoiceOffset(i) + state]!;
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

interface SymbolizedSequencesScratch {
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

let symbolizedScratch: SymbolizedSequencesScratch | null = null;

function ensureSymbolizedScratch(minLength: number): SymbolizedSequencesScratch {
  const existing = symbolizedScratch;
  if (existing && existing.llCodes.length >= minLength) {
    return existing;
  }
  let capacity = existing?.llCodes.length ?? 0;
  if (capacity === 0) capacity = 32;
  while (capacity < minLength) capacity *= 2;
  symbolizedScratch = {
    llCodes: new Uint8Array(capacity),
    llExtraN: new Uint8Array(capacity),
    llExtraValue: new Uint32Array(capacity),
    mlCodes: new Uint8Array(capacity),
    mlExtraN: new Uint8Array(capacity),
    mlExtraValue: new Uint32Array(capacity),
    ofCodes: new Uint8Array(capacity),
    ofExtraN: new Uint8Array(capacity),
    ofExtraValue: new Uint32Array(capacity),
  };
  return symbolizedScratch;
}

interface StreamChoice {
  mode: 0 | 2 | 3;
  table: FSEDecodeTable;
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

function scorePath(path: { states: number[] }, table: FSEDecodeTable, tableLog: number): number {
  if (path.states.length === 0) return 0;
  let bits = tableLog;
  for (let i = 0; i < path.states.length - 1; i++) {
    const state = path.states[i] ?? -1;
    if (state < 0 || state >= table.length) return Number.POSITIVE_INFINITY;
    bits += table.numBits[state]!;
  }
  return bits;
}

const normalizedTableCache = new Map<
  string,
  { table: FSEDecodeTable; tableLog: number; header: Uint8Array }
>();

function getNormalizedTableCandidates(
  codes: ArrayLike<number>,
  maxTableLog: number,
): Array<{ table: FSEDecodeTable; tableLog: number; header: Uint8Array }> {
  const alphabetSize = symbolRange(codes);
  if (alphabetSize <= 0) return [];
  const histogram = buildHistogram(codes, alphabetSize);
  let distinct = 0;
  for (let i = 0; i < histogram.length; i++) {
    if ((histogram[i] ?? 0) > 0) distinct++;
  }
  if (distinct <= 1) return [];
  let minTableLog = 5;
  while (1 << minTableLog < distinct && minTableLog < maxTableLog) minTableLog++;
  if (1 << minTableLog < distinct) return [];
  const maxLogFromSamples = codes.length > 1 ? 31 - Math.clz32(codes.length - 1) : 5;
  const limit = Math.max(minTableLog, Math.min(maxTableLog, maxLogFromSamples + 1));
  const results: Array<{ table: FSEDecodeTable; tableLog: number; header: Uint8Array }> = [];
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
  const scratch = ensureSymbolizedScratch(numSequences);
  const llCodes = scratch.llCodes.subarray(0, numSequences);
  const llExtraN = scratch.llExtraN.subarray(0, numSequences);
  const llExtraValue = scratch.llExtraValue.subarray(0, numSequences);
  const mlCodes = scratch.mlCodes.subarray(0, numSequences);
  const mlExtraN = scratch.mlExtraN.subarray(0, numSequences);
  const mlExtraValue = scratch.mlExtraValue.subarray(0, numSequences);
  const ofCodes = scratch.ofCodes.subarray(0, numSequences);
  const ofExtraN = scratch.ofExtraN.subarray(0, numSequences);
  const ofExtraValue = scratch.ofExtraValue.subarray(0, numSequences);

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
  predefinedTable: FSEDecodeTable,
  predefinedTableLog: number,
  maxTableLog: number,
  prevTable: FSEDecodeTable | null,
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
      const compressedScore =
        scorePath(compressedPath, compressed.table, compressed.tableLog) + compressed.header.length * 8;
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
  const readCounts = getSequenceReadCountsScratch(chunkCount).subarray(0, chunkCount);
  const readValues = getSequenceReadValuesScratch(chunkCount).subarray(0, chunkCount);
  const llStates = llChoice.path.states;
  const llUpdates = llChoice.path.updateBits;
  const ofStates = ofChoice.path.states;
  const ofUpdates = ofChoice.path.updateBits;
  const mlStates = mlChoice.path.states;
  const mlUpdates = mlChoice.path.updateBits;
  const ofExtraN = encoded.ofExtraN;
  const ofExtraValue = encoded.ofExtraValue;
  const mlExtraN = encoded.mlExtraN;
  const mlExtraValue = encoded.mlExtraValue;
  const llExtraN = encoded.llExtraN;
  const llExtraValue = encoded.llExtraValue;
  let readPos = 0;
  readCounts[readPos] = llChoice.tableLog;
  readValues[readPos++] = llStates[0]!;
  readCounts[readPos] = ofChoice.tableLog;
  readValues[readPos++] = ofStates[0]!;
  readCounts[readPos] = mlChoice.tableLog;
  readValues[readPos++] = mlStates[0]!;
  for (let i = 0; i < numSequences; i++) {
    readCounts[readPos] = ofExtraN[i]!;
    readValues[readPos++] = ofExtraValue[i]!;
    readCounts[readPos] = mlExtraN[i]!;
    readValues[readPos++] = mlExtraValue[i]!;
    readCounts[readPos] = llExtraN[i]!;
    readValues[readPos++] = llExtraValue[i]!;
    if (i !== numSequences - 1) {
      const llState = llStates[i]!;
      const mlState = mlStates[i]!;
      const ofState = ofStates[i]!;
      if (
        llState < 0 ||
        llState >= llChoice.table.length ||
        mlState < 0 ||
        mlState >= mlChoice.table.length ||
        ofState < 0 ||
        ofState >= ofChoice.table.length
      ) {
        return null;
      }
      readCounts[readPos] = llChoice.table.numBits[llState]!;
      readValues[readPos++] = llUpdates[i]!;
      readCounts[readPos] = mlChoice.table.numBits[mlState]!;
      readValues[readPos++] = mlUpdates[i]!;
      readCounts[readPos] = ofChoice.table.numBits[ofState]!;
      readValues[readPos++] = ofUpdates[i]!;
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
  const literalsContext: LiteralEntropyContext = {
    prevTable: context?.prevLiteralsTable ?? null,
  };
  const encodedLiterals = encodeLiteralsSection(literals, literalsContext);
  if (!encodedLiterals) return null;
  const literalsSection = encodedLiterals.section;
  const seqSection = buildSequenceSection(sequences, context);
  if (!seqSection) return null;
  const out = new Uint8Array(literalsSection.length + seqSection.section.length);
  out.set(literalsSection, 0);
  out.set(seqSection.section, literalsSection.length);
  if (context) {
    context.prevTables = seqSection.tables;
    context.prevLiteralsTable = encodedLiterals.table;
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
  buildGeneralCompressedLiterals: buildGeneralCompressedLiteralsForBench,
  buildPredefinedSequenceSection: (sequences: readonly Sequence[]) => buildSequenceSection(sequences)?.section ?? null,
  buildSequenceSection,
};
