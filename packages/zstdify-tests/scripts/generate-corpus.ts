#!/usr/bin/env node

/**
 * Generates a decodecorpus-style fixture corpus for decoder conformance testing.
 * Uses the zstd CLI to compress deterministic payloads; writes .zst files and
 * a manifest.json (with sha256 of original) so tests can verify decompress without
 * storing originals.
 *
 * Run from repo root: pnpm --filter zstdify-tests run generate:corpus
 * Requires: zstd CLI installed.
 */

import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_CORPUS_DIR = path.join(__dirname, '..', 'fixtures', 'corpus');

interface ManifestEntry {
  file: string;
  level: number;
  originalSize: number;
  sha256: string;
  description?: string;
}

interface Manifest {
  version: number;
  generator: string;
  entries: ManifestEntry[];
}

function makeSeededPayload(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

function sha256Hex(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function zstdCompressToFile(input: Uint8Array, outPath: string, args: string[]): void {
  const result = spawnSync('zstd', ['-q', '-c', ...args], {
    input: Buffer.from(input),
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(`zstd compress failed: ${result.stderr?.toString() ?? 'unknown error'}`);
  }
  fs.writeFileSync(outPath, result.stdout);
}

function main(): void {
  if (spawnSync('zstd', ['--version'], { encoding: 'utf8' }).status !== 0) {
    console.error('generate-corpus: zstd CLI not found. Install zstd to generate fixtures.');
    process.exit(1);
  }

  if (!fs.existsSync(FIXTURES_CORPUS_DIR)) {
    fs.mkdirSync(FIXTURES_CORPUS_DIR, { recursive: true });
  }

  const manifest: Manifest = {
    version: 1,
    generator: 'generate-corpus.ts',
    entries: [],
  };

  const payloads: Array<{ name: string; data: Uint8Array; description?: string }> = [
    { name: 'empty', data: new Uint8Array(0), description: 'empty' },
    {
      name: 'one-byte',
      data: new Uint8Array([0x61]),
      description: 'single byte',
    },
    {
      name: '100b-seed0',
      data: makeSeededPayload(100, 0x12345678),
      description: '100 bytes seeded random',
    },
    {
      name: '4k-seed0',
      data: makeSeededPayload(4 * 1024, 0x12345678),
      description: '4K seeded random',
    },
    {
      name: '64k-seed0',
      data: makeSeededPayload(64 * 1024, 0x12345678),
      description: '64K seeded random',
    },
    {
      name: '8k-rle',
      data: (() => {
        const a = new Uint8Array(8192);
        a.fill(0x61);
        return a;
      })(),
      description: '8192 repeated 0x61',
    },
  ];

  const levels = [-1, -3, -6, -9];

  for (const payload of payloads) {
    for (const level of levels) {
      const base = `${payload.name}-level${level}`;
      const zstPath = path.join(FIXTURES_CORPUS_DIR, `${base}.zst`);
      zstdCompressToFile(payload.data, zstPath, ['--no-check', String(level)]);
      manifest.entries.push({
        file: `${base}.zst`,
        level,
        originalSize: payload.data.length,
        sha256: sha256Hex(payload.data),
        description: payload.description,
      });
    }
  }

  // A few with --check for checksum verification in decoder
  const checkPayloads = [
    { name: '100b-seed0', data: makeSeededPayload(100, 0x12345678) },
    { name: '4k-seed0', data: makeSeededPayload(4 * 1024, 0x12345678) },
  ];
  for (const payload of checkPayloads) {
    const base = `${payload.name}-level3-check`;
    const zstPath = path.join(FIXTURES_CORPUS_DIR, `${base}.zst`);
    zstdCompressToFile(payload.data, zstPath, ['-3', '--check']);
    manifest.entries.push({
      file: `${base}.zst`,
      level: 3,
      originalSize: payload.data.length,
      sha256: sha256Hex(payload.data),
      description: `${payload.name} with frame checksum`,
    });
  }

  const manifestPath = path.join(FIXTURES_CORPUS_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifest.entries.length} fixtures and ${manifestPath}`);
}

main();
