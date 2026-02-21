/**
 * Compress input data using zstd.
 * Level 0: raw blocks only (no compression, fast).
 */

import { resolveDictionaryIdForCompression } from './dictionary/compressorDictionary.js';
import { writeRawBlock, writeRLEBlock } from './encode/blockWriter.js';
import { buildCompressedBlockPayload, writeCompressedBlock } from './encode/compressedBlock.js';
import { writeFrameHeader } from './encode/frameWriter.js';
import { buildGreedySequences } from './encode/greedySequences.js';
import { ZstdError } from './errors.js';
import { computeContentChecksum32 } from './frame/checksum.js';

export type CompressOptions = {
  level?: number;
  checksum?: boolean;
  dictionary?: Uint8Array | { bytes: Uint8Array; id?: number };
  noDictId?: boolean;
};

const BLOCK_MAX = 128 * 1024;

export function compress(input: Uint8Array, options?: CompressOptions): Uint8Array {
  const level = options?.level ?? 0;
  const hasChecksum = options?.checksum ?? false;
  const dictionary = options?.dictionary;
  const dictionaryBytes = dictionary instanceof Uint8Array ? dictionary : dictionary?.bytes;
  const providedDictionaryId = dictionary instanceof Uint8Array ? null : (dictionary?.id ?? null);
  const dictionaryId = options?.noDictId
    ? null
    : dictionaryBytes && dictionaryBytes.length > 0
      ? resolveDictionaryIdForCompression(dictionaryBytes, providedDictionaryId)
      : providedDictionaryId;
  if (dictionaryId !== null && (!Number.isInteger(dictionaryId) || dictionaryId <= 0 || dictionaryId > 0xffff_ffff)) {
    throw new ZstdError('dictionary.id must be a 32-bit positive integer', 'parameter_unsupported');
  }
  const chunks: Uint8Array[] = [];

  chunks.push(writeFrameHeader(input.length, hasChecksum, dictionaryId));

  let offset = 0;
  const blockCount = input.length === 0 ? 1 : Math.ceil(input.length / BLOCK_MAX);
  let blockIndex = 0;
  while (offset < input.length || blockIndex < blockCount) {
    const size = Math.min(BLOCK_MAX, input.length - offset);
    const last = blockIndex === blockCount - 1;
    const block = input.subarray(offset, offset + size);
    if (level > 0 && size > 0) {
      if (level > 1) {
        const plan = buildGreedySequences(block);
        if (plan.sequences.length > 0) {
          const payload = buildCompressedBlockPayload(plan.literals, plan.sequences);
          if (payload) {
            const compressed = writeCompressedBlock(payload, last);
            if (compressed.length < 3 + size) {
              chunks.push(compressed);
              offset += size;
              blockIndex++;
              continue;
            }
          }
        }
      }
      const first = input[offset] ?? 0;
      let isRLE = true;
      for (let i = offset + 1; i < offset + size; i++) {
        if ((input[i] ?? 0) !== first) {
          isRLE = false;
          break;
        }
      }
      if (isRLE) {
        chunks.push(writeRLEBlock(first, size, last));
      } else {
        chunks.push(writeRawBlock(input, offset, size, last));
      }
    } else {
      chunks.push(writeRawBlock(input, offset, size, last));
    }
    offset += size;
    blockIndex++;
  }

  if (hasChecksum) {
    const checksum = computeContentChecksum32(input);
    chunks.push(
      new Uint8Array([checksum & 0xff, (checksum >>> 8) & 0xff, (checksum >>> 16) & 0xff, (checksum >>> 24) & 0xff]),
    );
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
