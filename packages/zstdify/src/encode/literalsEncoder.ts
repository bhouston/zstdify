import { BitWriter } from '../bitstream/bitWriter.js';
import { buildHuffmanDecodeTable, weightsToNumBits } from '../entropy/huffman.js';

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

function encodeReverseBitstream(bitCounts: Uint8Array, bitValues: Uint32Array): Uint8Array {
  let bitLength = 1; // End marker
  for (let i = 0; i < bitCounts.length; i++) {
    bitLength += bitCounts[i] ?? 0;
  }
  const out = new Uint8Array((bitLength + 7) >>> 3);
  let bitPos = 0;
  const writeBitsLSB = (n: number, value: number): void => {
    for (let i = 0; i < n; i++) {
      if (((value >>> i) & 1) !== 0) {
        const idx = bitPos >>> 3;
        out[idx] = ((out[idx] ?? 0) | (1 << (bitPos & 7))) & 0xff;
      }
      bitPos++;
    }
  };
  for (let i = bitCounts.length - 1; i >= 0; i--) {
    const n = bitCounts[i] ?? 0;
    if (n > 0) writeBitsLSB(n, bitValues[i] ?? 0);
  }
  out[bitPos >>> 3] = ((out[bitPos >>> 3] ?? 0) | (1 << (bitPos & 7))) & 0xff;
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
  const freq = new Uint32Array(257);
  for (let i = 0; i < literals.length; i++) {
    const b = literals[i] ?? 0;
    freq[b] = (freq[b] ?? 0) + 1;
    if (b > maxSymbol) maxSymbol = b;
  }
  if (maxSymbol > 127) return null; // Direct-weight path is limited to <= 128 serialized weights.
  const pseudoSymbol = maxSymbol + 1;
  freq[pseudoSymbol] = 1;
  const depths = buildHuffmanDepths(freq);
  if (!depths) return null;
  let maxDepth = 0;
  for (let s = 0; s <= pseudoSymbol; s++) {
    const d = depths[s] ?? 0;
    if (d > maxDepth) maxDepth = d;
  }
  if (maxDepth <= 0 || maxDepth > 11) return null;

  const weights = new Array<number>(maxSymbol + 1).fill(0);
  for (let s = 0; s <= maxSymbol; s++) {
    const d = depths[s] ?? 0;
    if (d > 0) weights[s] = maxDepth + 1 - d;
  }

  const fullWeights = new Array<number>(256).fill(0);
  for (let i = 0; i < weights.length; i++) fullWeights[i] = weights[i] ?? 0;
  const pseudoDepth = depths[pseudoSymbol] ?? 0;
  if (pseudoDepth <= 0) return null;
  fullWeights[pseudoSymbol] = maxDepth + 1 - pseudoDepth;

  const numBits = weightsToNumBits(fullWeights, maxDepth);
  const decodeTable = buildHuffmanDecodeTable(numBits, maxDepth);
  const codeBySymbol = new Int32Array(256).fill(-1);
  const numBitsBySymbol = new Uint8Array(256);
  for (let i = 0; i < decodeTable.length; i++) {
    const row = decodeTable[i];
    if (!row) continue;
    const symbol = row.symbol >>> 0;
    if (symbol >= codeBySymbol.length) return null;
    if ((codeBySymbol[symbol] ?? -1) < 0) codeBySymbol[symbol] = i;
    numBitsBySymbol[symbol] = row.numBits;
  }
  for (let i = 0; i < literals.length; i++) {
    const sym = literals[i] ?? 0;
    if ((codeBySymbol[sym] ?? -1) < 0 || (numBitsBySymbol[sym] ?? 0) === 0) return null;
  }
  return { weights, table: { maxNumBits: maxDepth, codeBySymbol, numBitsBySymbol } };
}

function encodeLiteralsWithTable(table: LiteralEntropyTable, literals: Uint8Array): Uint8Array | null {
  const bitCounts = new Uint8Array(literals.length);
  const bitValues = new Uint32Array(literals.length);
  for (let i = 0; i < literals.length; i++) {
    const sym = literals[i] ?? 0;
    const bits = table.numBitsBySymbol[sym] ?? 0;
    const code = table.codeBySymbol[sym] ?? -1;
    if (bits <= 0 || code < 0) return null;
    bitCounts[i] = bits;
    bitValues[i] = code;
  }
  return encodeReverseBitstream(bitCounts, bitValues);
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
): Uint8Array | null {
  const oneStream = encodeLiteralsWithTable(table, literals);
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
    const e1 = encodeLiteralsWithTable(table, s1);
    const e2 = encodeLiteralsWithTable(table, s2);
    const e3 = encodeLiteralsWithTable(table, s3);
    const e4 = encodeLiteralsWithTable(table, s4);
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
    const treeBytes = createDirectWeightsTreeBytes(huffman.weights);
    if (treeBytes) {
      const compressed = makeCompressedSection(literals, huffman.table, 2, treeBytes);
      if (compressed && compressed.length < bestSection.length) {
        bestSection = compressed;
        bestTable = huffman.table;
      }
    }
  }

  const prev = context?.prevTable ?? null;
  if (prev && canEncodeTreeless(prev, literals)) {
    const treeless = makeCompressedSection(literals, prev, 3, new Uint8Array(0));
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
  const treeBytes = createDirectWeightsTreeBytes(huffman.weights);
  if (!treeBytes) return null;
  return makeCompressedSection(literals, huffman.table, 2, treeBytes);
}
