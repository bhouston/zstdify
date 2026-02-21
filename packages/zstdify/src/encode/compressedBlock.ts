import { BitWriter } from '../bitstream/bitWriter.js';
import type { Sequence } from '../decode/reconstruct.js';
import { buildFSEDecodeTable, type FSEDecodeRow } from '../entropy/fse.js';
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

function encodeReverseBitstream(bitCounts: ArrayLike<number>, bitValues: ArrayLike<number>): Uint8Array {
  const bits: number[] = [];
  const writeBitsLSB = (n: number, value: number) => {
    for (let i = 0; i < n; i++) {
      bits.push((value >>> i) & 1);
    }
  };
  for (let i = bitCounts.length - 1; i >= 0; i--) {
    const n = bitCounts[i] ?? 0;
    if (n <= 0) continue;
    writeBitsLSB(n, bitValues[i] ?? 0);
  }
  // Append end marker, then zero-fill above marker so decoder skips them.
  bits.push(1);
  while ((bits.length & 7) !== 0) {
    bits.push(0);
  }
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if ((bits[i] ?? 0) !== 0) {
      const idx = i >>> 3;
      out[idx] = ((out[idx] ?? 0) | (1 << (i & 7))) & 0xff;
    }
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
  const tableSize = table.length;
  const statesByCode: number[][] = [];
  for (let s = 0; s < tableSize; s++) {
    const row = table[s];
    if (!row) continue;
    const sym = row.symbol;
    if (!statesByCode[sym]) statesByCode[sym] = [];
    statesByCode[sym].push(s);
  }

  const possible: number[][] = Array.from({ length: codes.length }, () => []);
  const nextChoice: Int32Array[] = Array.from(
    { length: codes.length },
    () => new Int32Array(tableSize).fill(-1),
  );

  const lastCode = codes[codes.length - 1] ?? -1;
  const lastCandidates = statesByCode[lastCode] ?? [];
  const lastArr = possible[codes.length - 1];
  if (!lastArr) return null;
  for (let j = 0; j < lastCandidates.length; j++) {
    lastArr.push(lastCandidates[j]!);
  }
  if (lastArr.length === 0) return null;
  if (codes.length === 1) {
    return { states: [lastArr[0]!], updateBits: [] };
  }

  for (let i = codes.length - 2; i >= 0; i--) {
    const candidates = statesByCode[codes[i] ?? -1] ?? [];
    const nextArr = possible[i + 1]!;
    const curArr = possible[i]!;
    const curNext = nextChoice[i]!;
    const nextPresent = new Uint8Array(tableSize);
    for (let j = 0; j < nextArr.length; j++) {
      nextPresent[nextArr[j]!] = 1;
    }
    const nextFrom = new Int32Array(tableSize + 1);
    nextFrom[tableSize] = -1;
    for (let s = tableSize - 1; s >= 0; s--) {
      nextFrom[s] = nextPresent[s] !== 0 ? s : nextFrom[s + 1]!;
    }
    for (let si = 0; si < candidates.length; si++) {
      const s = candidates[si]!;
      const row = table[s];
      if (!row) continue;
      const width = row.numBits > 0 ? 1 << row.numBits : 1;
      const minNext = row.baseline;
      const maxNext = row.baseline + width - 1;
      if (maxNext < 0 || minNext >= tableSize) continue;
      const start = minNext < 0 ? 0 : minNext;
      const chosen = nextFrom[start]!;
      if (chosen >= 0) {
        if (chosen <= maxNext) {
          curArr.push(s);
          curNext[s] = chosen;
        }
      }
    }
    if (curArr.length === 0) return null;
  }

  const states: number[] = new Array(codes.length);
  const updateBits: number[] = new Array(Math.max(0, codes.length - 1));
  const firstArr = possible[0];
  if (!firstArr || firstArr.length === 0) return null;
  states[0] = firstArr[0]!;
  for (let i = 0; i < codes.length - 1; i++) {
    const cur = states[i]!;
    const next = nextChoice[i]![cur];
    if (next === undefined || next < 0) return null;
    states[i + 1] = next;
    const row = table[cur];
    if (!row) return null;
    updateBits[i] = next - row.baseline;
  }
  return { states, updateBits };
}

function buildPredefinedSequenceSection(sequences: readonly Sequence[]): Uint8Array | null {
  if (sequences.length === 0) return null;
  const numSequences = sequences.length;
  const numSequencesBytes = encodeNumSequences(numSequences);
  if (!numSequencesBytes) return null;

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

  const { ll: llTable, of: ofTable, ml: mlTable } = getPredefinedFSETables();

  const llPath = buildStatePath(llCodes, llTable);
  const ofPath = buildStatePath(ofCodes, ofTable);
  const mlPath = buildStatePath(mlCodes, mlTable);
  if (!llPath || !ofPath || !mlPath) return null;

  const chunkCount = numSequences * 6;
  const readCounts = new Uint8Array(chunkCount);
  const readValues = new Uint32Array(chunkCount);
  let readPos = 0;
  readCounts[readPos] = LITERALS_LENGTH_TABLE_LOG;
  readValues[readPos++] = llPath.states[0] ?? 0;
  readCounts[readPos] = OFFSET_CODE_TABLE_LOG;
  readValues[readPos++] = ofPath.states[0] ?? 0;
  readCounts[readPos] = MATCH_LENGTH_TABLE_LOG;
  readValues[readPos++] = mlPath.states[0] ?? 0;
  for (let i = 0; i < numSequences; i++) {
    readCounts[readPos] = ofExtraN[i] ?? 0;
    readValues[readPos++] = ofExtraValue[i] ?? 0;
    readCounts[readPos] = mlExtraN[i] ?? 0;
    readValues[readPos++] = mlExtraValue[i] ?? 0;
    readCounts[readPos] = llExtraN[i] ?? 0;
    readValues[readPos++] = llExtraValue[i] ?? 0;
    if (i !== numSequences - 1) {
      const llState = llPath.states[i] ?? 0;
      const mlState = mlPath.states[i] ?? 0;
      const ofState = ofPath.states[i] ?? 0;
      const llRow = llTable[llState];
      const mlRow = mlTable[mlState];
      const ofRow = ofTable[ofState];
      if (!llRow || !mlRow || !ofRow) return null;
      readCounts[readPos] = llRow.numBits;
      readValues[readPos++] = llPath.updateBits[i] ?? 0;
      readCounts[readPos] = mlRow.numBits;
      readValues[readPos++] = mlPath.updateBits[i] ?? 0;
      readCounts[readPos] = ofRow.numBits;
      readValues[readPos++] = ofPath.updateBits[i] ?? 0;
    }
  }

  const bitstream = encodeReverseBitstream(readCounts, readValues);
  const out = new Uint8Array(numSequencesBytes.length + 1 + bitstream.length);
  out.set(numSequencesBytes, 0);
  out[numSequencesBytes.length] = 0x00; // predefined LL/OF/ML modes
  out.set(bitstream, numSequencesBytes.length + 1);
  return out;
}

export function buildCompressedBlockPayload(literals: Uint8Array, sequences: Sequence[]): Uint8Array | null {
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
  const seqSection = buildPredefinedSequenceSection(sequences);
  if (!seqSection) return null;
  const out = new Uint8Array(literalsSection.length + seqSection.length);
  out.set(literalsSection, 0);
  out.set(seqSection, literalsSection.length);
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
