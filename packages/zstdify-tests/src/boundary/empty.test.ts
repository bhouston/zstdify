/**
 * Boundary tests: empty input, tiny blocks, etc.
 */

import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';

describe('boundary', () => {
  it('rejects empty input', () => {
    expect(() => decompress(new Uint8Array(0))).toThrow();
  });

  it('rejects truncated input (too short for magic)', () => {
    expect(() => decompress(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it('rejects invalid magic', () => {
    const bad = new Uint8Array(20);
    bad.fill(0);
    expect(() => decompress(bad)).toThrow();
  });
});
