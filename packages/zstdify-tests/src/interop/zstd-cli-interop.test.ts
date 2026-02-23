import { describe, expect, it } from 'vitest';
import { compress } from 'zstdify';
import { requireZstdCli, zstdDecompress } from '../helpers/zstdCli.js';

function makeSeededPayload(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

describe('interop: zstdify -> zstd', () => {
  requireZstdCli();
  it('zstd CLI can decode zstdify output', async () => {
    const input = new TextEncoder().encode('hello world from zstdify');
    const encoded = compress(input);
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes multi-block zstdify output', async () => {
    const input = new Uint8Array(300 * 1024);
    for (let i = 0; i < input.length; i++) {
      input[i] = i & 0xff;
    }
    const encoded = compress(input);
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes zstdify level>0 RLE block output', async () => {
    const input = new Uint8Array(8192);
    input.fill(0x5a);
    const encoded = compress(input, { level: 1 });
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes zstdify compressed block output (level 3)', async () => {
    const input = new TextEncoder().encode('abcdabcdabcdabcdabcdabcdabcdabcd');
    const encoded = compress(input, { level: 3 });
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes zstdify multi-sequence compressed output', async () => {
    const input = new TextEncoder().encode('abcdabcdXabcdabcdYabcdabcdZabcdabcd');
    const encoded = compress(input, { level: 3 });
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes zstdify output with content checksum', async () => {
    const input = new TextEncoder().encode('checksum interoperability payload');
    const encoded = compress(input, { level: 3, checksum: true });
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes multi-sequence compressed output with checksum', async () => {
    const input = new TextEncoder().encode('abcdabcdXabcdabcdYabcdabcdZabcdabcd');
    const encoded = compress(input, { level: 3, checksum: true });
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });

  it('zstd CLI decodes seeded-random compressed output with checksum', async () => {
    const input = makeSeededPayload(96 * 1024, 0xdecafbad);
    const encoded = compress(input, { level: 3, checksum: true });
    const decoded = await zstdDecompress(encoded);
    expect(decoded).toEqual(input);
  });
});
