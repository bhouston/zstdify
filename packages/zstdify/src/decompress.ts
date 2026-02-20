/**
 * Decompress zstd-compressed data.
 */

import { decompressFrame } from './decode/decompressFrame.js';
import { ZstdError } from './errors.js';
import { parseZstdFrame } from './frame/frameHeader.js';
import { isSkippableFrame, skipSkippableFrame } from './frame/skippable.js';

export type DecompressOptions = {
  maxSize?: number;
};

export function decompress(input: Uint8Array, options?: DecompressOptions): Uint8Array {
  if (input.length === 0) {
    throw new ZstdError('Empty input', 'corruption_detected');
  }
  const maxSize = options?.maxSize;
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < input.length) {
    if (offset + 4 > input.length) {
      throw new ZstdError('Truncated input', 'corruption_detected');
    }

    if (isSkippableFrame(input, offset)) {
      offset = skipSkippableFrame(input, offset);
      continue;
    }

    const { header } = parseZstdFrame(input, offset);
    if (header.dictionaryId !== null) {
      throw new ZstdError('Dictionary frames not supported', 'parameter_unsupported');
    }

    const { output, bytesConsumed } = decompressFrame(
      input,
      offset,
      header,
      maxSize !== undefined ? maxSize - chunks.reduce((s, c) => s + c.length, 0) : undefined,
    );
    chunks.push(output);
    offset += bytesConsumed;
  }

  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) {
    const c = chunks[0];
    if (!c) throw new ZstdError('Unreachable', 'corruption_detected');
    return c;
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
