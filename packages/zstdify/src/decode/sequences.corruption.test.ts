import { describe, expect, it } from 'vitest';
import { decodeSequences } from './sequences.js';

describe('decodeSequences corruption handling', () => {
  it('rejects truncated sequences section header', () => {
    const data = new Uint8Array([0x01]);
    expect(() => decodeSequences(data, 0, data.length, null)).toThrowError(/too short|truncated/i);
  });

  it('rejects reserved bits set in modes byte', () => {
    const data = new Uint8Array([
      0x01, // numSequences
      0x01, // reserved low 2 bits set
    ]);
    expect(() => decodeSequences(data, 0, data.length, null)).toThrowError(/reserved bits/i);
  });

  it('rejects repeat mode without previous tables', () => {
    const data = new Uint8Array([
      0x01, // numSequences
      0xc0, // llMode=3 (repeat), of/ml default
      0xff, // bitstream marker byte
    ]);
    expect(() => decodeSequences(data, 0, data.length, null)).toThrowError(/Repeat_Mode/i);
  });

  it('rejects bitstream too short for initial states', () => {
    const data = new Uint8Array([
      0x01, // numSequences
      0x00, // predefined tables for LL/OF/ML
      0x80, // valid reverse end marker but only 1 byte of bitstream
    ]);
    expect(() => decodeSequences(data, 0, data.length, null)).toThrowError(/too short for initial states/i);
  });
});
