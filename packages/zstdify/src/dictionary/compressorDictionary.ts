import { readU32LE } from '../bitstream/littleEndian.js';
import { ZstdError } from '../errors.js';

const ZSTD_DICTIONARY_MAGIC = 0xec30a437;

export function resolveDictionaryIdForCompression(
  dictionaryBytes: Uint8Array,
  providedDictionaryId: number | null = null,
): number | null {
  if (dictionaryBytes.length < 8 || readU32LE(dictionaryBytes, 0) !== ZSTD_DICTIONARY_MAGIC) {
    return providedDictionaryId;
  }
  if (dictionaryBytes.length <= 8) {
    throw new ZstdError('Dictionary too small', 'corruption_detected');
  }

  const parsedDictionaryId = readU32LE(dictionaryBytes, 4);
  if (parsedDictionaryId === 0) {
    throw new ZstdError('Dictionary ID must be non-zero', 'corruption_detected');
  }
  if (providedDictionaryId !== null && providedDictionaryId !== parsedDictionaryId) {
    throw new ZstdError('Provided dictionary ID does not match dictionary content', 'corruption_detected');
  }

  return parsedDictionaryId;
}
