import { describe, expect, it } from 'vitest';
import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { buildFSEDecodeTable, decodeFSESymbol, readNCount } from './fse.js';
import { LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG } from './predefined.js';

describe('FSE', () => {
  it('readNCount decodes 2-symbol distribution', () => {
    const result = readNCount(
      new Uint8Array([0x10, 0x3f, 0x01]),
      0,
      255,
      12,
    );
    expect(result.tableLog).toBe(5);
    expect(result.maxSymbolValue).toBe(1);
    expect(result.normalizedCounter[0]).toBe(16);
    expect(result.normalizedCounter[1]).toBe(16);
    expect(result.bytesRead).toBe(2);
  });
  it('buildFSEDecodeTable from predefined literals length', () => {
    const table = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
    expect(table.length).toBe(1 << LITERALS_LENGTH_TABLE_LOG);
    expect(table.every((r) => r.symbol >= 0 && r.numBits >= 0)).toBe(true);
  });

  it('decodeFSESymbol updates state', () => {
    const table = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
    const data = new Uint8Array([0x55, 0xaa, 0x01]);
    const reader = new BitReaderReverse(data, 0, 3);
    reader.skipPadding();
    const state = { value: 0 };
    const symbol = decodeFSESymbol(table, LITERALS_LENGTH_TABLE_LOG, reader, state);
    expect(typeof symbol).toBe('number');
    expect(state.value).toBeGreaterThanOrEqual(0);
  });
});
