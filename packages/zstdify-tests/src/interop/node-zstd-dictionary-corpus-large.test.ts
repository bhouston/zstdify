import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compress, decompress, generateDictionary } from 'zstdify';
import { loadLocalBenchCorpusForTests } from '../helpers/localBenchCorpus.js';

const LEVEL = 5;
const DICT_SIZE_BYTES = 16 * 1024;
const TRAIN_SAMPLE_BYTES = 8 * 1024;
const TRAIN_SAMPLE_COUNT = 32;

function makeTrainingSamples(data: Uint8Array): Uint8Array[] {
  if (data.length === 0) {
    return [new Uint8Array(0)];
  }

  if (data.length <= TRAIN_SAMPLE_BYTES) {
    return [data];
  }

  const samples: Uint8Array[] = [];
  const maxStart = data.length - TRAIN_SAMPLE_BYTES;
  const count = Math.min(TRAIN_SAMPLE_COUNT, Math.max(2, Math.floor(data.length / TRAIN_SAMPLE_BYTES)));
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * maxStart) / Math.max(1, count - 1));
    samples.push(data.subarray(start, start + TRAIN_SAMPLE_BYTES));
  }
  return samples;
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

function nodeDecompressWithDictionary(data: Uint8Array, dictionary: Uint8Array): Uint8Array {
  return new Uint8Array(
    zlib.zstdDecompressSync(Buffer.from(data), {
      dictionary: Buffer.from(dictionary),
    }),
  );
}

function nodeDecompressWithoutDictionary(data: Uint8Array): Uint8Array {
  return new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data)));
}

const CORPUS_PAYLOADS = loadLocalBenchCorpusForTests().map((payload) => ({
  id: payload.id,
  category: payload.category,
  data: payload.data,
}));

describe.skipIf(CORPUS_PAYLOADS.length === 0)('interop: dictionary training on real corpus (large, for later)', () => {
  for (const payload of CORPUS_PAYLOADS) {
    it(
      `${payload.id} (${payload.category}): zstdify dictionary compression is no worse and both runtimes decode dictionary frames`,
      { timeout: 60_000 },
      () => {
        const trainingSamples = makeTrainingSamples(payload.data);
        const dictionary = generateDictionary(trainingSamples, {
          maxDictSize: DICT_SIZE_BYTES,
          algorithm: 'fastcover',
        });
        expect(dictionary.length).toBeGreaterThan(0);

        const zstdifyWithoutDictionary = compress(payload.data, {
          level: LEVEL,
        });
        expect(decompress(zstdifyWithoutDictionary)).toEqual(payload.data);
        expect(nodeDecompressWithoutDictionary(zstdifyWithoutDictionary)).toEqual(payload.data);

        const zstdifyWithDictionary = compress(payload.data, {
          level: LEVEL,
          dictionary,
          noDictId: true,
        });
        expect(decompress(zstdifyWithDictionary, { dictionary })).toEqual(payload.data);
        expect(nodeDecompressWithDictionary(zstdifyWithDictionary, dictionary)).toEqual(payload.data);

        // Keep Node dictionary compression in the test to validate interop on dictionary frames from Node.
        const nodeWithDictionary = nodeCompressWithDictionary(payload.data, dictionary);
        expect(decompress(nodeWithDictionary, { dictionary })).toEqual(payload.data);
        expect(nodeDecompressWithDictionary(nodeWithDictionary, dictionary)).toEqual(payload.data);

        expect(zstdifyWithDictionary.length).toBeLessThan(zstdifyWithoutDictionary.length);
      },
    );
  }
});
