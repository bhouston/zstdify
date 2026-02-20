/**
 * Compress input data using zstd.
 * Level 0: raw blocks only (no compression, fast).
 */

import { writeRawBlock } from './encode/blockWriter.js';
import { writeRLEBlock } from './encode/blockWriter.js';
import { writeFrameHeader } from './encode/frameWriter.js';
import { buildGreedySequences } from './encode/greedySequences.js';

export type CompressOptions = {
  level?: number;
};

const BLOCK_MAX = 128 * 1024;

export function compress(input: Uint8Array, options?: CompressOptions): Uint8Array {
  const level = options?.level ?? 0;
  const hasChecksum = false;
  const chunks: Uint8Array[] = [];

  chunks.push(writeFrameHeader(input.length, hasChecksum));

  let offset = 0;
  const blockCount = input.length === 0 ? 1 : Math.ceil(input.length / BLOCK_MAX);
  let blockIndex = 0;
  while (offset < input.length || blockIndex < blockCount) {
    const size = Math.min(BLOCK_MAX, input.length - offset);
    const last = blockIndex === blockCount - 1;
    const block = input.subarray(offset, offset + size);
    if (level > 0 && size > 0) {
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
        if (level > 1) {
          const plan = buildGreedySequences(block);
          // Phase E scaffolding: detect compressible blocks now; emit compressed
          // blocks once sequence/literals entropy emitters are implemented.
          if (plan.sequences.length > 0) {
            chunks.push(writeRawBlock(input, offset, size, last));
            offset += size;
            blockIndex++;
            continue;
          }
        }
        chunks.push(writeRawBlock(input, offset, size, last));
      }
    } else {
      chunks.push(writeRawBlock(input, offset, size, last));
    }
    offset += size;
    blockIndex++;
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
