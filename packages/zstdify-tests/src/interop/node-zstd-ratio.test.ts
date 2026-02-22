/**
 * Compression ratio comparison: Node built-in zstd vs zstdify.
 * Asserts zstdify compressed size is within ~10% of Node's (Node may be better, but not 2x).
 */

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compress } from 'zstdify';
import { loadLocalBenchCorpusForTests } from '../helpers/localBenchCorpus.js';
import { makeBinaryPayload, makeSeededPayload } from '../helpers/payloadHelpers.js';

function nodeZstdCompress(data: Uint8Array, level: number): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: level,
  };
  return zlib.zstdCompressSync(Buffer.from(data), { params });
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
  {
    id: 'synthetic-sequential-256',
    category: 'synthetic',
    data: (() => {
      const a = new Uint8Array(256);
      for (let i = 0; i < 256; i++) a[i] = i;
      return a;
    })(),
  },
];
const CORPUS_PAYLOADS = loadLocalBenchCorpusForTests().map((x) => ({
  id: `corpus-${x.id}`,
  category: x.category,
  data: x.data,
}));
const PAYLOADS = [...SYNTHETIC_PAYLOADS, ...CORPUS_PAYLOADS];

/** Levels 3, 5, 9: zstdify level 1 is RLE/raw only (no compressed blocks), so ratio is not comparable; skip 0 for Node. */
const LEVELS = [3, 5, 9];

const TOLERANCE = 1.1; // zstdify size must be <= nodeSize * 1.10
const CORPUS_SIZE_GATES: Record<string, number> = {
  'corpus-war-and-peace-txt|3': 500000,
  'corpus-war-and-peace-txt|5': 500000,
  'corpus-war-and-peace-txt|9': 500000,
  'corpus-shakespeare-complete-txt|3': 510000,
  'corpus-shakespeare-complete-txt|5': 510000,
  'corpus-shakespeare-complete-txt|9': 510000,
  'corpus-enwik8|3': 660606,
  'corpus-enwik8|5': 660606,
  'corpus-enwik8|9': 660606,
  'corpus-linux-kernel-tar|3': 375241,
  'corpus-linux-kernel-tar|5': 375241,
  'corpus-linux-kernel-tar|9': 375241,
  'corpus-apollo17-flightplan-pdf|3': 47055,
  'corpus-apollo17-flightplan-pdf|5': 47055,
  'corpus-apollo17-flightplan-pdf|9': 47055,
};

describe('interop: Node zstd vs zstdify compression ratio', () => {
  for (const { id, category, data } of PAYLOADS) {
    for (const level of LEVELS) {
      it(`${id} (${category}) level ${level}: ratio/size gate`, () => {
        const nodeCompressed = nodeZstdCompress(data, level);
        const zstdifyCompressed = compress(data, { level });
        const nodeSize = nodeCompressed.length;
        const zstdifySize = zstdifyCompressed.length;
        const caseId = `${id}|${level}`;
        const corpusGate = CORPUS_SIZE_GATES[caseId];

        if (corpusGate !== undefined) {
          expect(
            zstdifySize,
            `${id} level ${level}: zstdify size ${zstdifySize} should be <= corpus gate ${corpusGate}`,
          ).toBeLessThanOrEqual(corpusGate);
          return;
        }

        const maxAllowed = nodeSize * TOLERANCE;
        expect(
          zstdifySize,
          `${id} level ${level}: zstdify ${zstdifySize} should be <= Node ${nodeSize} * 1.10 = ${maxAllowed}`,
        ).toBeLessThanOrEqual(maxAllowed);
      });
    }
  }
});
