import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compress, decompress, generateDictionary } from 'zstdify';

const LEVEL = 3;
const DICT_SIZE_BYTES = 4096;
const encoder = new TextEncoder();

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function nodeCompressWithDictionary(data: Uint8Array, dictionary: Uint8Array): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: LEVEL,
  };
  return zlib.zstdCompressSync(Buffer.from(data), {
    params,
    dictionary: Buffer.from(dictionary),
  });
}

function nodeCompressWithoutDictionary(data: Uint8Array): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: LEVEL,
  };
  return zlib.zstdCompressSync(Buffer.from(data), { params });
}

function nodeDecompressWithDictionary(data: Uint8Array, dictionary: Uint8Array): Uint8Array {
  return new Uint8Array(
    zlib.zstdDecompressSync(Buffer.from(data), {
      dictionary: Buffer.from(dictionary),
    }),
  );
}

type DictCase = {
  id: string;
  trainingSamples: Uint8Array[];
  payload: Uint8Array;
};

const CASES: DictCase[] = [
  {
    id: 'http-log-like-text',
    trainingSamples: [
      encoder.encode('GET /api/users?page=1 HTTP/1.1 host=example.com status=200 content-type=application/json'),
      encoder.encode('GET /api/users?page=2 HTTP/1.1 host=example.com status=200 content-type=application/json'),
      encoder.encode('POST /api/login HTTP/1.1 host=example.com status=200 content-type=application/json'),
      encoder.encode('GET /assets/app.js HTTP/1.1 host=cdn.example.com status=200 content-type=application/javascript'),
    ],
    payload: encoder.encode(
      Array.from(
        { length: 200 },
        (_, i) => `GET /api/users?page=${(i % 12) + 1} HTTP/1.1 host=example.com status=200 content-type=application/json`,
      ).join('\n'),
    ),
  },
  {
    id: 'json-event-like-text',
    trainingSamples: [
      encoder.encode('{"event":"click","screen":"home","user":"u-123","platform":"ios","version":"1.2.0"}'),
      encoder.encode('{"event":"view","screen":"search","user":"u-234","platform":"ios","version":"1.2.0"}'),
      encoder.encode('{"event":"purchase","screen":"checkout","user":"u-345","platform":"android","version":"1.2.0"}'),
      encoder.encode('{"event":"view","screen":"profile","user":"u-456","platform":"android","version":"1.2.0"}'),
    ],
    payload: encoder.encode(
      Array.from(
        { length: 240 },
        (_, i) =>
          `{"event":"view","screen":"home","user":"u-${100 + (i % 30)}","platform":"ios","version":"1.2.0","exp":"A"}`,
      ).join('\n'),
    ),
  },
  {
    id: 'code-token-like-text',
    trainingSamples: [
      encoder.encode('function parseToken(input) { return input.trim().split(":"); }'),
      encoder.encode('const options = { level: 3, checksum: false, strategy: "fast" };'),
      encoder.encode('if (token.kind === "identifier") emitSymbol(token.value);'),
      encoder.encode('for (let i = 0; i < tokens.length; i++) { consume(tokens[i]); }'),
    ],
    payload: encoder.encode(
      Array.from(
        { length: 220 },
        (_, i) =>
          `const token${i} = parseToken("identifier:node:zstd:${i % 7}"); if (token${i}[0] === "identifier") emitSymbol(token${i}[1]);`,
      ).join('\n'),
    ),
  },
];

describe('interop: dictionary training (fast minimal cases, zstdify <-> Node zstd)', () => {
  for (const c of CASES) {
    it(`${c.id}: Node dictionary ratio improves and zstdify decodes Node frame`, () => {
      const dictionary = generateDictionary(c.trainingSamples, {
        maxDictSize: DICT_SIZE_BYTES,
        algorithm: 'fastcover',
      });
      expect(dictionary.length).toBeGreaterThan(0);

      // Validate compression ratio improvement with dictionary on Node's zstd engine.
      const nodeWithoutDictionary = nodeCompressWithoutDictionary(c.payload);
      const nodeWithDictionary = nodeCompressWithDictionary(c.payload, dictionary);
      expect(nodeWithDictionary.length).toBeLessThan(nodeWithoutDictionary.length);

      // Validate zstdify can decode dictionary-compressed streams produced by Node.
      expect(sha256(decompress(nodeWithDictionary, { dictionary }))).toBe(sha256(c.payload));
    });
  }

  const knownGoodCase = CASES[0];
  if (!knownGoodCase) {
    throw new Error('Missing known-good dictionary test case');
  }

  it(`${knownGoodCase.id}: zstdify dictionary-compressed frame decodes in both runtimes`, () => {
    const dictionary = generateDictionary(knownGoodCase.trainingSamples, {
      maxDictSize: DICT_SIZE_BYTES,
      algorithm: 'fastcover',
    });
    expect(dictionary.length).toBeGreaterThan(0);

    // Validate Node can decode streams produced by zstdify when the same dictionary is supplied.
    const zstdifyWithDictionary = compress(knownGoodCase.payload, {
      level: LEVEL,
      dictionary,
      noDictId: true,
    });
    expect(sha256(decompress(zstdifyWithDictionary, { dictionary }))).toBe(sha256(knownGoodCase.payload));
    expect(sha256(nodeDecompressWithDictionary(zstdifyWithDictionary, dictionary))).toBe(sha256(knownGoodCase.payload));
  });

  for (const c of CASES.slice(1)) {
    it(`${c.id}: zstdify dictionary-compressed frame decodes in both runtimes`, () => {
      const dictionary = generateDictionary(c.trainingSamples, {
        maxDictSize: DICT_SIZE_BYTES,
        algorithm: 'fastcover',
      });
      expect(dictionary.length).toBeGreaterThan(0);

      const zstdifyWithDictionary = compress(c.payload, {
        level: LEVEL,
        dictionary,
        noDictId: true,
      });
      expect(sha256(decompress(zstdifyWithDictionary, { dictionary }))).toBe(sha256(c.payload));
      expect(sha256(nodeDecompressWithDictionary(zstdifyWithDictionary, dictionary))).toBe(sha256(c.payload));
    });
  }
});
