import { describe, expect, it } from 'vitest';
import { validateContentChecksum, xxh64 } from './checksum.js';

describe('xxh64', () => {
  it('hashes empty input', () => {
    const h = xxh64(new Uint8Array(0));
    expect(typeof h).toBe('bigint');
    expect(h).toBeGreaterThanOrEqual(0n);
  });

  it('hashes consistently', () => {
    const data = new TextEncoder().encode('hello');
    const h1 = xxh64(data);
    const h2 = xxh64(data);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('bigint');
  });

  it('validateContentChecksum matches low 32 bits', () => {
    const data = new TextEncoder().encode('test');
    const hash = xxh64(data);
    const low32 = Number(hash & 0xffffffffn);
    expect(validateContentChecksum(data, low32)).toBe(true);
    expect(validateContentChecksum(data, low32 + 1)).toBe(false);
  });
});
