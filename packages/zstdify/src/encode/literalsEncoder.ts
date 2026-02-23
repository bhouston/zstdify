import { BitWriter } from '../bitstream/bitWriter.js';
import { encodeReverseBitstream, ReverseBitWriter } from '../bitstream/reverseBitWriter.js';
import { buildFSEDecodeTable, normalizeCountsForTable, readNCount, writeNCount } from '../entropy/fse.js';
import { buildHuffmanDecodeTable, weightsToNumBits } from '../entropy/huffman.js';
import { readWeightsFSE } from '../entropy/weights.js';

export interface LiteralEntropyTable {
  maxNumBits: number;
  codeBySymbol: Int32Array;
  numBitsBySymbol: Uint8Array;
}

export interface LiteralEntropyContext {
  prevTable: LiteralEntropyTable | null;
}

export interface EncodedLiteralsSection {
  section: Uint8Array;
  table: LiteralEntropyTable | null;
}

interface HuffmanBuildResult {
  weights: number[];
  table: LiteralEntropyTable;
}

let literalBitCountsScratch: Uint8Array | null = null;
let literalBitValuesScratch: Uint32Array | null = null;
const WEIGHT_MAX_SYMBOL = 11;
const WEIGHT_MAX_TABLE_LOG = 7;

function ensureLiteralBitScratch(minLength: number): { counts: Uint8Array; values: Uint32Array } {
  const counts = literalBitCountsScratch;
  const values = literalBitValuesScratch;
  if (counts && values && counts.length >= minLength && values.length >= minLength) {
    return { counts, values };
  }
  let capacity = counts?.length ?? 0;
  if (capacity === 0) capacity = 64;
  while (capacity < minLength) capacity *= 2;
  literalBitCountsScratch = new Uint8Array(capacity);
  literalBitValuesScratch = new Uint32Array(capacity);
  return { counts: literalBitCountsScratch, values: literalBitValuesScratch };
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

function buildRLELiteralsSection(literals: Uint8Array): Uint8Array | null {
  if (literals.length === 0) return null;
  const value = literals[0] ?? 0;
  for (let i = 1; i < literals.length; i++) {
    if ((literals[i] ?? 0) !== value) return null;
  }
  const size = literals.length;
  if (size <= 31) {
    return new Uint8Array([(size << 3) | 1, value]);
  }
  if (size <= 0x0fff) {
    return new Uint8Array([((size & 0x0f) << 4) | (1 << 2) | 1, (size >>> 4) & 0xff, value]);
  }
  if (size <= 0x0f_ffff) {
    return new Uint8Array([((size & 0x0f) << 4) | (3 << 2) | 1, (size >>> 4) & 0xff, (size >>> 12) & 0xff, value]);
  }
  return null;
}

function buildHuffmanDepths(freq: Uint32Array): Uint8Array | null {
  type Node = { freq: number; symbol: number; left: number; right: number };
  const nodes: Node[] = [];
  const active: number[] = [];
  for (let s = 0; s < freq.length; s++) {
    const f = freq[s] ?? 0;
    if (f > 0) {
      nodes.push({ freq: f, symbol: s, left: -1, right: -1 });
      active.push(nodes.length - 1);
    }
  }
  if (active.length < 2) return null;
  while (active.length > 1) {
    active.sort((a, b) => {
      const fa = nodes[a]?.freq ?? 0;
      const fb = nodes[b]?.freq ?? 0;
      if (fa !== fb) return fa - fb;
      return (nodes[a]?.symbol ?? 0) - (nodes[b]?.symbol ?? 0);
    });
    const leftIdx = active.shift();
    const rightIdx = active.shift();
    if (leftIdx === undefined || rightIdx === undefined) return null;
    const merged: Node = {
      freq: (nodes[leftIdx]?.freq ?? 0) + (nodes[rightIdx]?.freq ?? 0),
      symbol: Math.min(nodes[leftIdx]?.symbol ?? 0, nodes[rightIdx]?.symbol ?? 0),
      left: leftIdx,
      right: rightIdx,
    };
    nodes.push(merged);
    active.push(nodes.length - 1);
  }
  const root = active[0];
  if (root === undefined) return null;
  const depths = new Uint8Array(freq.length);
  const stack: Array<{ idx: number; depth: number }> = [{ idx: root, depth: 0 }];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) break;
    const node = nodes[cur.idx];
    if (!node) return null;
    if (node.left < 0 && node.right < 0) {
      depths[node.symbol] = cur.depth === 0 ? 1 : cur.depth;
      continue;
    }
    if (node.left >= 0) stack.push({ idx: node.left, depth: cur.depth + 1 });
    if (node.right >= 0) stack.push({ idx: node.right, depth: cur.depth + 1 });
  }
  return depths;
}

