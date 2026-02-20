/**
 * Decode literals section: Raw, RLE, Compressed, Treeless.
 */

import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { ZstdError } from '../errors.js';
import {
  buildHuffmanDecodeTable,
  decodeHuffmanSymbol,
  weightsToNumBits,
} from '../entropy/huffman.js';
import { readWeightsDirect, readWeightsFSE } from '../entropy/weights.js';

export type LiteralsBlockType = 0 | 1 | 2 | 3; // Raw, RLE, Compressed, Treeless

export interface LiteralsSectionHeader {
  blockType: LiteralsBlockType;
  regeneratedSize: number;
  compressedSize?: number;
  numStreams: 1 | 4;
  headerSize: number;
}

/**
 * Parse Literals_Section_Header from compressed block.
 * Returns header info and the byte offset after the header.
 */
export function parseLiteralsSectionHeader(
  data: Uint8Array,
  offset: number,
): { header: LiteralsSectionHeader; dataOffset: number } {
  if (offset >= data.length) {
    throw new ZstdError('Literals section header truncated', 'corruption_detected');
  }

  const b0 = data[offset] ?? 0;
  const blockType = (b0 & 3) as LiteralsBlockType;
  const sizeFormat = (b0 >> 2) & 3;

  if (blockType === 0 || blockType === 1) {
    if (sizeFormat === 0 || sizeFormat === 2) {
      const regeneratedSize = b0 >> 3;
      return {
        header: { blockType, regeneratedSize, headerSize: 1, numStreams: 1 },
        dataOffset: offset + 1,
      };
    }
    if (sizeFormat === 1) {
      if (offset + 2 > data.length) {
        throw new ZstdError('Literals section header truncated', 'corruption_detected');
      }
      const b1 = data[offset + 1] ?? 0;
      const regeneratedSize = (b0 >> 4) + (b1 << 4);
      return {
        header: { blockType, regeneratedSize, headerSize: 2, numStreams: 1 },
        dataOffset: offset + 2,
      };
    }
    if (sizeFormat === 3) {
      if (offset + 3 > data.length) {
        throw new ZstdError('Literals section header truncated', 'corruption_detected');
      }
      const b1 = data[offset + 1] ?? 0;
      const b2 = data[offset + 2] ?? 0;
      const regeneratedSize = (b0 >> 4) + (b1 << 4) + (b2 << 12);
      return {
        header: { blockType, regeneratedSize, headerSize: 3, numStreams: 1 },
        dataOffset: offset + 3,
      };
    }
  }

  if (blockType === 2 || blockType === 3) {
    const numStreams = sizeFormat === 0 ? (1 as const) : (4 as const);
    if (sizeFormat === 0) {
      if (offset + 3 > data.length) {
        throw new ZstdError('Literals section header truncated', 'corruption_detected');
      }
      const b1 = data[offset + 1] ?? 0;
      const b2 = data[offset + 2] ?? 0;
      const regeneratedSize = (b0 >> 4) | ((b1 & 0x3f) << 4);
      const compressedSize = (b1 >> 6) | (b2 << 2);
      return {
        header: { blockType, regeneratedSize, compressedSize, headerSize: 3, numStreams },
        dataOffset: offset + 3,
      };
    }
    if (sizeFormat === 1) {
      if (offset + 3 > data.length) {
        throw new ZstdError('Literals section header truncated', 'corruption_detected');
      }
      const b1 = data[offset + 1] ?? 0;
      const b2 = data[offset + 2] ?? 0;
      const regeneratedSize = (b0 >> 4) | ((b1 & 0x3f) << 4);
      const compressedSize = (b1 >> 6) | (b2 << 2);
      return {
        header: { blockType, regeneratedSize, compressedSize, headerSize: 3, numStreams: 4 },
        dataOffset: offset + 3,
      };
    }
    if (sizeFormat === 2) {
      if (offset + 4 > data.length) {
        throw new ZstdError('Literals section header truncated', 'corruption_detected');
      }
      const b1 = data[offset + 1] ?? 0;
      const b2 = data[offset + 2] ?? 0;
      const b3 = data[offset + 3] ?? 0;
      const regeneratedSize = (b0 >> 4) | (b1 << 4) | ((b2 & 0x3f) << 12);
      const compressedSize = (b2 >> 6) | (b3 << 2);
      return {
        header: { blockType, regeneratedSize, compressedSize, headerSize: 4, numStreams: 4 },
        dataOffset: offset + 4,
      };
    }
    if (sizeFormat === 3) {
      if (offset + 5 > data.length) {
        throw new ZstdError('Literals section header truncated', 'corruption_detected');
      }
      const b1 = data[offset + 1] ?? 0;
      const b2 = data[offset + 2] ?? 0;
      const b3 = data[offset + 3] ?? 0;
      const b4 = data[offset + 4] ?? 0;
      const regeneratedSize = (b0 >> 4) | (b1 << 4) | (b2 << 12) | ((b3 & 0x3f) << 20);
      const compressedSize = (b3 >> 6) | (b4 << 2);
      return {
        header: { blockType, regeneratedSize, compressedSize, headerSize: 5, numStreams: 4 },
        dataOffset: offset + 5,
      };
    }
  }

  throw new ZstdError('Invalid literals section header', 'corruption_detected');
}

