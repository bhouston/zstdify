#!/usr/bin/env node
/**
 * Compression ratio regression check: for fixed payloads and levels, compare
 * compressed sizes to golden values. Fails if any size increases (worse ratio).
 *
 * Run from repo root: pnpm --filter zstdify-tests run regression:compression
 * First run creates golden file; subsequent runs compare against it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress } from 'zstdify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, 'compression-regression-golden.json');

function makeSeededPayload(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

interface Golden {
  version: number;
  entries: Array<{ id: string; level: number; size: number }>;
}

const PAYLOADS: Array<{ id: string; data: Uint8Array }> = [
  { id: 'empty', data: new Uint8Array(0) },
  { id: '1k-seed42', data: makeSeededPayload(1024, 42) },
  { id: '4k-seed0', data: makeSeededPayload(4 * 1024, 0) },
  { id: '64k-seed123', data: makeSeededPayload(64 * 1024, 123) },
];

const LEVELS = [0, 1, 3];

function run(): void {
  const results: Array<{ id: string; level: number; size: number }> = [];
  for (const { id, data } of PAYLOADS) {
    for (const level of LEVELS) {
      const out = compress(data, { level });
      results.push({ id, level, size: out.length });
    }
  }

  if (!fs.existsSync(GOLDEN_PATH)) {
    const golden: Golden = { version: 1, entries: results };
    fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
    console.log('Wrote golden:', GOLDEN_PATH);
    return;
  }

  const raw = fs.readFileSync(GOLDEN_PATH, 'utf8');
  const golden = JSON.parse(raw) as Golden;
  let failed: boolean = false;
  for (const r of results) {
    const g = golden.entries.find((e) => e.id === r.id && e.level === r.level);
    if (!g) {
      console.error(`Missing golden for ${r.id} level ${r.level}`);
      failed = true;
      continue;
    }
    if (r.size > g.size) {
      console.error(`Regression: ${r.id} level ${r.level} size ${r.size} > golden ${g.size}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log('Compression regression check passed.');
}

run();
