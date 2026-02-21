/**
 * Decompress a single zstd frame.
 */

import { readU32LE } from '../bitstream/littleEndian.js';
import type { DecoderDictionaryContext } from '../dictionary/decoderDictionary.js';
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
import {
  appendRangeToHistoryWindow,
  appendRLEToHistoryWindow,
  appendToHistoryWindow,
  executeSequencesInto,
  getOrCreateHistoryWindow,
  type DecoderReuseBag,
} from './reconstruct.js';
import { decodeSequences, type SequenceTables } from './sequences.js';

export function decompressFrame(
  data: Uint8Array,
  offset: number,
  header: FrameHeader,
  dictionary?: DecoderDictionaryContext | null,
  maxSize?: number,
  validateChecksum = true,
  reuseContext?: DecoderReuseBag,
): { output: Uint8Array; bytesConsumed: number } {
  let pos = offset + 4 + header.headerSize;
  const knownOutputSize = header.contentSize ?? null;
  let outputBuffer = knownOutputSize !== null ? new Uint8Array(knownOutputSize) : new Uint8Array(0);
  let totalSize = 0;
  const repOffsets: [number, number, number] = dictionary?.repOffsets
    ? [dictionary.repOffsets[0], dictionary.repOffsets[1], dictionary.repOffsets[2]]
    : [1, 4, 8];
  const history = getOrCreateHistoryWindow(
    header.windowSize,
    dictionary?.historyPrefix,
    reuseContext,
  );
  let prevHuffmanTable: {
    table: ReturnType<typeof import('../entropy/huffman.js').buildHuffmanDecodeTable>;
    maxNumBits: number;
  } | null = dictionary?.huffmanTable ?? null;
  let prevSeqTables: SequenceTables | null = dictionary?.sequenceTables ?? null;

  const ensureOutputCapacity = (additional: number): void => {
    const needed = totalSize + additional;
    if (needed <= outputBuffer.length) {
      return;
    }
    let nextCapacity = outputBuffer.length === 0 ? 64 * 1024 : outputBuffer.length;
    while (nextCapacity < needed) {
      nextCapacity *= 2;
    }
    const grown = new Uint8Array(nextCapacity);
    if (totalSize > 0) {
      grown.set(outputBuffer.subarray(0, totalSize), 0);
    }
    outputBuffer = grown;
  };

  const appendOutput = (chunk: Uint8Array): void => {
    if (chunk.length === 0) {
      return;
    }
    ensureOutputCapacity(chunk.length);
    outputBuffer.set(chunk, totalSize);
    totalSize += chunk.length;
  };

  while (true) {
    if (pos + 3 > data.length) {
      throw new ZstdError('Block header truncated', 'corruption_detected');
    }
    const block = parseBlockHeader(data, pos);
    pos += 3;

    if (block.blockType === 0) {
      if (pos + block.blockSize > data.length) {
        throw new ZstdError('Raw literals truncated', 'corruption_detected');
      }
      ensureOutputCapacity(block.blockSize);
      outputBuffer.set(data.subarray(pos, pos + block.blockSize), totalSize);
      if (!block.lastBlock) {
        appendRangeToHistoryWindow(history, data, pos, block.blockSize);
      }
      totalSize += block.blockSize;
      pos += block.blockSize;
    } else if (block.blockType === 1) {
      if (pos >= data.length) {
        throw new ZstdError('RLE literals truncated', 'corruption_detected');
      }
      const byte = data[pos]!;
      ensureOutputCapacity(block.blockSize);
      outputBuffer.fill(byte, totalSize, totalSize + block.blockSize);
      if (!block.lastBlock) {
        appendRLEToHistoryWindow(history, byte, block.blockSize);
      }
      totalSize += block.blockSize;
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
      if (seqSectionSize <= 0) {
        appendOutput(literals);
        if (!block.lastBlock) {
          appendToHistoryWindow(history, literals);
        }
      } else {
        const seqResult = decodeSequences(
          blockContent,
          litBytesConsumed,
          seqSectionSize,
          prevSeqTables,
          reuseContext?._sequences,
        );
        if (reuseContext) {
          reuseContext._sequences = seqResult.sequences;
        }
        prevSeqTables = seqResult.tables;
        if (seqResult.sequences.length === 0) {
          appendOutput(literals);
          if (!block.lastBlock) {
            appendToHistoryWindow(history, literals);
          }
        } else {
          let decodedSize = literals.length;
          for (let i = 0; i < seqResult.sequences.length; i++) {
            decodedSize += seqResult.sequences.matchLength[i] ?? 0;
          }
          ensureOutputCapacity(decodedSize);
          const start = totalSize;
          const written = executeSequencesInto(
            literals,
            seqResult.sequences,
            header.windowSize,
            outputBuffer,
            start,
            repOffsets,
            history,
            !block.lastBlock,
          );
          totalSize += written;
        }
      }
      pos += block.blockSize;
    } else {
      throw new ZstdError('Unsupported block type', 'corruption_detected');
    }

    if (maxSize !== undefined && totalSize > maxSize) {
      throw new ZstdError('Decompressed size exceeds maxSize', 'parameter_unsupported');
    }

    if (block.lastBlock) break;
  }

  const output = outputBuffer.subarray(0, totalSize);
  if (header.contentSize !== null && output.length !== header.contentSize) {
    throw new ZstdError('Frame content size mismatch', 'corruption_detected');
  }

  if (header.hasContentChecksum) {
    if (pos + 4 > data.length) {
      throw new ZstdError('Content checksum truncated', 'corruption_detected');
    }
    if (validateChecksum) {
      const storedChecksum = readU32LE(data, pos);
      if (!validateContentChecksum(output, storedChecksum)) {
        throw new ZstdError('Content checksum mismatch', 'corruption_detected');
      }
    }
    pos += 4;
    return { output, bytesConsumed: pos - offset };
  }

  return { output, bytesConsumed: pos - offset };
}
