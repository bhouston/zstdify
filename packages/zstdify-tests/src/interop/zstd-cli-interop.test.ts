import { describe, expect, it } from 'vitest';
import { compress } from 'zstdify';
import { hasZstdCli, zstdDecompress } from '../helpers/zstdCli.js';

const hasZstd = hasZstdCli();
const describeIfZstd = hasZstd ? describe : describe.skip;

describeIfZstd('interop: zstdify -> zstd', () => {
  it('zstd CLI can decode zstdify output', () => {
    const input = new TextEncoder().encode('hello world from zstdify');
    const encoded = compress(input);
    const decoded = zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes multi-block zstdify output', () => {
    const input = new Uint8Array(300 * 1024);
    for (let i = 0; i < input.length; i++) {
      input[i] = i & 0xff;
    }
    const encoded = compress(input);
    const decoded = zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes zstdify level>0 RLE block output', () => {
    const input = new Uint8Array(8192);
    input.fill(0x5a);
    const encoded = compress(input, { level: 1 });
    const decoded = zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });
});
