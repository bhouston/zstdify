import { describe, expect, it } from 'vitest';
import { compress, decompress, generateDictionary } from 'zstdify';

function makeSamples(): Uint8Array[] {
  const texts = [
    'alpha beta gamma delta epsilon',
    'alpha beta gamma theta lambda',
    'header vertex texture vertex normal normal index index tangent',
    'offset match literal sequence table repeat mode huffman fse decode',
  ];
  return texts.map((text) => new TextEncoder().encode(text));
}

describe('dictionary generation integration', () => {
  it('generates deterministic dictionary bytes', () => {
    const samples = makeSamples();
    const a = generateDictionary(samples, { maxDictSize: 1024, algorithm: 'fastcover', k: 24, d: 6 });
    const b = generateDictionary(samples, { maxDictSize: 1024, algorithm: 'fastcover', k: 24, d: 6 });
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(1024);
    expect(a.length).toBeGreaterThan(0);
  });

  it('round-trips with generated dictionary and explicit dictionary id', () => {
    const dict = generateDictionary(makeSamples(), { maxDictSize: 1536, algorithm: 'cover', split: 100 });
    const payload = new TextEncoder().encode('alpha beta gamma header vertex texture');
    const encoded = compress(payload, { dictionary: { bytes: dict, id: 42 } });
    expect(() => decompress(encoded)).toThrow(/dictionary/i);
    expect(decompress(encoded, { dictionary: { bytes: dict, id: 42 } })).toEqual(payload);
  });

  it('supports noDictId mode for compatibility', () => {
    const dict = generateDictionary(makeSamples(), { maxDictSize: 1024 });
    const payload = new TextEncoder().encode('offset match literal sequence table');
    const encoded = compress(payload, { dictionary: { bytes: dict, id: 101 }, noDictId: true });
    expect(decompress(encoded)).toEqual(payload);
    expect(decompress(encoded, { dictionary: { bytes: dict, id: 101 } })).toEqual(payload);
  });
});
