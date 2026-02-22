#!/usr/bin/env node
/**
 * Focused decode profiler:
 * - compress corpus payloads once
 * - run many decode turns in a tight loop
 * - intended to run with --cpu-prof for hotspot analysis
 *
 * Example:
 *   node --cpu-prof --cpu-prof-name=zstdify-decode-profile.cpuprofile scripts/benchmark-decode-profile.ts --turns 120000
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress, type DecoderContext, decompress } from 'zstdify';
import { loadBenchCorpus, selectProfilePayload } from './bench-corpus.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');

function parseTurns(argv: string[]): number {
  const flagIndex = argv.indexOf('--turns');
  if (flagIndex !== -1) {
    const raw = argv[flagIndex + 1];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid --turns value: ${raw}`);
    }
    return Math.floor(parsed);
  }
  const envTurns = process.env.PROFILE_TURNS;
  if (envTurns) {
    const parsed = Number(envTurns);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid PROFILE_TURNS value: ${envTurns}`);
    }
    return Math.floor(parsed);
  }
  return process.env.BENCH_PROFILE_DATASET ? 2000 : 10000;
}

function resolveProgressEveryTurns(turns: number): number {
  const envValue = process.env.BENCH_PROFILE_PROGRESS_EVERY;
  if (envValue) {
    const parsed = Number(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid BENCH_PROFILE_PROGRESS_EVERY value: ${envValue}`);
    }
    return Math.max(1, Math.floor(parsed));
  }
  return Math.max(1, Math.floor(turns / 20));
}

function main(): void {
  const turns = parseTurns(process.argv.slice(2));
  const corpus = loadBenchCorpus();
  const payloads = process.env.BENCH_PROFILE_DATASET ? [selectProfilePayload(corpus)] : corpus;
  const prepared = payloads.map((payload) => ({
    id: payload.id,
    category: payload.category,
    bytes: payload.data.length,
    zstdifyCompressed: compress(payload.data, { level: 6 }),
    nodeCompressed: zlib.zstdCompressSync(Buffer.from(payload.data), {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 },
    }),
    ctxZstdify: {} as DecoderContext,
    ctxNode: {} as DecoderContext,
    turns: 0,
  }));

  if (prepared.length === 0) {
    throw new Error('Local benchmark corpus is empty.');
  }

  const progressEveryTurns = resolveProgressEveryTurns(turns);
  const startedAt = Date.now();
  console.log(
    `[decode-profile] starting turns=${turns} payloads=${prepared.length} mode=${
      process.env.BENCH_PROFILE_DATASET ? 'single-payload' : 'full-corpus'
    } progressEveryTurns=${progressEveryTurns}`,
  );

  let checksum = 0;
  let totalDecodedBytes = 0;
  const started = performance.now();
  for (let i = 0; i < turns; i++) {
    const p = prepared[i % prepared.length];
    if (!p) {
      throw new Error('Profile payload selection failed');
    }
    const a = decompress(p.zstdifyCompressed, { validateChecksum: false, reuseContext: p.ctxZstdify });
    const b = decompress(p.nodeCompressed, { validateChecksum: false, reuseContext: p.ctxNode });
    // biome-ignore lint/style/noNonNullAssertion: safe
    checksum = (checksum + a[0]! + b[0]!) | 0;
    p.turns++;
    totalDecodedBytes += p.bytes * 2;

    const completedTurns = i + 1;
    if (completedTurns === turns || completedTurns % progressEveryTurns === 0) {
      const elapsedMs = performance.now() - started;
      const pct = ((completedTurns / turns) * 100).toFixed(1);
      const etaMs = completedTurns === 0 ? 0 : (elapsedMs / completedTurns) * (turns - completedTurns);
      const wallElapsedMs = Date.now() - startedAt;
      console.log(
        `[decode-profile] progress ${completedTurns}/${turns} (${pct}%) elapsed=${wallElapsedMs}ms eta=${Math.round(
          etaMs,
        )}ms`,
      );
    }
  }
  const elapsedMs = performance.now() - started;

  const summary = {
    version: 1,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    turns,
    profileMode: process.env.BENCH_PROFILE_DATASET ? 'single-payload' : 'full-corpus',
    payloadCount: prepared.length,
    payloads: prepared.map((p) => ({
      id: p.id,
      category: p.category,
      bytes: p.bytes,
      turns: p.turns,
    })),
    elapsedMs: Number(elapsedMs.toFixed(2)),
    decodeOps: turns * 2,
    decodeOpsPerSecond: Number(((turns * 2 * 1000) / elapsedMs).toFixed(2)),
    decodedMBPerSecond: Number(((totalDecodedBytes / 1_000_000 / elapsedMs) * 1000).toFixed(2)),
    checksum,
  };

  fs.mkdirSync(BENCH_DIR, { recursive: true });
  const outPath = path.join(BENCH_DIR, 'decode-profile.latest.json');
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath}`);
}

main();
