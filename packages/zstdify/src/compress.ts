/**
 * Compress input data using zstd.
 * Level 0: raw blocks only (no compression, fast).
 */

import { writeRawBlock } from './encode/blockWriter.js';
import { writeFrameHeader } from './encode/frameWriter.js';

export type CompressOptions = {
  level?: number;
};

const BLOCK_MAX = 128 * 1024;

export function compress(input: Uint8Array, options?: CompressOptions): Uint8Array {
  const _level = options?.level ?? 0;
  const hasChecksum = false;
  const chunks: Uint8Array[] = [];

  chunks.push(writeFrameHeader(input.length, hasChecksum));

  let offset = 0;
  const blockCount = input.length === 0 ? 1 : Math.ceil(input.length / BLOCK_MAX);
  let blockIndex = 0;
  while (offset < input.length || blockIndex < blockCount) {
    const size = Math.min(BLOCK_MAX, input.length - offset);
    const last = blockIndex === blockCount - 1;
    chunks.push(writeRawBlock(input, offset, size, last));
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
