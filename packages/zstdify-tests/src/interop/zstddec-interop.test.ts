import { beforeAll, describe, expect, it } from 'vitest';
import { ZSTDDecoder } from 'zstddec';
import { compress } from 'zstdify';
import { makeSeededPayload } from '../helpers/payloadHelpers.js';

describe('interop: zstdify -> zstddec', () => {
  const decoder = new ZSTDDecoder();
  const input = makeSeededPayload(4 * 1024, 0xdecafbad);

  beforeAll(async () => {
    await decoder.init();
  });

  for (let level = 0; level <= 9; level++) {
    it(`zstddec decodes zstdify output at level ${level}`, () => {
      const compressed = compress(input, { level });
      const decoded = decoder.decode(compressed, input.length);
      expect(decoded).toEqual(input);
    });
  }

  it('zstddec decodes zstdify output with content checksum (level 3)', () => {
    const compressed = compress(input, { level: 3, checksum: true });
    const decoded = decoder.decode(compressed, input.length);
    expect(decoded).toEqual(input);
  });
});
