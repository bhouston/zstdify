import { describe, expect, it } from 'vitest';
import type { SequenceTables } from './sequences.js';
import { decodeSequences } from './sequences.js';

describe('decodeSequences modes and extended counts', () => {
  it('parses extended numSequences encoding for >= 128 path', () => {
    const result = decodeSequences(new Uint8Array([0x80, 0x00]), 0, 2, null);
    expect(result.sequences.length).toBe(0);
    expect(result.bytesRead).toBe(2);
  });

  it('parses 255 marker path and rejects truncated section afterwards', () => {
    const data = new Uint8Array([0xff, 0x00, 0x00]);
    expect(() => decodeSequences(data, 0, data.length, null)).toThrowError(/truncated/i);
  });

  it('handles all-RLE mode (LL/OF/ML) with explicit symbols', () => {
    const data = new Uint8Array([
      0x01, // numSequences
      0x54, // ll=1, of=1, ml=1
      0x00, // ll RLE symbol
      0x00, // of RLE symbol
      0x00, // ml RLE symbol
      0xff,
      0xff,
      0xff, // bitstream bytes
    ]);
    const result = decodeSequences(data, 0, data.length, null);
    expect(result.sequences.length).toBe(1);
  });

  it('enters FSE mode and rejects malformed FSE table stream', () => {
    const data = new Uint8Array([0x01, 0xa8, 0x00]); // ll=2, of=2, ml=2
    expect(() => decodeSequences(data, 0, data.length, null)).toThrow();
  });

  it('uses repeat mode when previous tables are provided', () => {
    const seeded = decodeSequences(new Uint8Array([0x00, 0x00]), 0, 2, null);
    const data = new Uint8Array([
      0x01, // numSequences
      0xfc, // ll=3, of=3, ml=3 (repeat)
      0xff,
      0xff,
      0xff, // bitstream bytes
    ]);
    const result = decodeSequences(data, 0, data.length, seeded.tables);
    expect(result.sequences.length).toBe(1);
    expect(result.tables.llTable).toBe(seeded.tables.llTable);
    expect(result.tables.ofTable).toBe(seeded.tables.ofTable);
    expect(result.tables.mlTable).toBe(seeded.tables.mlTable);
  });

  it('rejects repeat mode when previous tables are missing', () => {
    const data = new Uint8Array([
      0x01, // numSequences
      0xfc, // ll=3, of=3, ml=3 (repeat)
      0x80, // minimal non-empty bitstream byte
    ]);
    expect(() => decodeSequences(data, 0, data.length, null)).toThrowError(/repeat_mode without previous table/i);
  });

  it('rejects invalid state row when repeated tables are structurally invalid', () => {
    const invalidTables: SequenceTables = {
      llTable: {
        symbol: new Uint16Array(0),
        numBits: new Uint8Array(0),
        baseline: new Int32Array(0),
        tableLog: 1,
        length: 0,
      },
      llTableLog: 1,
      ofTable: {
        symbol: new Uint16Array(0),
        numBits: new Uint8Array(0),
        baseline: new Int32Array(0),
        tableLog: 1,
        length: 0,
      },
      ofTableLog: 1,
      mlTable: {
        symbol: new Uint16Array(0),
        numBits: new Uint8Array(0),
        baseline: new Int32Array(0),
        tableLog: 1,
        length: 0,
      },
      mlTableLog: 1,
    };
    const data = new Uint8Array([0x01, 0xfc, 0x80]);
    expect(() => decodeSequences(data, 0, data.length, invalidTables)).toThrowError(/invalid state/i);
  });
});
