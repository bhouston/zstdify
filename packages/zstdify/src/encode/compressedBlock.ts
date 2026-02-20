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

interface ReverseReadChunk {
  n: number;
  value: number;
}

function writeU24LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
}

function encodeReverseBitstream(readOrder: ReverseReadChunk[]): Uint8Array {
  const bits: number[] = [];
  const writeBitsLSB = (n: number, value: number) => {
    for (let i = 0; i < n; i++) {
      bits.push((value >>> i) & 1);
    }
  };
  for (let i = readOrder.length - 1; i >= 0; i--) {
    const chunk = readOrder[i];
    if (!chunk || chunk.n <= 0) continue;
    writeBitsLSB(chunk.n, chunk.value);
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

  const stream = encodeReverseBitstream(
    new Array(literals.length).fill(0).map(() => ({ n: maxNumBits, value: symbolCode })),
  );

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
  const symbols = new Set<number>();
  for (const byte of literals) {
    symbols.add(byte);
  }
  if (symbols.size === 0 || symbols.size > 128) return null;
  const sortedSymbols = [...symbols].sort((a, b) => a - b);
  const maxSymbol = sortedSymbols[sortedSymbols.length - 1] ?? 0;
  if (maxSymbol > 127) return null;

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

  const symbolCode = new Map<number, number>();
  for (const symbol of sortedSymbols) {
    const code = table.findIndex((row) => row?.symbol === symbol);
    if (code < 0) return null;
    symbolCode.set(symbol, code);
  }

  const stream = encodeReverseBitstream(
    new Array(literals.length).fill(0).map((_, i) => ({
      n: 8,
      value: symbolCode.get(literals[i] ?? 0) ?? 0,
    })),
  );

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
  codes: readonly number[],
  table: readonly FSEDecodeRow[],
): { states: number[]; updateBits: number[] } | null {
  if (codes.length === 0) return { states: [], updateBits: [] };
  const tableSize = table.length;
  const statesByCode = new Map<number, number[]>();
  for (let s = 0; s < tableSize; s++) {
    const row = table[s];
    if (!row) continue;
    const arr = statesByCode.get(row.symbol) ?? [];
    arr.push(s);
    statesByCode.set(row.symbol, arr);
  }

  const possible: Array<Set<number>> = new Array(codes.length);
  const nextChoice: Array<Map<number, number>> = new Array(codes.length);
  for (let i = 0; i < codes.length; i++) {
    possible[i] = new Set<number>();
    nextChoice[i] = new Map<number, number>();
  }
  const lastCandidates = statesByCode.get(codes[codes.length - 1] ?? -1) ?? [];
  const lastSet = possible[codes.length - 1];
  if (!lastSet) return null;
  for (const s of lastCandidates) {
    lastSet.add(s);
  }
  if (lastSet.size === 0) return null;

  for (let i = codes.length - 2; i >= 0; i--) {
    const candidates = statesByCode.get(codes[i] ?? -1) ?? [];
    const nextSet = possible[i + 1];
    const curSet = possible[i];
    const curNextChoice = nextChoice[i];
    if (!nextSet || !curSet || !curNextChoice) return null;
    for (const s of candidates) {
      const row = table[s];
      if (!row) continue;
      const width = row.numBits > 0 ? 1 << row.numBits : 1;
      const minNext = row.baseline;
      const maxNext = row.baseline + width - 1;
      let chosen = -1;
      for (const n of nextSet) {
        if (n >= minNext && n <= maxNext) {
          chosen = n;
          break;
        }
      }
      if (chosen >= 0) {
        curSet.add(s);
        curNextChoice.set(s, chosen);
      }
    }
    if (curSet.size === 0) return null;
  }

  const states: number[] = new Array(codes.length);
  const updateBits: number[] = new Array(Math.max(0, codes.length - 1));
  const firstSet = possible[0];
  if (!firstSet) return null;
  const first = firstSet.values().next().value as number | undefined;
  if (first === undefined) return null;
  states[0] = first;
  for (let i = 0; i < codes.length - 1; i++) {
    const cur = states[i];
    if (cur === undefined) return null;
    const choices = nextChoice[i];
    if (!choices) return null;
    const next = choices.get(cur);
    if (next === undefined) return null;
    states[i + 1] = next;
    const row = table[cur];
    if (!row) return null;
    updateBits[i] = next - row.baseline;
  }
  return { states, updateBits };
}

function buildPredefinedSequenceSection(sequences: readonly Sequence[]): Uint8Array | null {
  if (sequences.length === 0) return null;
  const numSequencesBytes = encodeNumSequences(sequences.length);
  if (!numSequencesBytes) return null;

  const llCodes: number[] = [];
  const llExtra: Array<{ n: number; value: number }> = [];
  const mlCodes: number[] = [];
  const mlExtra: Array<{ n: number; value: number }> = [];
  const ofCodes: number[] = [];
  const ofExtra: Array<{ n: number; value: number }> = [];

  for (const sequence of sequences) {
    const ll = findLengthCode(sequence.literalsLength, LL_BASELINE, LL_NUMBITS, 15, 0);
    const ml = findLengthCode(sequence.matchLength, ML_BASELINE, ML_NUMBITS, 34, 3);
    if (!ll || !ml) return null;
    const offsetValue = sequence.offset;
    if (offsetValue < 1) return null;
    const ofCode = 31 - Math.clz32(offsetValue);
    if (ofCode < 0 || ofCode > 28) return null;
    const ofEx = offsetValue - (1 << ofCode);

    llCodes.push(ll.code);
    llExtra.push({ n: ll.extraN, value: ll.extra });
    mlCodes.push(ml.code);
    mlExtra.push({ n: ml.extraN, value: ml.extra });
    ofCodes.push(ofCode);
    ofExtra.push({ n: ofCode, value: ofEx });
  }

  const llTable = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
  const ofTable = buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG);
  const mlTable = buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG);

  const llPath = buildStatePath(llCodes, llTable);
  const ofPath = buildStatePath(ofCodes, ofTable);
  const mlPath = buildStatePath(mlCodes, mlTable);
  if (!llPath || !ofPath || !mlPath) return null;

  const readChunks: ReverseReadChunk[] = [
    { n: LITERALS_LENGTH_TABLE_LOG, value: llPath.states[0] ?? 0 },
    { n: OFFSET_CODE_TABLE_LOG, value: ofPath.states[0] ?? 0 },
    { n: MATCH_LENGTH_TABLE_LOG, value: mlPath.states[0] ?? 0 },
  ];
  for (let i = 0; i < sequences.length; i++) {
    readChunks.push(ofExtra[i] ?? { n: 0, value: 0 });
    readChunks.push(mlExtra[i] ?? { n: 0, value: 0 });
    readChunks.push(llExtra[i] ?? { n: 0, value: 0 });
    if (i !== sequences.length - 1) {
      const llState = llPath.states[i] ?? 0;
      const mlState = mlPath.states[i] ?? 0;
      const ofState = ofPath.states[i] ?? 0;
      const llRow = llTable[llState];
      const mlRow = mlTable[mlState];
      const ofRow = ofTable[ofState];
      if (!llRow || !mlRow || !ofRow) return null;
      readChunks.push({ n: llRow.numBits, value: llPath.updateBits[i] ?? 0 });
      readChunks.push({ n: mlRow.numBits, value: mlPath.updateBits[i] ?? 0 });
      readChunks.push({ n: ofRow.numBits, value: ofPath.updateBits[i] ?? 0 });
    }
  }

  const bitstream = encodeReverseBitstream(readChunks);
  const out = new Uint8Array(numSequencesBytes.length + 1 + bitstream.length);
  out.set(numSequencesBytes, 0);
  out[numSequencesBytes.length] = 0x00; // predefined LL/OF/ML modes
  out.set(bitstream, numSequencesBytes.length + 1);
  return out;
}

export function buildCompressedBlockPayload(literals: Uint8Array, sequences: Sequence[]): Uint8Array | null {
  const literalsSection =
    buildSingleSymbolCompressedLiterals(literals) ??
    buildGeneralCompressedLiterals(literals) ??
    buildRawLiteralsSection(literals);
  if (!literalsSection) return null;
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
