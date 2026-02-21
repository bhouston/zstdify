import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';
import { loadLocalBenchCorpusForTests } from '../helpers/localBenchCorpus.js';
import { makeBinaryPayload, makeSeededPayload } from '../helpers/payloadHelpers.js';

function nodeCompress(data: Uint8Array, level: number): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: level,
  };
  return zlib.zstdCompressSync(Buffer.from(data), { params });
}

function nodeDecompress(data: Uint8Array): Uint8Array {
  return new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data)));
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const SYNTHETIC_PAYLOADS: Array<{ id: string; category: string; data: Uint8Array }> = [
  { id: 'synthetic-empty', category: 'synthetic', data: new Uint8Array(0) },
  {
    id: 'synthetic-small-text',
    category: 'synthetic',
    data: new TextEncoder().encode('hello world hello world hello world hello world hello world '),
  },
  { id: 'synthetic-binary-1k', category: 'synthetic', data: makeSeededPayload(1024, 42) },
  { id: 'synthetic-binary-4k', category: 'synthetic', data: makeBinaryPayload(4 * 1024) },
  { id: 'synthetic-binary-64k', category: 'synthetic', data: makeBinaryPayload(64 * 1024) },
  { id: 'synthetic-repeated-byte', category: 'synthetic', data: new Uint8Array(4096).fill(0x61) },
];

const CORPUS_PAYLOADS = loadLocalBenchCorpusForTests().map((x) => ({
  id: `corpus-${x.id}`,
  category: x.category,
  data: x.data,
}));

const PAYLOADS = [...SYNTHETIC_PAYLOADS, ...CORPUS_PAYLOADS];
const LEVELS = [3, 5, 9];

describe('interop: Node zstd <-> zstdify', () => {
  for (const { id, category, data } of PAYLOADS) {
    for (const level of LEVELS) {
      it(`${id} (${category}) level ${level}: round-trips both directions`, () => {
        const originalHash = sha256(data);

        const nodeCompressed = nodeCompress(data, level);
        const zstdifyDecoded = decompress(nodeCompressed, { validateChecksum: false });
        expect(sha256(zstdifyDecoded)).toBe(originalHash);

        const zstdifyCompressed = compress(data, { level });
        const nodeDecoded = nodeDecompress(zstdifyCompressed);
        expect(sha256(nodeDecoded)).toBe(originalHash);
      });
    }
  }
});
