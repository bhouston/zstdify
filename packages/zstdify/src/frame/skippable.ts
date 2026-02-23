/**
 * Skippable frame detection and parsing.
 * Magic: 0x184D2A50 to 0x184D2A5F (mask 0xFFFFFFF0).
 */

import { readU32LE } from '../bitstream/littleEndian.js';
import { ZstdError } from '../errors.js';

export const SKIPPABLE_FRAME_MAGIC = 0x184d2a50;
export const SKIPPABLE_FRAME_MAGIC_MASK = 0xfffffff0;

export function isSkippableFrame(data: Uint8Array, offset: number): boolean {
  if (offset + 4 > data.length) return false;
  const magic = readU32LE(data, offset);
  return (magic & SKIPPABLE_FRAME_MAGIC_MASK) === SKIPPABLE_FRAME_MAGIC;
}

export function getSkippableFrameSize(data: Uint8Array, offset: number): number {
  if (offset + 8 > data.length) {
    throw new ZstdError('Skippable frame: truncated header', 'corruption_detected');
  }
  return readU32LE(data, offset + 4);
}

/**
 * Skip a skippable frame. Returns new offset after the frame.
 */
export function skipSkippableFrame(data: Uint8Array, offset: number): number {
  const frameSize = getSkippableFrameSize(data, offset);
  const nextOffset = offset + 8 + frameSize; // 4 magic + 4 size + content
  if (nextOffset > data.length) {
    throw new ZstdError('Skippable frame: truncated payload', 'corruption_detected');
  }
  return nextOffset;
}
