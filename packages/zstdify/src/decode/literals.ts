/**
 * Decode literals section: Raw, RLE, Compressed, Treeless.
 */

import { BitReader } from '../bitstream/bitReader.js';
import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { buildHuffmanDecodeTable, weightsToNumBits } from '../entropy/huffman.js';
import { readWeightsDirect, readWeightsFSE } from '../entropy/weights.js';
import { ZstdError } from '../errors.js';

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

  const b0 = data[offset]!;
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
      const b1 = data[offset + 1]!;
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
      const b1 = data[offset + 1]!;
      const b2 = data[offset + 2]!;
      const regeneratedSize = (b0 >> 4) + (b1 << 4) + (b2 << 12);
      return {
        header: { blockType, regeneratedSize, headerSize: 3, numStreams: 1 },
        dataOffset: offset + 3,
      };
    }
  }

  if (blockType === 2 || blockType === 3) {
    const reader = new BitReader(data, offset);
    const parsedBlockType = reader.readBits(2) as LiteralsBlockType;
    const parsedSizeFormat = reader.readBits(2);
    if (parsedBlockType !== blockType || parsedSizeFormat !== sizeFormat) {
      throw new ZstdError('Invalid literals section header', 'corruption_detected');
    }

    const numStreams = sizeFormat === 0 ? (1 as const) : (4 as const);
    const sizeBits = sizeFormat <= 1 ? 10 : sizeFormat === 2 ? 14 : 18;
    const regeneratedSize = reader.readBits(sizeBits);
    const compressedSize = reader.readBits(sizeBits);
    reader.align();
    const headerSize = reader.position - offset;
    if (offset + headerSize > data.length) {
      throw new ZstdError('Literals section header truncated', 'corruption_detected');
    }
    return {
      header: { blockType, regeneratedSize, compressedSize, headerSize, numStreams },
      dataOffset: offset + headerSize,
    };
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
  // Return a view to avoid extra copy; callers copy into destination as needed.
  return data.subarray(offset, offset + size);
}

/**
 * Decode RLE literals block - single byte repeated.
 */
export function decodeRLELiterals(data: Uint8Array, offset: number, size: number): Uint8Array {
  if (offset >= data.length) {
    throw new ZstdError('RLE literals truncated', 'corruption_detected');
  }
  const byte = data[offset]!;
  const result = new Uint8Array(size);
  result.fill(byte);
  return result;
}

function weightsToHuffmanTable(weights: number[]): {
  table: ReturnType<typeof buildHuffmanDecodeTable>;
  maxNumBits: number;
} {
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
  const fullWeights = new Array<number>(256).fill(0);
  for (let i = 0; i < weights.length; i++) {
    fullWeights[i] = weights[i] ?? 0;
  }
  fullWeights[weights.length] = lastWeight;

  const numBits = weightsToNumBits(fullWeights, maxNumBits);
  const table = buildHuffmanDecodeTable(numBits, maxNumBits);
  return { table, maxNumBits };
}

function decodeHuffmanStreamByCountInto(
  data: Uint8Array,
  streamOffset: number,
  streamLength: number,
  table: ReturnType<typeof buildHuffmanDecodeTable>,
  maxNumBits: number,
  out: Uint8Array,
  outOffset: number,
  numSymbols: number,
): number {
  if (numSymbols === 0) return 0;
  if (streamLength <= 0) {
    throw new ZstdError('Huffman stream truncated', 'corruption_detected');
  }
  const reader = new BitReaderReverse(data, streamOffset, streamLength);
  reader.skipPadding();
  let written = 0;
  for (let i = 0; i < numSymbols; i++) {
    const peek = reader.readBits(maxNumBits);
    const row = table[peek];
    if (!row) {
      throw new ZstdError('Huffman invalid code', 'corruption_detected');
    }
    out[outOffset + written] = row.symbol;
    written++;
  }
  return written;
}

