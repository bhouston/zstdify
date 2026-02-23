import { describe, expect, it } from 'vitest';
import { ZstdError } from '../errors.js';
import { parseFrameHeader, parseZstdFrame } from './frameHeader.js';

function buildFrameHeaderBytes(
  fhd: number,
  wd: number | null,
  dictBytes: Uint8Array,
  fcsBytes: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(4 + 1 + (wd === null ? 0 : 1) + dictBytes.length + fcsBytes.length);
  out.set([0x28, 0xb5, 0x2f, 0xfd], 0);
  out[4] = fhd & 0xff;
  let pos = 5;
  if (wd !== null) {
    out[pos] = wd & 0xff;
    pos++;
  }
  out.set(dictBytes, pos);
  pos += dictBytes.length;
  out.set(fcsBytes, pos);
  return out;
}

function didSize(flag: number): number {
  return [0, 1, 2, 4][flag] ?? 0;
}

function fcsSize(flag: number, singleSegment: boolean): number {
  if (flag === 0) return singleSegment ? 1 : 0;
  if (flag === 1) return 2;
  if (flag === 2) return 4;
  return 8;
}

describe('frameHeader', () => {
  it('parses minimal frame header (no window, no content size, no dict)', () => {
    // FHD: 0x00 = FCS=0, single=0, unused=0, reserved=0, checksum=0, dict=0
    const data = new Uint8Array([
      0x28,
      0xb5,
      0x2f,
      0xfd, // magic
      0x00,
      0x00, // FHD=0, WD: exponent=0 (windowLog=10), mantissa=0 -> 1KB
    ]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.headerSize).toBe(2); // 1 FHD + 1 WD
    expect(header.windowSize).toBe(1024);
    expect(header.contentSize).toBe(null);
    expect(header.hasContentChecksum).toBe(false);
    expect(header.dictionaryId).toBe(null);
  });

  it('rejects invalid magic', () => {
    const data = new Uint8Array([0, 0, 0, 0]);
    expect(() => parseZstdFrame(data, 0)).toThrow('Invalid zstd magic');
  });

  it('rejects reserved bit set', () => {
    const data = new Uint8Array([
      0x28,
      0xb5,
      0x2f,
      0xfd, // magic
      0x08,
      0x40, // FHD with reserved bit (bit 3) set
    ]);
    expect(() => parseZstdFrame(data, 0)).toThrow('Reserved bit');
  });

  it('parses single-segment frame with 1-byte content size and checksum', () => {
    // FHD: FCS=0 (1 byte), single=1, checksum=1, dict=0 -> 0x24. Then 1 byte content size = 5
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x05]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.singleSegment).toBe(true);
    expect(header.contentSize).toBe(5);
    expect(header.hasContentChecksum).toBe(true);
    expect(header.headerSize).toBe(2);
  });

  it('parses frame with 2-byte content size', () => {
    // FHD: FCS=1 (2 bytes), single=1, dict=0 -> 0x60. Single-segment skips WD, so FCS starts immediately.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x60, 0x01, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.singleSegment).toBe(true);
    expect(header.contentSize).toBe(257);
  });

  it('parses frame with dictionary ID (1 byte)', () => {
    // FHD: FCS=0, single=1, dict=1 -> 0x21. Per spec: [Dict_ID] then [FCS]; so 1 byte dict ID = 42, then 1 byte FCS = 0.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x21, 0x2a, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.dictionaryId).toBe(0x2a);
  });

  it('parses frame with dictionary ID 0 as null', () => {
    // dict=1, 1 byte dict ID = 0; per spec dictionary ID 0 means "no dictionary"
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x21, 0x00, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.dictionaryId).toBe(null);
  });

  it('parses large window size without 32-bit shift overflow', () => {
    // FHD=0 => non-single-segment, no dict, no content size.
    // WD=0xff => exponent=31 (windowLog=41), mantissa=7.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xff]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.windowSize).toBe(4_123_168_604_160);
  });

  it('parses frame with 4-byte content size', () => {
    // FHD: bits 7-6=FCS(2)=4 bytes, bit 5=single=1, bits 1-0=dict=0 -> 0xA0. Then 4 bytes LE = 0x10000.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0x00, 0x00, 0x01, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.contentSize).toBe(0x10000);
    expect(header.headerSize).toBe(5);
  });

  it('parses frame with 8-byte content size', () => {
    // FHD: bits 7-6=FCS(3)=8 bytes, bit 5=single=1 -> 0xE0. Then 8 bytes LE = 2^32.
    const data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
    const { header } = parseZstdFrame(data, 0);
    expect(header.contentSize).toBe(0x1_0000_0000);
    expect(header.headerSize).toBe(9);
  });

  it('rejects input too short for magic', () => {
    const data = new Uint8Array([0x28, 0xb5, 0x2f]);
    expect(() => parseZstdFrame(data, 0)).toThrow(/too short|magic/i);
  });

  it('parses all valid frame-header descriptor combinations', () => {
    const didCases: ReadonlyArray<Uint8Array> = [
      new Uint8Array([]),
      new Uint8Array([0x7f]),
      new Uint8Array([0x34, 0x12]),
      new Uint8Array([0x78, 0x56, 0x34, 0x12]),
    ];
    const fcsCases: ReadonlyArray<Uint8Array> = [
      new Uint8Array([0x11]),
      new Uint8Array([0x34, 0x12]),
      new Uint8Array([0x78, 0x56, 0x34, 0x12]),
      new Uint8Array([0xef, 0xcd, 0xab, 0x89, 0x01, 0x00, 0x00, 0x00]),
    ];

    for (const singleSegment of [false, true]) {
      for (let dictionaryIdFlag = 0; dictionaryIdFlag <= 3; dictionaryIdFlag++) {
        for (let frameContentSizeFlag = 0; frameContentSizeFlag <= 3; frameContentSizeFlag++) {
          for (const checksum of [false, true]) {
            const fhd =
              (frameContentSizeFlag << 6) |
              ((singleSegment ? 1 : 0) << 5) |
              ((checksum ? 1 : 0) << 2) |
              dictionaryIdFlag;

            const wd = singleSegment ? null : 0x00;
            const dictBytes = didCases[dictionaryIdFlag]!;
            const fcsFieldSize = fcsSize(frameContentSizeFlag, singleSegment);
            const fcsBytes =
              fcsFieldSize > 0 ? fcsCases[frameContentSizeFlag]!.subarray(0, fcsFieldSize) : new Uint8Array(0);
            const data = buildFrameHeaderBytes(fhd, wd, dictBytes, fcsBytes);
            const { header } = parseZstdFrame(data, 0);
            const expectedDictionaryId =
              dictionaryIdFlag === 0
                ? null
                : dictionaryIdFlag === 1
                  ? 0x7f
                  : dictionaryIdFlag === 2
                    ? 0x1234
                    : 0x12345678;

            const expectedHeaderSize = 1 + (singleSegment ? 0 : 1) + didSize(dictionaryIdFlag) + fcsFieldSize;
            expect(header.headerSize).toBe(expectedHeaderSize);
            expect(header.singleSegment).toBe(singleSegment);
            expect(header.hasContentChecksum).toBe(checksum);
            expect(header.dictionaryId).toBe(expectedDictionaryId);
            expect(header.contentSize).toBe(
              fcsFieldSize === 0
                ? null
                : fcsFieldSize === 1
                  ? 0x11
                  : fcsFieldSize === 2
                    ? 256 + 0x1234
                    : fcsFieldSize === 4
                      ? 0x12345678
                      : 0x1_89abcdef,
            );
            expect(header.windowSize).toBe(singleSegment ? (header.contentSize ?? 0) : 1024);
          }
        }
      }
    }
  });

  it('rejects truncation at each header byte for representative shapes', () => {
    const representative = [
      buildFrameHeaderBytes(0x00, 0x00, new Uint8Array([]), new Uint8Array([])),
      buildFrameHeaderBytes(0x26, null, new Uint8Array([0x01, 0x00]), new Uint8Array([0x10, 0x00])),
      buildFrameHeaderBytes(
        0xe7,
        null,
        new Uint8Array([0x78, 0x56, 0x34, 0x12]),
        new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]),
      ),
    ];

    for (const frame of representative) {
      const parsed = parseZstdFrame(frame, 0);
      const requiredLength = 4 + parsed.header.headerSize;
      for (let cut = 0; cut < requiredLength; cut++) {
        const truncated = frame.subarray(0, cut);
        expect(() => parseZstdFrame(truncated, 0)).toThrow();
      }
    }
  });

  it('handles hostile offsets and random byte inputs without runtime exceptions', () => {
    expect(() => parseZstdFrame(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]), Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => parseFrameHeader(new Uint8Array([0x00, 0x00]), Number.MAX_SAFE_INTEGER)).toThrow();

    let state = 0x1234abcd;
    for (let i = 0; i < 400; i++) {
      const len = state & 63;
      const bytes = new Uint8Array(len);
      for (let j = 0; j < len; j++) {
        state = (state * 1664525 + 1013904223) >>> 0;
        bytes[j] = state & 0xff;
      }
      try {
        parseZstdFrame(bytes, 0);
      } catch (err) {
        expect(err).not.toBeInstanceOf(RangeError);
        expect(err).toBeInstanceOf(ZstdError);
      }
      try {
        parseFrameHeader(bytes, 0);
      } catch (err) {
        expect(err).not.toBeInstanceOf(RangeError);
        expect(err).toBeInstanceOf(ZstdError);
      }
    }
  });
});