function buildFrequencyHuffmanTable(literals: Uint8Array): HuffmanBuildResult | null {
  if (literals.length < 8) return null;
  let maxSymbol = 0;
  const freq = new Uint32Array(256);
  for (let i = 0; i < literals.length; i++) {
    const b = literals[i] ?? 0;
    freq[b] = (freq[b] ?? 0) + 1;
    if (b > maxSymbol) maxSymbol = b;
  }
  let weights: number[];
  let maxNumBits = 0;
  const fullWeights = new Array<number>(256).fill(0);

  if (maxSymbol < 255) {
    const freqWithPseudo = new Uint32Array(257);
    freqWithPseudo.set(freq, 0);
    const pseudoSymbol = maxSymbol + 1;
    freqWithPseudo[pseudoSymbol] = 1;
    const depths = buildHuffmanDepths(freqWithPseudo);
    if (!depths) return null;
    let maxDepth = 0;
    for (let s = 0; s <= pseudoSymbol; s++) {
      const d = depths[s] ?? 0;
      if (d > maxDepth) maxDepth = d;
    }
    if (maxDepth <= 0 || maxDepth > 11) return null;
    maxNumBits = maxDepth;

    weights = new Array<number>(maxSymbol + 1).fill(0);
    for (let s = 0; s <= maxSymbol; s++) {
      const d = depths[s] ?? 0;
      if (d > 0) weights[s] = maxDepth + 1 - d;
    }
    for (let i = 0; i < weights.length; i++) fullWeights[i] = weights[i] ?? 0;
    const pseudoDepth = depths[pseudoSymbol] ?? 0;
    if (pseudoDepth <= 0) return null;
    fullWeights[pseudoSymbol] = maxDepth + 1 - pseudoDepth;
  } else {
    // For full 0..255 byte alphabets we omit symbol 255 from transmitted weights;
    // the decoder infers the final symbol weight from the Kraft remainder.
    const depths = buildHuffmanDepths(freq);
    if (!depths) return null;
    let maxDepth = 0;
    for (let s = 0; s < 256; s++) {
      const d = depths[s] ?? 0;
      if (d > maxDepth) maxDepth = d;
    }
    if (maxDepth <= 0 || maxDepth > 11) return null;
    maxNumBits = maxDepth;

    weights = new Array<number>(255).fill(0);
    for (let s = 0; s < 256; s++) {
      const d = depths[s] ?? 0;
      if (d > 0) fullWeights[s] = maxDepth + 1 - d;
    }
    if ((fullWeights[255] ?? 0) <= 0) return null;
    for (let s = 0; s < 255; s++) {
      weights[s] = fullWeights[s] ?? 0;
    }
  }

  if (maxNumBits <= 0) return null;
  const numBits = weightsToNumBits(fullWeights, maxNumBits);
  const decodeTable = buildHuffmanDecodeTable(numBits, maxNumBits);
  const codeBySymbol = new Int32Array(256).fill(-1);
  const numBitsBySymbol = new Uint8Array(256);
  for (let i = 0; i < decodeTable.length; i++) {
    const bits = decodeTable.numBits[i]!;
    if (bits === 0) continue;
    const symbol = decodeTable.symbol[i]! >>> 0;
    if (symbol >= codeBySymbol.length) return null;
    if ((codeBySymbol[symbol] ?? -1) < 0) {
      codeBySymbol[symbol] = i >>> (maxNumBits - bits);
      numBitsBySymbol[symbol] = bits;
    }
  }
  for (let i = 0; i < literals.length; i++) {
    const sym = literals[i] ?? 0;
    if ((codeBySymbol[sym] ?? -1) < 0 || (numBitsBySymbol[sym] ?? 0) === 0) return null;
  }
  return { weights, table: { maxNumBits, codeBySymbol, numBitsBySymbol } };
}

