/**
 * Decompress a single zstd frame.
 */

import { readU32LE } from '../bitstream/littleEndian.js';
import { ZstdError } from '../errors.js';
import { validateContentChecksum } from '../frame/checksum.js';
import type { FrameHeader } from '../frame/frameHeader.js';
import { parseBlockHeader } from './block.js';
import {
  decodeCompressedLiterals,
  decodeRawLiterals,
  decodeRLELiterals,
  decodeTreelessLiterals,
  parseLiteralsSectionHeader,
} from './literals.js';
import { executeSequences } from './reconstruct.js';
import { decodeSequences, type SequenceTables } from './sequences.js';

export function decompressFrame(
  data: Uint8Array,
  offset: number,
  header: FrameHeader,
  dictionaryContent?: Uint8Array,
  maxSize?: number,
): { output: Uint8Array; bytesConsumed: number } {
  let pos = offset + 4 + header.headerSize;
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const repOffsets: [number, number, number] = [1, 4, 8];
  let history: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (dictionaryContent && dictionaryContent.length > 0) {
    history = dictionaryContent.slice();
  }
  let prevHuffmanTable: {
    table: ReturnType<typeof import('../entropy/huffman.js').buildHuffmanDecodeTable>;
    maxNumBits: number;
  } | null = null;
  let prevSeqTables: SequenceTables | null = null;

  while (true) {
    if (pos + 3 > data.length) {
      throw new ZstdError('Block header truncated', 'corruption_detected');
    }
    const block = parseBlockHeader(data, pos);
    pos += 3;

    if (block.blockType === 0) {
      const literals = decodeRawLiterals(data, pos, block.blockSize);
      chunks.push(literals);
      totalSize += literals.length;
      history = appendToHistory(history, literals, header.windowSize);
      pos += block.blockSize;
    } else if (block.blockType === 1) {
      const literals = decodeRLELiterals(data, pos, block.blockSize);
      chunks.push(literals);
      totalSize += literals.length;
      history = appendToHistory(history, literals, header.windowSize);
      pos += 1;
    } else if (block.blockType === 2) {
      const blockContent = data.subarray(pos, pos + block.blockSize);
      const { header: litHeader, dataOffset: litDataOffset } = parseLiteralsSectionHeader(blockContent, 0);

      let literals: Uint8Array;
      let litBytesConsumed: number;

      if (litHeader.blockType === 0) {
        literals = decodeRawLiterals(blockContent, litDataOffset, litHeader.regeneratedSize);
        litBytesConsumed = litHeader.headerSize + litHeader.regeneratedSize;
      } else if (litHeader.blockType === 1) {
        literals = decodeRLELiterals(blockContent, litDataOffset, litHeader.regeneratedSize);
        litBytesConsumed = litHeader.headerSize + 1;
      } else if (litHeader.blockType === 2) {
        const comp = decodeCompressedLiterals(
          blockContent,
          litDataOffset,
          litHeader.compressedSize!,
          litHeader.regeneratedSize,
          litHeader.numStreams,
        );
        literals = comp.literals;
        prevHuffmanTable = comp.huffmanTable;
        litBytesConsumed = litHeader.headerSize + comp.bytesRead;
      } else {
        if (!prevHuffmanTable) {
          throw new ZstdError('Treeless literals without previous Huffman table', 'corruption_detected');
        }
        const comp = decodeTreelessLiterals(
          blockContent,
          litDataOffset,
          litHeader.compressedSize!,
          litHeader.regeneratedSize,
          litHeader.numStreams,
          prevHuffmanTable,
        );
        literals = comp.literals;
        litBytesConsumed = litHeader.headerSize + comp.bytesRead;
      }

      const seqSectionSize = block.blockSize - litBytesConsumed;
      let output: Uint8Array;
      if (seqSectionSize <= 0) {
        output = literals;
      } else {
        const seqResult = decodeSequences(blockContent, litBytesConsumed, seqSectionSize, prevSeqTables);
        prevSeqTables = seqResult.tables;
        if (seqResult.sequences.length === 0) {
          output = literals;
        } else {
          output = executeSequences(literals, seqResult.sequences, header.windowSize, repOffsets, history);
        }
      }

      chunks.push(output);
      totalSize += output.length;
      history = appendToHistory(history, output, header.windowSize);
      pos += block.blockSize;
    } else {
      throw new ZstdError('Unsupported block type', 'corruption_detected');
    }

    if (maxSize !== undefined && totalSize > maxSize) {
      throw new ZstdError('Decompressed size exceeds maxSize', 'parameter_unsupported');
    }

    if (block.lastBlock) break;
  }

  const output = concatenateChunks(chunks);
  if (header.contentSize !== null && output.length !== header.contentSize) {
    throw new ZstdError('Frame content size mismatch', 'corruption_detected');
  }

  if (header.hasContentChecksum) {
    if (pos + 4 > data.length) {
      throw new ZstdError('Content checksum truncated', 'corruption_detected');
    }
    const storedChecksum = readU32LE(data, pos);
    if (!validateContentChecksum(output, storedChecksum)) {
      throw new ZstdError('Content checksum mismatch', 'corruption_detected');
    }
    pos += 4;
    return { output, bytesConsumed: pos - offset };
  }

  return { output, bytesConsumed: pos - offset };
}

function appendToHistory(
  history: Uint8Array<ArrayBufferLike>,
  chunk: Uint8Array<ArrayBufferLike>,
  windowSize: number,
): Uint8Array<ArrayBufferLike> {
  if (windowSize <= 0 || chunk.length === 0) {
    return history;
  }
  const maxHistory = Math.max(1, windowSize);
  if (chunk.length >= maxHistory) {
    return new Uint8Array(chunk.subarray(chunk.length - maxHistory));
  }
  const keepFromHistory = Math.min(history.length, maxHistory - chunk.length);
  const next = new Uint8Array(keepFromHistory + chunk.length);
  if (keepFromHistory > 0) {
    next.set(history.subarray(history.length - keepFromHistory), 0);
  }
  next.set(chunk, keepFromHistory);
  return next;
}

function concatenateChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