/**
 * Decode raw literals block - direct copy.
 */
export function decodeRawLiterals(data: Uint8Array, offset: number, size: number): Uint8Array {
  if (offset + size > data.length) {
    throw new ZstdError('Raw literals truncated', 'corruption_detected');
  }
  return data.subarray(offset, offset + size).slice();
}

/**
 * Decode RLE literals block - single byte repeated.
 */
export function decodeRLELiterals(data: Uint8Array, offset: number, size: number): Uint8Array {
  if (offset >= data.length) {
    throw new ZstdError('RLE literals truncated', 'corruption_detected');
  }
  const byte = data[offset] ?? 0;
  const result = new Uint8Array(size);
  result.fill(byte);
  return result;
}

function weightsToHuffmanTable(weights: number[]): { table: ReturnType<typeof buildHuffmanDecodeTable>; maxNumBits: number } {
  let partialSum = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
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
  const fullWeights = [...weights, lastWeight];
  while (fullWeights.length < 256) {
    fullWeights.push(0);
  }

  const numBits = weightsToNumBits(fullWeights, maxNumBits);
  const table = buildHuffmanDecodeTable(numBits, maxNumBits);
  return { table, maxNumBits };
}

function decodeHuffmanStream(
  data: Uint8Array,
  streamOffset: number,
  streamLength: number,
  table: ReturnType<typeof buildHuffmanDecodeTable>,
  maxNumBits: number,
  numSymbols: number,
): Uint8Array {
  if (numSymbols === 0) {
    return new Uint8Array(0);
  }
  if (streamLength <= 0) {
    throw new ZstdError('Huffman stream truncated', 'corruption_detected');
  }
  const result = new Uint8Array(numSymbols);
  const reader = new BitReaderReverse(data, streamOffset, streamLength);
  reader.skipPadding();
  for (let i = 0; i < numSymbols; i++) {
    result[i] = decodeHuffmanSymbol(table, maxNumBits, reader);
  }
  return result;
}

/**
 * Decode compressed literals (Huffman). Requires Huffman table from tree description.
 */