function encodeLiteralsWithTable(
  table: LiteralEntropyTable,
  literals: Uint8Array,
  reverseBitWriter: ReverseBitWriter,
): Uint8Array | null {
  const scratch = ensureLiteralBitScratch(literals.length);
  const bitCounts = scratch.counts.subarray(0, literals.length);
  const bitValues = scratch.values.subarray(0, literals.length);
  for (let i = 0; i < literals.length; i++) {
    const sym = literals[i] ?? 0;
    const bits = table.numBitsBySymbol[sym] ?? 0;
    const code = table.codeBySymbol[sym] ?? -1;
    if (bits <= 0 || code < 0) return null;
    bitCounts[i] = bits;
    bitValues[i] = code;
  }
  return encodeReverseBitstream(bitCounts, bitValues, reverseBitWriter);
}

function splitLiteralsInto4(literals: Uint8Array): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const total = literals.length;
  const s1Len = Math.floor((total + 3) / 4);
  const s2Len = Math.floor((total + 2) / 4);
  const s3Len = Math.floor((total + 1) / 4);
  const s4Len = total - s1Len - s2Len - s3Len;
  const s1 = literals.subarray(0, s1Len);
  const s2 = literals.subarray(s1Len, s1Len + s2Len);
  const s3 = literals.subarray(s1Len + s2Len, s1Len + s2Len + s3Len);
  const s4 = literals.subarray(s1Len + s2Len + s3Len, s1Len + s2Len + s3Len + s4Len);
  return [s1, s2, s3, s4];
}

interface FSEUpdatePath {
  states: number[];
  updateBits: number[];
  startState: number;
}

function buildFSEUpdatePath(
  table: ReturnType<typeof buildFSEDecodeTable>,
  updateSymbols: readonly number[],
  requiredFinalSymbol: number | null,
): FSEUpdatePath | null {
  const tableSize = table.length;
  if (tableSize <= 0) return null;

  if (updateSymbols.length === 0) {
    if (requiredFinalSymbol === null) return null;
    for (let state = 0; state < tableSize; state++) {
      if ((table.symbol[state] ?? -1) === requiredFinalSymbol) {
        return { states: [], updateBits: [], startState: state };
      }
    }
    return null;
  }

  const rowCount = updateSymbols.length;
  const reachable = new Uint8Array((rowCount + 1) * tableSize);
  const nextChoice = new Int32Array(rowCount * tableSize);
  nextChoice.fill(-1);
  const rowOffset = (rowIndex: number) => rowIndex * tableSize;

  const finalRowOffset = rowOffset(rowCount);
  for (let state = 0; state < tableSize; state++) {
    if (requiredFinalSymbol === null || (table.symbol[state] ?? -1) === requiredFinalSymbol) {
      reachable[finalRowOffset + state] = 1;
    }
  }

  for (let row = rowCount - 1; row >= 0; row--) {
    const symbol = updateSymbols[row] ?? -1;
    if (symbol < 0 || symbol > WEIGHT_MAX_SYMBOL) return null;
    const curOffset = rowOffset(row);
    const nextOffset = rowOffset(row + 1);
    let anyReachable = false;
    for (let state = 0; state < tableSize; state++) {
      if ((table.symbol[state] ?? -1) !== symbol) continue;
      const baseline = table.baseline[state] ?? 0;
      const bits = table.numBits[state] ?? 0;
      const width = bits > 0 ? 1 << bits : 1;
      let minNext = baseline;
      let maxNext = baseline + width - 1;
      if (minNext < 0) minNext = 0;
      if (maxNext >= tableSize) maxNext = tableSize - 1;
      for (let next = minNext; next <= maxNext; next++) {
        if (reachable[nextOffset + next] === 0) continue;
        reachable[curOffset + state] = 1;
        nextChoice[curOffset + state] = next;
        anyReachable = true;
        break;
      }
    }
    if (!anyReachable) return null;
  }

  const startOffset = rowOffset(0);
  let startState = -1;
  for (let state = 0; state < tableSize; state++) {
    if (reachable[startOffset + state] !== 0) {
      startState = state;
      break;
    }
  }
  if (startState < 0) return null;

  const states = new Array<number>(rowCount);
  const updateBits = new Array<number>(rowCount);
  let state = startState;
  for (let row = 0; row < rowCount; row++) {
    states[row] = state;
    const next = nextChoice[rowOffset(row) + state] ?? -1;
    if (next < 0) return null;
    updateBits[row] = next - (table.baseline[state] ?? 0);
    state = next;
  }

  return { states, updateBits, startState };
}

