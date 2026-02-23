import { describe, expect, it } from 'vitest';
import { resolveDictionaryHistoryForCompression, resolveDictionaryIdForCompression } from './compressorDictionary.js';

describe('resolveDictionaryIdForCompression', () => {
  it('returns provided id for raw-content dictionary', () => {
    const dictionaryBytes = new TextEncoder().encode('alpha beta gamma dictionary content');
    expect(resolveDictionaryIdForCompression(dictionaryBytes, 42)).toBe(42);
  });

  it('returns parsed id for trained dictionary header', () => {
    const dictionaryBytes = new Uint8Array([
      0x37,
      0xa4,
      0x30,
      0xec, // dictionary magic
      0x39,
      0x30,
      0x00,
      0x00, // dictionary id: 12345
      0x00, // trailing byte so length > 8
    ]);
    expect(resolveDictionaryIdForCompression(dictionaryBytes)).toBe(12345);
  });

  it('throws when provided id does not match trained dictionary id', () => {
    const dictionaryBytes = new Uint8Array([
      0x37,
      0xa4,
      0x30,
      0xec, // dictionary magic
      0x39,
      0x30,
      0x00,
      0x00, // dictionary id: 12345
      0x00, // trailing byte so length > 8
    ]);
    expect(() => resolveDictionaryIdForCompression(dictionaryBytes, 77)).toThrow();
  });
});

describe('resolveDictionaryHistoryForCompression', () => {
  it('returns raw-content dictionary bytes for history matching', () => {
    const dictionaryBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(resolveDictionaryHistoryForCompression(dictionaryBytes)).toEqual(dictionaryBytes);
  });

  it('returns empty history for zstd-formatted dictionaries', () => {
    const dictionaryBytes = new Uint8Array([
      0x37,
      0xa4,
      0x30,
      0xec, // dictionary magic
      0x39,
      0x30,
      0x00,
      0x00, // dictionary id: 12345
      0x00,
      0x01,
      0x02,
      0x03,
    ]);
    expect(resolveDictionaryHistoryForCompression(dictionaryBytes)).toEqual(new Uint8Array(0));
  });
});
