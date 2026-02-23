import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

function nodeDecompressWithoutDictionary(data: Uint8Array): Uint8Array {
  return new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data)));
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

const CASE_IDS = ['http-log-like-text', 'json-event-like-text', 'code-token-like-text'] as const;
const CASES: DictCase[] = CASE_IDS.map((id) => loadCaseFromFixture(id));

describe('interop: dictionary training (fast minimal cases, zstdify <-> Node zstd)', () => {
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
});