function buildCompressedLiteralsHeader(
  blockType: 2 | 3,
  sizeFormat: 0 | 1 | 2 | 3,
  regeneratedSize: number,
  compressedSize: number,
): Uint8Array {
  const bits = sizeFormat <= 1 ? 10 : sizeFormat === 2 ? 14 : 18;
  const writer = new BitWriter();
  writer.writeBits(2, blockType);
  writer.writeBits(2, sizeFormat);
  writer.writeBits(bits, regeneratedSize);
  writer.writeBits(bits, compressedSize);
  return writer.flush();
}

function makeCompressedSection(
  literals: Uint8Array,
  table: LiteralEntropyTable,
  blockType: 2 | 3,
  treeBytes: Uint8Array,
  reverseBitWriter: ReverseBitWriter,
): Uint8Array | null {
  const oneStream = encodeLiteralsWithTable(table, literals, reverseBitWriter);
  let bestPayload: Uint8Array | null = null;
  let bestSizeFormat: 0 | 1 | 2 | 3 | null = null;

  if (oneStream) {
    const compressedSize = treeBytes.length + oneStream.length;
    if (literals.length <= 0x03ff && compressedSize <= 0x03ff) {
      bestPayload = new Uint8Array(treeBytes.length + oneStream.length);
      bestPayload.set(treeBytes, 0);
      bestPayload.set(oneStream, treeBytes.length);
      bestSizeFormat = 0;
    }
  }

  if (literals.length >= 16) {
    const [s1, s2, s3, s4] = splitLiteralsInto4(literals);
    const e1 = encodeLiteralsWithTable(table, s1, reverseBitWriter);
    const e2 = encodeLiteralsWithTable(table, s2, reverseBitWriter);
    const e3 = encodeLiteralsWithTable(table, s3, reverseBitWriter);
    const e4 = encodeLiteralsWithTable(table, s4, reverseBitWriter);
    if (e1 && e2 && e3 && e4 && e1.length <= 0xffff && e2.length <= 0xffff && e3.length <= 0xffff) {
      const streamsSize = 6 + e1.length + e2.length + e3.length + e4.length;
      const compressedSize = treeBytes.length + streamsSize;
      let sizeFormat: 1 | 2 | 3 | null = null;
      if (literals.length <= 0x03ff && compressedSize <= 0x03ff) {
        sizeFormat = 1;
      } else if (literals.length <= 0x3fff && compressedSize <= 0x3fff) {
        sizeFormat = 2;
      } else if (literals.length <= 0x3ffff && compressedSize <= 0x3ffff) {
        sizeFormat = 3;
      }
      if (sizeFormat !== null) {
        const payload = new Uint8Array(treeBytes.length + streamsSize);
        payload.set(treeBytes, 0);
        let pos = treeBytes.length;
        payload[pos++] = e1.length & 0xff;
        payload[pos++] = (e1.length >>> 8) & 0xff;
        payload[pos++] = e2.length & 0xff;
        payload[pos++] = (e2.length >>> 8) & 0xff;
        payload[pos++] = e3.length & 0xff;
        payload[pos++] = (e3.length >>> 8) & 0xff;
        payload.set(e1, pos);
        pos += e1.length;
        payload.set(e2, pos);
        pos += e2.length;
        payload.set(e3, pos);
        pos += e3.length;
        payload.set(e4, pos);
        if (!bestPayload || payload.length < bestPayload.length) {
          bestPayload = payload;
          bestSizeFormat = sizeFormat;
        }
      }
    }
  }

  if (!bestPayload || bestSizeFormat === null) return null;
  const header = buildCompressedLiteralsHeader(blockType, bestSizeFormat, literals.length, bestPayload.length);
  const out = new Uint8Array(header.length + bestPayload.length);
  out.set(header, 0);
  out.set(bestPayload, header.length);
  return out;
}

