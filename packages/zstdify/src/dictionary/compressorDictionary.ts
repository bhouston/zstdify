import { readU32LE } from '../bitstream/littleEndian.js';
import { normalizeDecoderDictionary } from './decoderDictionary.js';

const ZSTD_DICTIONARY_MAGIC = 0xec30a437;

export interface CompressionDictionaryContext {
  dictionaryId: number | null;
  historyPrefix: Uint8Array;
  repOffsets: [number, number, number];
}

export function resolveDictionaryContextForCompression(
  dictionaryBytes: Uint8Array,
  providedDictionaryId: number | null = null,
): CompressionDictionaryContext {
  if (dictionaryBytes.length < 8 || readU32LE(dictionaryBytes, 0) !== ZSTD_DICTIONARY_MAGIC) {
    return {
      dictionaryId: providedDictionaryId,
      historyPrefix: dictionaryBytes,
      repOffsets: [1, 4, 8],
    };
  }
  const parsed = normalizeDecoderDictionary(dictionaryBytes, providedDictionaryId);
  return {
    dictionaryId: parsed.dictionaryId,
    historyPrefix: parsed.historyPrefix,
    repOffsets: [parsed.repOffsets[0], parsed.repOffsets[1], parsed.repOffsets[2]],
  };
}

export function resolveDictionaryIdForCompression(
  dictionaryBytes: Uint8Array,
  providedDictionaryId: number | null = null,
): number | null {
  return resolveDictionaryContextForCompression(dictionaryBytes, providedDictionaryId).dictionaryId;
}

export function resolveDictionaryHistoryForCompression(
  dictionaryBytes: Uint8Array,
  providedDictionaryId: number | null = null,
): Uint8Array {
  return resolveDictionaryContextForCompression(dictionaryBytes, providedDictionaryId).historyPrefix;
}

export function resolveDictionaryRepOffsetsForCompression(
  dictionaryBytes: Uint8Array,
  providedDictionaryId: number | null = null,
): [number, number, number] {
  return resolveDictionaryContextForCompression(dictionaryBytes, providedDictionaryId).repOffsets;
}
