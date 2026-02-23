import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { createDictionary } from 'simple-zstd';
import { describe, expect, it } from 'vitest';
import { compress, decompress, generateDictionary } from 'zstdify';
import {
  requireZstdCli,
  zstdCompress,
  zstdCompressWithDictionary,
  zstdDecompressWithDictionary,
} from '../helpers/zstdCli.js';

const LEVEL = 3;
const DICT_SIZE_BYTES = 4096;
const ZSTD_CLI_DICT_SIZE_BYTES = 3072;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function nodeDecompressWithoutDictionary(data: Uint8Array): Uint8Array {
  return new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data)));
}

async function withTempDictionaryPath<T>(dictionary: Uint8Array, fn: (dictPath: string) => Promise<T>): Promise<T> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'zstdify-dict-corpus-'));
  try {
    const dictPath = join(tempRoot, 'dictionary.dict');
    writeFileSync(dictPath, Buffer.from(dictionary));
    return await fn(dictPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function buildZstdCliDictionary(trainingSamples: Uint8Array[], maxDictSize: number): Promise<Uint8Array> {
  const expandedSamples = [...trainingSamples];
  let expansionIndex = 0;
  // zstd CLI training rejects very small sample counts; pad with slight variants.
  while (expandedSamples.length < 8) {
    const base = trainingSamples[expansionIndex % trainingSamples.length];
    if (base === undefined) {
      throw new Error('Training sample missing');
    }
    const suffix = encoder.encode(`\ntrain-variant-${expandedSamples.length}`);
    const variant = new Uint8Array(base.length + suffix.length);
    variant.set(base, 0);
    variant.set(suffix, base.length);
    expandedSamples.push(variant);
    expansionIndex++;
  }

  const dictBuffer = await createDictionary({
    trainingFiles: expandedSamples.map((s) => Buffer.from(s)),
    maxDictSize,
  });
  return new Uint8Array(dictBuffer);
}

type DictCase = {
  id: string;
  trainingSamples: Uint8Array[];
  payload: Uint8Array;
};

type PayloadVariableSpec =
  | {
      kind: 'index';
    }
  | {
      kind: 'mod';
      mod: number;
      add?: number;
    };

type DictCaseFixture = {
  id: string;
  trainingSamples: string[];
  payload: {
    count: number;
    template: string;
    variables: Record<string, PayloadVariableSpec>;
  };
};

const FIXTURE_DIR = new URL('../../fixtures/interop/node-zstd-dictionary-corpus/', import.meta.url);

function renderPayloadFromFixture(spec: DictCaseFixture['payload']): Uint8Array {
  const lines: string[] = [];
  for (let i = 0; i < spec.count; i++) {
    let line = spec.template;
    for (const [name, variableSpec] of Object.entries(spec.variables)) {
      let value = i;
      if (variableSpec.kind === 'mod') {
        value = (i % variableSpec.mod) + (variableSpec.add ?? 0);
      }
      line = line.replaceAll(`{{${name}}}`, String(value));
    }
    lines.push(line);
  }
  return encoder.encode(lines.join('\n'));
}

function loadCaseFromFixture(id: string): DictCase {
  const fixtureRaw = readFileSync(new URL(`${id}.txt`, FIXTURE_DIR), 'utf8');
  const fixture = JSON.parse(fixtureRaw) as DictCaseFixture;
  return {
    id: fixture.id,
    trainingSamples: fixture.trainingSamples.map((sample) => encoder.encode(sample)),
    payload: renderPayloadFromFixture(fixture.payload),
  };
}

function payloadLineSamples(payload: Uint8Array, maxSamples: number): Uint8Array[] {
  const lines = decoder
    .decode(payload)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(0, maxSamples).map((line) => encoder.encode(line));
}

const CASE_IDS = ['http-log-like-text', 'json-event-like-text', 'code-token-like-text'] as const;
const CASES: DictCase[] = CASE_IDS.map((id) => loadCaseFromFixture(id));

describe('interop: dictionary training (fast minimal cases, zstdify <-> Node zstd)', () => {
  requireZstdCli();

  for (const c of CASES) {
    it(`${c.id}: Node decodes zstdify frame without dictionary`, () => {
      const zstdifyWithoutDictionary = compress(c.payload, {
        level: LEVEL,
      });
      expect(sha256(nodeDecompressWithoutDictionary(zstdifyWithoutDictionary))).toBe(sha256(c.payload));
    });
  }

  for (const c of CASES) {
    it(`${c.id}: zstdify frame without dictionary decodes in both runtimes`, () => {
      const zstdifyWithoutDictionary = compress(c.payload, {
        level: LEVEL,
      });
      expect(sha256(decompress(zstdifyWithoutDictionary))).toBe(sha256(c.payload));
      expect(sha256(nodeDecompressWithoutDictionary(zstdifyWithoutDictionary))).toBe(sha256(c.payload));
    });
  }

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

  for (const c of CASES) {
    it(`${c.id}: zstdify-trained dictionary is valid for zstd CLI and improves zstd CLI ratio`, async () => {
      const dictionary = generateDictionary(c.trainingSamples, {
        maxDictSize: DICT_SIZE_BYTES,
        algorithm: 'fastcover',
      });
      expect(dictionary.length).toBeGreaterThan(0);

      const zstdWithoutDictionary = await zstdCompress(c.payload, ['-3', '--no-check']);
      const zstdWithDictionary = await withTempDictionaryPath(dictionary, (dictPath) =>
        zstdCompressWithDictionary(c.payload, dictPath),
      );
      expect(zstdWithDictionary.length).toBeLessThan(zstdWithoutDictionary.length);

      expect(sha256(decompress(zstdWithDictionary, { dictionary }))).toBe(sha256(c.payload));

      const zstdifyWithDictionary = compress(c.payload, {
        level: LEVEL,
        dictionary,
        noDictId: true,
      });
      const zstdCliDecoded = await withTempDictionaryPath(dictionary, (dictPath) =>
        zstdDecompressWithDictionary(zstdifyWithDictionary, dictPath),
      );
      expect(sha256(zstdCliDecoded)).toBe(sha256(c.payload));
    });
  }

  it(`${knownGoodCase.id}: zstd CLI-trained dictionary is valid for zstdify`, async () => {
    const zstdCliDictionary = await buildZstdCliDictionary(
      [...knownGoodCase.trainingSamples, ...payloadLineSamples(knownGoodCase.payload, 96)],
      ZSTD_CLI_DICT_SIZE_BYTES,
    );
    expect(zstdCliDictionary.length).toBeGreaterThan(0);

    const zstdCliCompressed = await withTempDictionaryPath(zstdCliDictionary, (dictPath) =>
      zstdCompressWithDictionary(knownGoodCase.payload, dictPath),
    );

    expect(sha256(decompress(zstdCliCompressed, { dictionary: zstdCliDictionary }))).toBe(
      sha256(knownGoodCase.payload),
    );

    const zstdifyWithDictionary = compress(knownGoodCase.payload, {
      level: LEVEL,
      dictionary: zstdCliDictionary,
      noDictId: true,
    });
    const zstdCliDecoded = await withTempDictionaryPath(zstdCliDictionary, (dictPath) =>
      zstdDecompressWithDictionary(zstdifyWithDictionary, dictPath),
    );
    expect(sha256(zstdCliDecoded)).toBe(sha256(knownGoodCase.payload));
  });

  it(`${knownGoodCase.id}: zstd CLI-trained dictionary improves zstd CLI ratio`, async () => {
    const zstdCliDictionary = await buildZstdCliDictionary(
      [...knownGoodCase.trainingSamples, ...payloadLineSamples(knownGoodCase.payload, 96)],
      ZSTD_CLI_DICT_SIZE_BYTES,
    );
    expect(zstdCliDictionary.length).toBeGreaterThan(0);

    const zstdCliWithoutDictionary = await zstdCompress(knownGoodCase.payload, ['-3', '--no-check']);
    const zstdCliWithDictionary = await withTempDictionaryPath(zstdCliDictionary, (dictPath) =>
      zstdCompressWithDictionary(knownGoodCase.payload, dictPath),
    );
    expect(zstdCliWithDictionary.length).toBeLessThan(zstdCliWithoutDictionary.length);
  });
});