function createDirectWeightsTreeBytes(weights: number[]): Uint8Array | null {
  if (weights.length < 1 || weights.length > 128) return null;
  const tree = new Uint8Array(1 + Math.ceil(weights.length / 2));
  tree[0] = 127 + weights.length;
  for (let i = 0; i < weights.length; i += 2) {
    const hi = weights[i] ?? 0;
    const lo = weights[i + 1] ?? 0;
    tree[1 + (i >>> 1)] = ((hi & 0x0f) << 4) | (lo & 0x0f);
  }
  return tree;
}

function createFSEWeightsTreeBytes(weights: number[]): Uint8Array | null {
  if (weights.length < 2 || weights.length > 255) return null;
  let maxWeight = 0;
  for (let i = 0; i < weights.length; i++) {
    const value = weights[i] ?? 0;
    if (value < 0 || value > WEIGHT_MAX_SYMBOL) return null;
    if (value > maxWeight) maxWeight = value;
  }

  const histogram = new Array<number>(maxWeight + 1).fill(0);
  for (let i = 0; i < weights.length; i++) {
    const value = weights[i] ?? 0;
    histogram[value] = (histogram[value] ?? 0) + 1;
  }

  const stream1: number[] = [];
  const stream2: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    if ((i & 1) === 0) stream1.push(weights[i] ?? 0);
    else stream2.push(weights[i] ?? 0);
  }
  const tailOnStream1 = (weights.length & 1) === 1;
  const stream1Updates = tailOnStream1 ? stream1.slice(0, -1) : stream1.slice();
  const stream2Updates = tailOnStream1 ? stream2.slice() : stream2.slice(0, -1);
  const stream1Tail = tailOnStream1 ? (stream1[stream1.length - 1] ?? null) : null;
  const stream2Tail = tailOnStream1 ? null : (stream2[stream2.length - 1] ?? null);
  const updateCount = weights.length - 1;
  const usedSymbols: number[] = [];
  for (let symbol = 0; symbol < histogram.length; symbol++) {
    if ((histogram[symbol] ?? 0) > 0) usedSymbols.push(symbol);
  }
  if (usedSymbols.length === 0) return null;

  for (let tableLog = WEIGHT_MAX_TABLE_LOG; tableLog >= 5; tableLog--) {
    const normalizedCandidates: Array<{ normalizedCounter: ArrayLike<number>; maxSymbolValue: number }> = [];
    normalizedCandidates.push(normalizeCountsForTable(histogram, tableLog));
    const tableSize = 1 << tableLog;
    if (usedSymbols.length <= tableSize) {
      const uniform = new Array<number>(maxWeight + 1).fill(0);
      for (let i = 0; i < usedSymbols.length; i++) {
        const symbol = usedSymbols[i] ?? -1;
        if (symbol >= 0) uniform[symbol] = 1;
      }
      let remaining = tableSize - usedSymbols.length;
      let cursor = 0;
      while (remaining > 0) {
        const symbol = usedSymbols[cursor % usedSymbols.length] ?? -1;
        if (symbol >= 0) uniform[symbol] = (uniform[symbol] ?? 0) + 1;
        remaining--;
        cursor++;
      }
      normalizedCandidates.push({ normalizedCounter: uniform, maxSymbolValue: maxWeight });
    }

    for (const normalized of normalizedCandidates) {
      const header = writeNCount(normalized.normalizedCounter, normalized.maxSymbolValue, tableLog);
      const parsed = readNCount(header, 0, WEIGHT_MAX_SYMBOL, WEIGHT_MAX_TABLE_LOG);
      const table = buildFSEDecodeTable(parsed.normalizedCounter, parsed.tableLog);
      const path1 = buildFSEUpdatePath(table, stream1Updates, stream1Tail);
      if (!path1) continue;
      const path2 = buildFSEUpdatePath(table, stream2Updates, stream2Tail);
      if (!path2) continue;

      const readCounts = new Uint8Array(2 + updateCount);
      const readValues = new Uint32Array(2 + updateCount);
      let readPos = 0;
      readCounts[readPos] = parsed.tableLog;
      readValues[readPos++] = path1.startState;
      readCounts[readPos] = parsed.tableLog;
      readValues[readPos++] = path2.startState;

      let stream1Pos = 0;
      let stream2Pos = 0;
      for (let i = 0; i < updateCount; i++) {
        if ((i & 1) === 0) {
          const state = path1.states[stream1Pos] ?? -1;
          if (state < 0) return null;
          readCounts[readPos] = table.numBits[state] ?? 0;
          readValues[readPos++] = path1.updateBits[stream1Pos] ?? 0;
          stream1Pos++;
        } else {
          const state = path2.states[stream2Pos] ?? -1;
          if (state < 0) return null;
          readCounts[readPos] = table.numBits[state] ?? 0;
          readValues[readPos++] = path2.updateBits[stream2Pos] ?? 0;
          stream2Pos++;
        }
      }

      const bitstream = encodeReverseBitstream(readCounts, readValues, new ReverseBitWriter());
      const bodySize = header.length + bitstream.length;
      if (bodySize <= 0 || bodySize >= 128) continue;
      const tree = new Uint8Array(1 + bodySize);
      tree[0] = bodySize;
      tree.set(header, 1);
      tree.set(bitstream, 1 + header.length);
      const roundTrip = readWeightsFSE(tree, 1, bodySize).weights;
      if (roundTrip.length !== weights.length) continue;
      let mismatch = false;
      for (let i = 0; i < weights.length; i++) {
        if ((roundTrip[i] ?? -1) !== (weights[i] ?? -1)) {
          mismatch = true;
          break;
        }
      }
      if (mismatch) continue;
      return tree;
    }
  }

  return null;
}

