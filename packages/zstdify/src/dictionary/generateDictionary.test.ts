import { describe, expect, it } from 'vitest';
import { generateDictionary } from './generateDictionary.js';

function sampleBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('generateDictionary', () => {
  it('is deterministic for same inputs and options', () => {
    const samples = [
      sampleBytes('alpha beta gamma delta epsilon'),
      sampleBytes('alpha beta gamma theta lambda'),
      sampleBytes('vertex normal index tangent bitangent'),
    ];
    const a = generateDictionary(samples, {
      maxDictSize: 1024,
      algorithm: 'fastcover',
      k: 24,
      d: 6,
    });
    const b = generateDictionary(samples, {
      maxDictSize: 1024,
      algorithm: 'fastcover',
      k: 24,
      d: 6,
    });
    expect(a).toEqual(b);
  });

  it('respects maxDictSize', () => {
    const samples = [sampleBytes('a'.repeat(2048)), sampleBytes('b'.repeat(2048)), sampleBytes('ab'.repeat(2048))];
    const dict = generateDictionary(samples, { maxDictSize: 513 });
    expect(dict.length).toBeLessThanOrEqual(513);
  });

  it('supports algorithm variants', () => {
    const samples = [
      sampleBytes('compressor dictionary training corpus repeated tokens phrase phrase phrase'),
      sampleBytes('offset match literal sequence table repeat mode huffman fse decode'),
    ];
    const fast = generateDictionary(samples, { algorithm: 'fastcover', maxDictSize: 512 });
    const cover = generateDictionary(samples, { algorithm: 'cover', maxDictSize: 512 });
    const legacy = generateDictionary(samples, {
      algorithm: 'legacy',
      maxDictSize: 512,
      selectivity: 8,
    });
    expect(fast.length).toBeGreaterThan(0);
    expect(cover.length).toBeGreaterThan(0);
    expect(legacy.length).toBeGreaterThan(0);
  });

  it('throws for invalid options', () => {
    const samples = [sampleBytes('abc')];
    expect(() => generateDictionary(samples, { maxDictSize: 0 })).toThrow(/maxDictSize/i);
    expect(() => generateDictionary(samples, { dictId: 0 })).toThrow(/dictId/i);
    expect(() => generateDictionary([], { maxDictSize: 64 })).toThrow(/at least one sample/i);
  });
});
