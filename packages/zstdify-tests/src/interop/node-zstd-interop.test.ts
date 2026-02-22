import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compress, decompress } from 'zstdify';
import { formatInteropDivergenceReport, runNodeInteropDivergenceDebug } from '../helpers/divergenceDebug.js';
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
const INTEROP_DEBUG_ENABLED = process.env.ZSTDIFY_INTEROP_DEBUG === '1';
const INTEROP_DEBUG_PAYLOAD = process.env.ZSTDIFY_INTEROP_DEBUG_PAYLOAD ?? 'corpus-linux-kernel-tar';
const INTEROP_PASS_LEVEL = Number.parseInt(process.env.ZSTDIFY_INTEROP_DEBUG_PASS_LEVEL ?? '3', 10);
const INTEROP_FAIL_LEVELS = (process.env.ZSTDIFY_INTEROP_DEBUG_FAIL_LEVELS ?? '5,9')
  .split(',')
  .map((x) => Number.parseInt(x.trim(), 10))
  .filter((x) => Number.isFinite(x));

describe('interop: Node zstd <-> zstdify', () => {
  for (const { id, category, data } of PAYLOADS) {
    for (const level of LEVELS) {
      it(`${id} (${category}) level ${level}: round-trips both directions`, async () => {
        const originalHash = sha256(data);
        const shouldEmitDebug =
          INTEROP_DEBUG_ENABLED &&
          id === INTEROP_DEBUG_PAYLOAD &&
          level !== INTEROP_PASS_LEVEL &&
          INTEROP_FAIL_LEVELS.includes(level);

        const nodeCompressed = nodeCompress(data, level);
        const zstdifyDecoded = decompress(nodeCompressed, { validateChecksum: false });
        if (shouldEmitDebug) {
          const report = await runNodeInteropDivergenceDebug({
            payloadId: id,
            input: data,
            passLevel: INTEROP_PASS_LEVEL,
            failLevel: level,
          });
          if (report) {
            console.error(formatInteropDivergenceReport(report));
          } else {
            console.error(
              `[interop-debug] ${id} level ${INTEROP_PASS_LEVEL} -> ${level}: no divergence between decoded outputs`,
            );
          }
        }
        expect(sha256(zstdifyDecoded)).toBe(originalHash);

        const zstdifyCompressed = compress(data, { level });
        const nodeDecoded = nodeDecompress(zstdifyCompressed);
        expect(sha256(nodeDecoded)).toBe(originalHash);
      });
    }
  }
});
