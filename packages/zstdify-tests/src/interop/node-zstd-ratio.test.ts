/**
 * Compression ratio comparison: Node built-in zstd vs zstdify.
 * Asserts zstdify compressed size is within ~10% of Node's (Node may be better, but not 2x).
 */

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compress } from 'zstdify';
import { makeBinaryPayload, makeSeededPayload } from '../helpers/payloadHelpers.js';

function nodeZstdCompress(data: Uint8Array, level: number): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: level,
  };
  return zlib.zstdCompressSync(Buffer.from(data), { params });
}

const PAYLOADS: Array<{ id: string; data: Uint8Array }> = [
  { id: 'empty', data: new Uint8Array(0) },
  {
    id: 'small-text',
    data: new TextEncoder().encode('hello world hello world hello world hello world hello world '),
  },
  { id: 'binary-1k', data: makeSeededPayload(1024, 42) },
  { id: 'binary-4k', data: makeBinaryPayload(4 * 1024) },
  { id: 'binary-64k', data: makeBinaryPayload(64 * 1024) },
  { id: 'repeated-byte', data: new Uint8Array(4096).fill(0x61) },
  {
    id: 'sequential-256',
    data: (() => {
      const a = new Uint8Array(256);
      for (let i = 0; i < 256; i++) a[i] = i;
      return a;
    })(),
  },
];

/** Levels 3, 5, 9: zstdify level 1 is RLE/raw only (no compressed blocks), so ratio is not comparable; skip 0 for Node. */
const LEVELS = [3, 5, 9];

const TOLERANCE = 1.1; // zstdify size must be <= nodeSize * 1.10

describe('interop: Node zstd vs zstdify compression ratio', () => {
  for (const { id, data } of PAYLOADS) {
    for (const level of LEVELS) {
      it(`${id} level ${level}: zstdify within 10% of Node`, () => {
        const nodeCompressed = nodeZstdCompress(data, level);
        const zstdifyCompressed = compress(data, { level });
        const nodeSize = nodeCompressed.length;
        const zstdifySize = zstdifyCompressed.length;
        const maxAllowed = nodeSize * TOLERANCE;
        expect(
          zstdifySize,
          `${id} level ${level}: zstdify ${zstdifySize} should be <= Node ${nodeSize} * 1.10 = ${maxAllowed}`,
        ).toBeLessThanOrEqual(maxAllowed);
      });
    }
  }
});
