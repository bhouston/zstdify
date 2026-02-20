import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';
import { hasZstdCli, zstdCompress } from '../helpers/zstdCli.js';

function makeBinaryPayload(size: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = 0x12345678;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

const hasZstd = hasZstdCli();
const describeIfZstd = hasZstd ? describe : describe.skip;

describeIfZstd('differential: zstd -> zstdify', () => {
  const corpus: Array<{ name: string; data: Uint8Array }> = [
    { name: 'empty', data: new Uint8Array(0) },
    { name: 'small text', data: new TextEncoder().encode('hello world hello world hello world') },
    { name: 'binary 4k', data: makeBinaryPayload(4 * 1024) },
  ];
  const levels = ['-1', '-3', '-9'];

  for (const { name, data } of corpus) {
    for (const level of levels) {
      it(`round-trips ${name} at level ${level}`, () => {
        const encoded = zstdCompress(data, ['--no-check', level]);
        const decoded = decompress(encoded);
        expect(decoded).toEqual(data);
      });
    }
  }
});