function decodeHuffmanStreamToEndInto(
  data: Uint8Array,
  streamOffset: number,
  streamLength: number,
  table: ReturnType<typeof buildHuffmanDecodeTable>,
  maxNumBits: number,
  out: Uint8Array,
  outOffset: number,
): number {
  if (streamLength <= 0) {
    throw new ZstdError('Huffman stream truncated', 'corruption_detected');
  }
  const stream = data.subarray(streamOffset, streamOffset + streamLength);
  const lastByte = stream[stream.length - 1]!;
  if (lastByte === 0) {
    throw new ZstdError('Huffman invalid end marker', 'corruption_detected');
  }
  const highestSetBit = 31 - Math.clz32(lastByte);
  const paddingBits = 8 - highestSetBit;
  let bitOffset = streamLength * 8 - paddingBits;

  const readBitsZeroExtended = (numBits: number): number => {
    if (numBits <= 0) return 0;
    bitOffset -= numBits;
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const abs = bitOffset + i;
      if (abs < 0 || abs >= streamLength * 8) continue;
      const byteIndex = abs >>> 3;
      const bitInByte = abs & 7;
      const bit = (stream[byteIndex]! >>> bitInByte) & 1;
      value |= bit << i;
    }
    return value;
  };

  const mask = (1 << maxNumBits) - 1;
  let state = readBitsZeroExtended(maxNumBits);
  let written = 0;
  while (bitOffset > -maxNumBits) {
    const row = table[state];
    if (!row) {
      throw new ZstdError('Huffman invalid code', 'corruption_detected');
    }
    if (outOffset + written >= out.length) {
      throw new ZstdError('Huffman literals size mismatch', 'corruption_detected');
    }
    out[outOffset + written] = row.symbol;
    written++;
    const nb = row.numBits;
    const rest = nb > 0 ? readBitsZeroExtended(nb) : 0;
    state = ((state << nb) & mask) + rest;
  }
  if (bitOffset !== -maxNumBits) {
    throw new ZstdError('Huffman stream did not end cleanly', 'corruption_detected');
  }
  return written;
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
): {
  literals: Uint8Array;
  huffmanTable: { table: ReturnType<typeof buildHuffmanDecodeTable>; maxNumBits: number };
  bytesRead: number;
} {
  let pos = offset;
  let huffmanTable: { table: ReturnType<typeof buildHuffmanDecodeTable>; maxNumBits: number };

  if (pos >= data.length) {
    throw new ZstdError('Huffman tree description truncated', 'corruption_detected');
  }

  const headerByte = data[pos]!;
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
    decodeHuffmanStreamByCountInto(
      data,
      pos,
      totalStreamsSize,
      huffmanTable.table,
      huffmanTable.maxNumBits,
      result,
      0,
      regeneratedSize,
    );
  } else {
    if (totalStreamsSize < 10) {
      throw new ZstdError('4-stream mode requires at least 10 bytes', 'corruption_detected');
    }
    const s1 = data[pos]! | (data[pos + 1]! << 8);
    const s2 = data[pos + 2]! | (data[pos + 3]! << 8);
    const s3 = data[pos + 4]! | (data[pos + 5]! << 8);
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

    let streamOffset = pos + 6;

    const decodeStream = (size: number) => {
      const written = decodeHuffmanStreamToEndInto(
        data,
        streamOffset,
        size,
        huffmanTable.table,
        huffmanTable.maxNumBits,
        result,
        outPos,
      );
      outPos += written;
      streamOffset += size;
    };

    decodeStream(stream1Size);
    decodeStream(stream2Size);
    decodeStream(stream3Size);
    decodeStream(stream4Size);
    if (outPos !== regeneratedSize) {
      throw new ZstdError('Huffman literals size mismatch', 'corruption_detected');
    }
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
    decodeHuffmanStreamByCountInto(
      data,
      pos,
      compressedSize,
      huffmanTable.table,
      huffmanTable.maxNumBits,
      result,
      0,
      regeneratedSize,
    );
  } else {
    if (compressedSize < 10) {
      throw new ZstdError('4-stream mode requires at least 10 bytes', 'corruption_detected');
    }
    const s1 = data[pos]! | (data[pos + 1]! << 8);
    const s2 = data[pos + 2]! | (data[pos + 3]! << 8);
    const s3 = data[pos + 4]! | (data[pos + 5]! << 8);
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

    pos += 6;

    const decodeStream = (size: number) => {
      const written = decodeHuffmanStreamToEndInto(
        data,
        pos,
        size,
        huffmanTable.table,
        huffmanTable.maxNumBits,
        result,
        outPos,
      );
      outPos += written;
      pos += size;
    };

    decodeStream(stream1Size);
    decodeStream(stream2Size);
    decodeStream(stream3Size);
    decodeStream(stream4Size);
    if (outPos !== regeneratedSize) {
      throw new ZstdError('Huffman literals size mismatch', 'corruption_detected');
    }
  }

  return { literals: result, bytesRead: compressedSize };
}
