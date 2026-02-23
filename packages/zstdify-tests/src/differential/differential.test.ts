import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';
import { makeBinaryPayload } from '../helpers/payloadHelpers.js';
import { requireZstdCli, zstdCompress } from '../helpers/zstdCli.js';

describe('differential: zstd -> zstdify', () => {
  requireZstdCli();
  const corpus: Array<{ name: string; data: Uint8Array }> = [
    { name: 'empty', data: new Uint8Array(0) },
    {
      name: 'small text',
      data: new TextEncoder().encode('hello world hello world hello world'),
    },
    { name: 'binary 4k', data: makeBinaryPayload(4 * 1024) },
    { name: 'binary 64k', data: makeBinaryPayload(64 * 1024) },
    { name: 'binary 256k', data: makeBinaryPayload(256 * 1024) },
  ];
  const levels = ['-1', '-3', '-6', '-9', '-19'];

  for (const { name, data } of corpus) {
    for (const level of levels) {
      it(`round-trips ${name} at level ${level}`, async () => {
        const encoded = await zstdCompress(data, ['--no-check', level]);
        const decoded = decompress(encoded);
        expect(decoded).toEqual(data);
      });
    }
  }
});