function createWeightsTreeBytes(weights: number[]): Uint8Array | null {
  return createDirectWeightsTreeBytes(weights) ?? createFSEWeightsTreeBytes(weights);
}

function canEncodeTreeless(table: LiteralEntropyTable, literals: Uint8Array): boolean {
  for (let i = 0; i < literals.length; i++) {
    const sym = literals[i] ?? 0;
    if ((table.codeBySymbol[sym] ?? -1) < 0 || (table.numBitsBySymbol[sym] ?? 0) === 0) return false;
  }
  return true;
}

export function encodeLiteralsSection(
  literals: Uint8Array,
  context?: LiteralEntropyContext,
  reverseBitWriter: ReverseBitWriter = new ReverseBitWriter(),
): EncodedLiteralsSection | null {
  const raw = buildRawLiteralsSection(literals);
  if (!raw) return null;
  let bestSection = raw;
  let bestTable = context?.prevTable ?? null;

  const rle = buildRLELiteralsSection(literals);
  if (rle && rle.length < bestSection.length) {
    bestSection = rle;
  }

  const huffman = buildFrequencyHuffmanTable(literals);
  if (huffman) {
    const treeBytes = createWeightsTreeBytes(huffman.weights);
    if (treeBytes) {
      const compressed = makeCompressedSection(literals, huffman.table, 2, treeBytes, reverseBitWriter);
      if (compressed && compressed.length < bestSection.length) {
        bestSection = compressed;
        bestTable = huffman.table;
      }
    }
  }

  const prev = context?.prevTable ?? null;
  if (prev && canEncodeTreeless(prev, literals)) {
    const treeless = makeCompressedSection(literals, prev, 3, new Uint8Array(0), reverseBitWriter);
    if (treeless && treeless.length < bestSection.length) {
      bestSection = treeless;
      bestTable = prev;
    }
  }

  return { section: bestSection, table: bestTable };
}

export function buildGeneralCompressedLiteralsForBench(literals: Uint8Array): Uint8Array | null {
  const huffman = buildFrequencyHuffmanTable(literals);
  if (!huffman) return null;
  const treeBytes = createWeightsTreeBytes(huffman.weights);
  if (!treeBytes) return null;
  return makeCompressedSection(literals, huffman.table, 2, treeBytes, new ReverseBitWriter());
}
