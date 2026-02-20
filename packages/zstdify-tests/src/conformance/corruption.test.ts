import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures');

function readFixture(name: string): Uint8Array {
  const fixturePath = path.join(fixturesDir, name);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture ${name}.`);
  }
  return new Uint8Array(fs.readFileSync(fixturePath));
}

describe('zstd corruption handling', () => {
  it('rejects truncated compressed frame', () => {
    const level1 = readFixture('level1.zst');
    const truncated = level1.subarray(0, level1.length - 1);
    expect(() => decompress(truncated)).toThrow();
  });

  it('rejects checksum mismatch in checked frame', () => {
    const checked = readFixture('level1-check.zst').slice();
    const last = checked.length - 1;
    if (last < 0) throw new Error('Fixture unexpectedly empty');
    checked[last] = (checked[last] ?? 0) ^ 0x01;
    expect(() => decompress(checked)).toThrowError(/checksum/i);
  });

  it('rejects frame content-size mismatch', () => {
    const frame = compress(new TextEncoder().encode('hello')).slice();
    // Single-segment frame with 1-byte content size at byte 5.
    frame[5] = ((frame[5] ?? 0) + 1) & 0xff;
    expect(() => decompress(frame)).toThrowError(/content size/i);
  });

  it('rejects frame header truncated', () => {
    // Magic (4 bytes) + only 1 byte of header; parseFrameHeader needs at least 2
    const buf = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00]);
    expect(() => decompress(buf)).toThrowError(/frame header truncated/i);
  });

  it('rejects unused bit set in frame header', () => {
    // FHD with bit 4 (0x10) set is unused
    const buf = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x10, 0x00]);
    expect(() => decompress(buf)).toThrowError(/unused bit/i);
  });

  it('rejects reserved bit set in frame header', () => {
    // FHD with bit 3 (0x08) set is reserved
    const buf = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x08, 0x00]);
    expect(() => decompress(buf)).toThrowError(/reserved bit/i);
  });

  it('rejects block header truncated', () => {
    // Valid magic + FHD(0) + WD(0) = 6 bytes; no block header (need 3 more)
    const buf = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00]);
    expect(() => decompress(buf)).toThrowError(/block header truncated/i);
  });

  it('rejects when decompressed size exceeds maxSize', () => {
    const compressed = compress(new TextEncoder().encode('hello'));
    expect(() => decompress(compressed, { maxSize: 1 })).toThrowError(/maxSize|exceeds/i);
  });
});