export function decodeCompressedLiterals(
  data: Uint8Array,
  offset: number,
  compressedSize: number,
  regeneratedSize: number,
  numStreams: 1 | 4,
): { literals: Uint8Array; huffmanTable: { table: ReturnType<typeof buildHuffmanDecodeTable>; maxNumBits: number }; bytesRead: number } {
  let pos = offset;
  let huffmanTable: { table: ReturnType<typeof buildHuffmanDecodeTable>; maxNumBits: number };

  if (pos >= data.length) {
    throw new ZstdError('Huffman tree description truncated', 'corruption_detected');
  }

  const headerByte = data[pos] ?? 0;
  pos++;

  let weights: number[];
  let treeBytes: number;

  if (headerByte >= 128) {
    const numWeights = headerByte - 127;
    const { weights: w, bytesRead } = readWeightsDirect(data, pos, numWeights);
    weights = w;
    treeBytes = 1 + bytesRead;
    pos += bytesRead;
  } else {
    const { weights: w, bytesRead } = readWeightsFSE(data, pos, headerByte);
    weights = w;
    treeBytes = 1 + bytesRead;
    pos += headerByte;
  }

  huffmanTable = weightsToHuffmanTable(weights);

  const totalStreamsSize = compressedSize - treeBytes;
  if (totalStreamsSize <= 0) {
    throw new ZstdError('Invalid literals compressed size', 'corruption_detected');
  }

  const result = new Uint8Array(regeneratedSize);
  let outPos = 0;

  if (numStreams === 1) {
    const lit = decodeHuffmanStream(
      data,
      pos,
      totalStreamsSize,
      huffmanTable.table,
      huffmanTable.maxNumBits,
      regeneratedSize,
    );
    result.set(lit);
  } else {
    if (totalStreamsSize < 10) {
      throw new ZstdError('4-stream mode requires at least 10 bytes', 'corruption_detected');
    }
    const s1 = (data[pos] ?? 0) | ((data[pos + 1] ?? 0) << 8);
    const s2 = (data[pos + 2] ?? 0) | ((data[pos + 3] ?? 0) << 8);
    const s3 = (data[pos + 4] ?? 0) | ((data[pos + 5] ?? 0) << 8);
    const stream1Size = s1;
    const stream2Size = s2;
    const stream3Size = s3;
    const stream4Size = totalStreamsSize - 6 - stream1Size - stream2Size - stream3Size;
    if (stream4Size < 0) {
      throw new ZstdError(
        `Invalid jump table in 4-stream literals: total=${totalStreamsSize} s1=${stream1Size} s2=${stream2Size} s3=${stream3Size}`,
        'corruption_detected',
      );
    }

    const streamSize = Math.ceil((regeneratedSize + 3) / 4);
    let streamOffset = pos + 6;

    const decodeStream = (size: number, count: number) => {
      if (count === 0) return;
      const lit = decodeHuffmanStream(data, streamOffset, size, huffmanTable.table, huffmanTable.maxNumBits, count);
      result.set(lit, outPos);
      outPos += count;
      streamOffset += size;
    };

    decodeStream(stream1Size, Math.min(streamSize, regeneratedSize - outPos));
    decodeStream(stream2Size, Math.min(streamSize, regeneratedSize - outPos));
    decodeStream(stream3Size, Math.min(streamSize, regeneratedSize - outPos));
    decodeStream(stream4Size, regeneratedSize - outPos);
  }

  return {
    literals: result,
    huffmanTable,
    bytesRead: compressedSize,
  };
}

/**
 * Decode treeless literals (reuse previous Huffman table).
 */
export function decodeTreelessLiterals(
  data: Uint8Array,
  offset: number,
  compressedSize: number,
  regeneratedSize: number,
  numStreams: 1 | 4,
  huffmanTable: { table: ReturnType<typeof buildHuffmanDecodeTable>; maxNumBits: number },
): { literals: Uint8Array; bytesRead: number } {
  const result = new Uint8Array(regeneratedSize);
  let outPos = 0;
  let pos = offset;

  if (numStreams === 1) {
    const lit = decodeHuffmanStream(
      data,
      pos,
      compressedSize,
      huffmanTable.table,
      huffmanTable.maxNumBits,
      regeneratedSize,
    );
    result.set(lit);
  } else {
    if (compressedSize < 10) {
      throw new ZstdError('4-stream mode requires at least 10 bytes', 'corruption_detected');
    }
    const s1 = (data[pos] ?? 0) | ((data[pos + 1] ?? 0) << 8);
    const s2 = (data[pos + 2] ?? 0) | ((data[pos + 3] ?? 0) << 8);
    const s3 = (data[pos + 4] ?? 0) | ((data[pos + 5] ?? 0) << 8);
    const stream1Size = s1;
    const stream2Size = s2;
    const stream3Size = s3;
    const stream4Size = compressedSize - 6 - stream1Size - stream2Size - stream3Size;
    if (stream4Size < 0) {
      throw new ZstdError(
        `Invalid jump table in 4-stream literals: total=${compressedSize} s1=${stream1Size} s2=${stream2Size} s3=${stream3Size}`,
        'corruption_detected',
      );
    }

    const streamSize = Math.ceil((regeneratedSize + 3) / 4);
    pos += 6;

    const decodeStream = (size: number, count: number) => {
      if (count === 0) return;
      const lit = decodeHuffmanStream(data, pos, size, huffmanTable.table, huffmanTable.maxNumBits, count);
      result.set(lit, outPos);
      outPos += count;
      pos += size;
    };

    decodeStream(stream1Size, Math.min(streamSize, regeneratedSize - outPos));
    decodeStream(stream2Size, Math.min(streamSize, regeneratedSize - outPos));
    decodeStream(stream3Size, Math.min(streamSize, regeneratedSize - outPos));
    decodeStream(stream4Size, regeneratedSize - outPos);
  }

  return { literals: result, bytesRead: compressedSize };
}
