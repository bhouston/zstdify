/**
 * Compress input data using zstd.
 * Level 0: raw blocks only (no compression, fast).
 */

import { resolveDictionaryHistoryForCompression, resolveDictionaryIdForCompression } from './dictionary/compressorDictionary.js';
import { writeRawBlock, writeRLEBlock } from './encode/blockWriter.js';
import {
  buildCompressedBlockPayload,
  type SequenceEntropyContext,
  writeCompressedBlock,
} from './encode/compressedBlock.js';
import { writeFrameHeader } from './encode/frameWriter.js';
import { buildGreedySequences } from './encode/greedySequences.js';
import { createSequencePlannerState } from './encode/sequencePlanner.js';
import { ZstdError } from './errors.js';
import { computeContentChecksum32 } from './frame/checksum.js';

export type CompressOptions = {
  level?: number;
  checksum?: boolean;
  dictionary?: Uint8Array | { bytes: Uint8Array; id?: number };
  noDictId?: boolean;
};

const BLOCK_MAX = 128 * 1024;
const WINDOW_SIZE = 128 * 1024;

type CompressionStrategy = 'fast' | 'lazy' | 'optimal';

function selectCompressionStrategy(level: number): CompressionStrategy | null {
  if (level <= 1) return null;
  if (level <= 3) return 'fast';
  if (level <= 6) return 'lazy';
  return 'optimal';
}

function appendHistory(history: Uint8Array<ArrayBufferLike>, chunk: Uint8Array<ArrayBufferLike>): Uint8Array {
  if (chunk.length === 0) return history;
  if (chunk.length >= WINDOW_SIZE) {
    const out = new Uint8Array(WINDOW_SIZE);
    out.set(chunk.subarray(chunk.length - WINDOW_SIZE), 0);
    return out;
  }
  const total = history.length + chunk.length;
  if (total <= WINDOW_SIZE) {
    const out = new Uint8Array(total);
    out.set(history, 0);
    out.set(chunk, history.length);
    return out;
  }
  const keepFromHistory = WINDOW_SIZE - chunk.length;
  const out = new Uint8Array(WINDOW_SIZE);
  out.set(history.subarray(history.length - keepFromHistory), 0);
  out.set(chunk, keepFromHistory);
  return out;
}

export function compress(input: Uint8Array, options?: CompressOptions): Uint8Array {
  const requestedLevel = options?.level ?? 0;
  const level = Math.max(0, Math.min(9, Math.trunc(requestedLevel)));
  const strategy = selectCompressionStrategy(level);
  const hasChecksum = options?.checksum ?? false;
  const dictionary = options?.dictionary;
  const dictionaryBytes = dictionary instanceof Uint8Array ? dictionary : dictionary?.bytes;
  const dictionaryHistory = dictionaryBytes ? resolveDictionaryHistoryForCompression(dictionaryBytes) : null;
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
  let history: Uint8Array<ArrayBufferLike> =
    dictionaryHistory && dictionaryHistory.length > 0
      ? dictionaryHistory.subarray(Math.max(0, dictionaryHistory.length - WINDOW_SIZE))
      : new Uint8Array(0);
  let repOffsets: [number, number, number] = [1, 4, 8];
  const sequenceEntropyContext: SequenceEntropyContext = { prevTables: null };
  const sequencePlannerState = createSequencePlannerState();
  while (offset < input.length || blockIndex < blockCount) {
    const size = Math.min(BLOCK_MAX, input.length - offset);
    const last = blockIndex === blockCount - 1;
    const block = input.subarray(offset, offset + size);
    if (level > 0 && size > 0) {
      if (strategy) {
        const plan = buildGreedySequences(block, { strategy, history, repOffsets, plannerState: sequencePlannerState });
        if (plan.sequences.length > 0) {
          const payload = buildCompressedBlockPayload(plan.literals, plan.sequences, sequenceEntropyContext);
          if (payload) {
            const compressed = writeCompressedBlock(payload, last);
            if (compressed.length < 3 + size) {
              chunks.push(compressed);
              repOffsets = plan.finalRepOffsets;
              history = appendHistory(history, block);
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
    history = appendHistory(history, block);
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
