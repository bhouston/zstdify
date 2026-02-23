/**
 * Block header parsing and block type dispatch.
 */

import { ZstdError } from '../errors.js';

export const BLOCK_HEADER_SIZE = 3;
export const MAX_BLOCK_SIZE = 128 * 1024;

export type BlockType = 0 | 1 | 2 | 3; // Raw, RLE, Compressed, Reserved

export interface BlockHeader {
  lastBlock: boolean;
  blockType: BlockType;
  blockSize: number;
}

function readU24LE(data: Uint8Array, offset: number): number {
  if (offset + 3 > data.length) {
    throw new RangeError(`readU24LE: offset ${offset} + 3 exceeds length ${data.length}`);
  }
  const a = data[offset] ?? 0;
  const b = data[offset + 1] ?? 0;
  const c = data[offset + 2] ?? 0;
  return a | (b << 8) | (c << 16);
}

export function parseBlockHeader(data: Uint8Array, offset: number): BlockHeader {
  if (offset + BLOCK_HEADER_SIZE > data.length) {
    throw new ZstdError('Block header truncated', 'corruption_detected');
  }
  const w = readU24LE(data, offset);
  const lastBlock = (w & 1) === 1;
  const blockType = ((w >> 1) & 3) as BlockType;
  const blockSize = w >> 3;

  if (blockType === 3) {
    throw new ZstdError('Reserved block type', 'corruption_detected');
  }
  if (blockSize > MAX_BLOCK_SIZE) {
    throw new ZstdError('Block size exceeds maximum', 'corruption_detected');
  }

  return { lastBlock, blockType, blockSize };
}
