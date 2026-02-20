/**
 * Property-based round-trip tests: for arbitrary payloads and levels,
 * decompress(compress(x, { level })) === x.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';

describe('roundtrip property-based', () => {
  it('decompress(compress(x)) === x for arbitrary Uint8Array and level 0..9', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 50 * 1024 }), fc.integer({ min: 0, max: 9 }), (data, level) => {
        const compressed = compress(data, { level });
        const decompressed = decompress(compressed);
        expect(decompressed).toEqual(data);
      }),
      { numRuns: 200 },
    );
  });
});
