import { describe, expect, it } from 'vitest';
import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { buildFSEDecodeTable, decodeFSESymbol, normalizeCountsForTable, readNCount, writeNCount } from './fse.js';
import { LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG } from './predefined.js';

describe('FSE', () => {
  it('readNCount decodes 2-symbol distribution', () => {
    const result = readNCount(new Uint8Array([0x10, 0x3f, 0x01]), 0, 255, 12);
    expect(result.tableLog).toBe(5);
    expect(result.maxSymbolValue).toBe(1);
    expect(result.normalizedCounter[0]).toBe(16);
    expect(result.normalizedCounter[1]).toBe(16);
    expect(result.bytesRead).toBe(2);
  });

  it('readNCount matches short-buffer and padded-buffer parsing', () => {
    const short = new Uint8Array([0x10, 0x3f, 0x01]);
    const padded = new Uint8Array([0x10, 0x3f, 0x01, 0, 0, 0, 0, 0]);
    const a = readNCount(short, 0, 255, 12);
    const b = readNCount(padded, 0, 255, 12);
    expect(a.tableLog).toBe(b.tableLog);
    expect(a.maxSymbolValue).toBe(b.maxSymbolValue);
    expect(a.bytesRead).toBe(2);
    expect(b.bytesRead).toBe(2);
    expect(a.normalizedCounter.slice(0, 8)).toEqual(b.normalizedCounter.slice(0, 8));
  });
  it('buildFSEDecodeTable from predefined literals length', () => {
    const table = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
    expect(table.length).toBe(1 << LITERALS_LENGTH_TABLE_LOG);
    for (let i = 0; i < table.length; i++) {
      expect(table.symbol[i]).toBeGreaterThanOrEqual(0);
      expect(table.numBits[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('buildFSEDecodeTable validates tableLog bounds', () => {
    expect(() => buildFSEDecodeTable([1], 0)).toThrow(/invalid tableLog/i);
    expect(() => buildFSEDecodeTable([1], 16)).toThrow(/invalid tableLog/i);
    expect(() => buildFSEDecodeTable([1], 5.5)).toThrow(/invalid tableLog/i);
  });

  it('buildFSEDecodeTable validates normalized count values', () => {
    expect(() => buildFSEDecodeTable([2, -2], 2)).toThrow(/invalid normalized count/i);
  });

  it('buildFSEDecodeTable validates normalized sum matches table size', () => {
    expect(() => buildFSEDecodeTable([1, 1], 2)).toThrow(/invalid normalized sum/i);
  });

  it('decodeFSESymbol updates state', () => {
    const table = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
    const data = new Uint8Array([0x55, 0xaa, 0x01]);
    const reader = new BitReaderReverse(data, 0, 3);
    reader.skipPadding();
    const state = { value: 0 };
    const symbol = decodeFSESymbol(table, reader, state);
    expect(typeof symbol).toBe('number');
    expect(state.value).toBeGreaterThanOrEqual(0);
  });

  it('writeNCount round-trips via readNCount', () => {
    const counts = [90, 10, 2, 1];
    const { normalizedCounter, maxSymbolValue } = normalizeCountsForTable(counts, 6);
    const encoded = writeNCount(normalizedCounter, maxSymbolValue, 6);
    const decoded = readNCount(encoded, 0, maxSymbolValue, 9);
    expect(decoded.tableLog).toBe(6);
    expect(decoded.maxSymbolValue).toBe(maxSymbolValue);
    expect(Array.from(decoded.normalizedCounter.subarray(0, maxSymbolValue + 1))).toEqual(
      Array.from(normalizedCounter.subarray(0, maxSymbolValue + 1)),
    );
  });
});
