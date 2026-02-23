import { readU32LE } from '../bitstream/littleEndian.js';
import type { SequenceTables } from '../decode/sequences.js';
import { buildFSEDecodeTable, readNCount } from '../entropy/fse.js';
import { buildHuffmanDecodeTable, weightsToNumBits } from '../entropy/huffman.js';
import { readWeightsDirect, readWeightsFSE } from '../entropy/weights.js';
import { ZstdError } from '../errors.js';

const ZSTD_DICTIONARY_MAGIC = 0xec30a437;

type HuffmanTable = {
  table: ReturnType<typeof buildHuffmanDecodeTable>;
  maxNumBits: number;
};

export interface DecoderDictionaryContext {
  historyPrefix: Uint8Array;
  dictionaryId: number | null;
  repOffsets: [number, number, number];
  huffmanTable: HuffmanTable | null;
  sequenceTables: SequenceTables | null;
}

function buildHuffmanTableFromWeights(weights: ArrayLike<number>): HuffmanTable {
  let partialSum = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w > 0) partialSum += 1 << (w - 1);
  }
  if (partialSum === 0) {
    throw new ZstdError('Invalid Huffman weights', 'corruption_detected');
  }
  const maxNumBits = 32 - Math.clz32(partialSum);
  const total = 1 << maxNumBits;
  const remainder = total - partialSum;
  if (remainder <= 0 || (remainder & (remainder - 1)) !== 0) {
    throw new ZstdError('Invalid Huffman weights: cannot complete to power of 2', 'corruption_detected');
  }
  const lastWeight = 32 - Math.clz32(remainder);
  const fullWeights = new Uint8Array(256);
  fullWeights.set(weights as Uint8Array, 0);
  fullWeights[weights.length] = lastWeight;
  const numBits = weightsToNumBits(fullWeights, maxNumBits);
  return {
    table: buildHuffmanDecodeTable(numBits, maxNumBits),
    maxNumBits,
  };
}

function parseDictionaryHuffmanTable(data: Uint8Array, offset: number): { table: HuffmanTable; bytesRead: number } {
  if (offset >= data.length) {
    throw new ZstdError('Dictionary Huffman table truncated', 'corruption_detected');
  }
  const headerByte = data[offset]!;
  let pos = offset + 1;
  let weights: Uint8Array;
  if (headerByte >= 128) {
    const numWeights = headerByte - 127;
    const direct = readWeightsDirect(data, pos, numWeights);
    weights = direct.weights;
    pos += direct.bytesRead;
  } else {
    const fse = readWeightsFSE(data, pos, headerByte);
    weights = fse.weights;
    pos += headerByte;
  }
  const table = buildHuffmanTableFromWeights(weights);
  return { table, bytesRead: pos - offset };
}

export function normalizeDecoderDictionary(
  dictionaryBytes: Uint8Array,
  providedDictionaryId: number | null = null,
): DecoderDictionaryContext {
  if (dictionaryBytes.length < 8 || readU32LE(dictionaryBytes, 0) !== ZSTD_DICTIONARY_MAGIC) {
    return {
      historyPrefix: dictionaryBytes.slice(),
      dictionaryId: providedDictionaryId,
      repOffsets: [1, 4, 8],
      huffmanTable: null,
      sequenceTables: null,
    };
  }
  if (dictionaryBytes.length <= 8) {
    throw new ZstdError('Dictionary too small', 'corruption_detected');
  }

  const parsedDictionaryId = readU32LE(dictionaryBytes, 4);
  if (parsedDictionaryId === 0) {
    throw new ZstdError('Dictionary ID must be non-zero', 'corruption_detected');
  }
  if (providedDictionaryId !== null && providedDictionaryId !== parsedDictionaryId) {
    throw new ZstdError('Provided dictionary ID does not match dictionary content', 'corruption_detected');
  }

  let pos = 8;
  const huffman = parseDictionaryHuffmanTable(dictionaryBytes, pos);
  pos += huffman.bytesRead;

  const ofNCount = readNCount(dictionaryBytes, pos, 31, 8);
  pos += ofNCount.bytesRead;
  const mlNCount = readNCount(dictionaryBytes, pos, 52, 9);
  pos += mlNCount.bytesRead;
  const llNCount = readNCount(dictionaryBytes, pos, 35, 9);
  pos += llNCount.bytesRead;

  if (pos + 12 > dictionaryBytes.length) {
    throw new ZstdError('Dictionary entropy section truncated', 'corruption_detected');
  }
  const contentSize = dictionaryBytes.length - (pos + 12);
  const repOffsets: [number, number, number] = [
    readU32LE(dictionaryBytes, pos),
    readU32LE(dictionaryBytes, pos + 4),
    readU32LE(dictionaryBytes, pos + 8),
  ];
  for (const rep of repOffsets) {
    if (rep === 0 || rep > contentSize) {
      throw new ZstdError('Invalid dictionary repeat offset', 'corruption_detected');
    }
  }
  pos += 12;

  const historyPrefix = dictionaryBytes.subarray(pos).slice();
  const sequenceTables: SequenceTables = {
    ofTable: buildFSEDecodeTable(ofNCount.normalizedCounter, ofNCount.tableLog),
    ofTableLog: ofNCount.tableLog,
    mlTable: buildFSEDecodeTable(mlNCount.normalizedCounter, mlNCount.tableLog),
    mlTableLog: mlNCount.tableLog,
    llTable: buildFSEDecodeTable(llNCount.normalizedCounter, llNCount.tableLog),
    llTableLog: llNCount.tableLog,
  };

  return {
    historyPrefix,
    dictionaryId: parsedDictionaryId,
    repOffsets,
    huffmanTable: huffman.table,
    sequenceTables,
  };
}
