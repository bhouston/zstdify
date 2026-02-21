/**
 * Decompress zstd-compressed data.
 */

import { decompressFrame } from './decode/decompressFrame.js';
import { normalizeDecoderDictionary } from './dictionary/decoderDictionary.js';
import { ZstdError } from './errors.js';
import { parseZstdFrame } from './frame/frameHeader.js';
import { isSkippableFrame, skipSkippableFrame } from './frame/skippable.js';

export type DecompressOptions = {
  maxSize?: number;
  dictionary?: Uint8Array | { bytes: Uint8Array; id?: number };
  /** When true (default), validate frame content checksum when present. Set to false to skip validation for speed. */
  validateChecksum?: boolean;
};

export function decompress(input: Uint8Array, options?: DecompressOptions): Uint8Array {
  if (input.length === 0) {
    throw new ZstdError('Empty input', 'corruption_detected');
  }
  const maxSize = options?.maxSize;
  const dictionary = options?.dictionary;
  const validateChecksum = options?.validateChecksum !== false;
  const dictionaryBytes = dictionary instanceof Uint8Array ? dictionary : dictionary?.bytes;
  const providedDictionaryId = dictionary instanceof Uint8Array ? null : (dictionary?.id ?? null);
  const normalizedDictionary =
    dictionaryBytes && dictionaryBytes.length > 0
      ? normalizeDecoderDictionary(dictionaryBytes, providedDictionaryId)
      : null;
  const dictionaryId = normalizedDictionary?.dictionaryId ?? providedDictionaryId;
  const chunks: Uint8Array[] = [];
  let totalOutputSize = 0;
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
    if (header.dictionaryId !== null && !dictionaryBytes) {
      throw new ZstdError('Dictionary frame requires dictionary option', 'parameter_unsupported');
    }
    if (header.dictionaryId !== null && dictionaryId !== null && dictionaryId !== header.dictionaryId) {
      throw new ZstdError('Dictionary ID mismatch', 'corruption_detected');
    }

    const { output, bytesConsumed } = decompressFrame(
      input,
      offset,
      header,
      normalizedDictionary,
      maxSize !== undefined ? maxSize - totalOutputSize : undefined,
      validateChecksum,
    );
    chunks.push(output);
    totalOutputSize += output.length;
    offset += bytesConsumed;
  }

  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) {
    const c = chunks[0];
    if (!c) throw new ZstdError('Unreachable', 'corruption_detected');
    return c;
  }
  const result = new Uint8Array(totalOutputSize);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
