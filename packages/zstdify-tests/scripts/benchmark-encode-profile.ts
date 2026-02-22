#!/usr/bin/env node
/**
 * Focused encode profiler:
 * - run many compress turns in a tight loop over local benchmark corpus payloads
 * - intended to run with --cpu-prof for hotspot analysis
 *
 * Example:
 *   node --cpu-prof --cpu-prof-name=zstdify-encode-profile.cpuprofile scripts/benchmark-encode-profile.ts --turns 120000
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compress } from 'zstdify';
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
  return process.env.BENCH_PROFILE_DATASET ? 20_000 : 80_000;
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
  if (payloads.length === 0) {
    throw new Error('Local benchmark corpus is empty.');
  }

  const progressEveryTurns = resolveProgressEveryTurns(turns);
  const perPayloadTurns = new Array<number>(payloads.length).fill(0);
  const startedAt = Date.now();
  console.log(
    `[encode-profile] starting turns=${turns} payloads=${payloads.length} mode=${
      process.env.BENCH_PROFILE_DATASET ? 'single-payload' : 'full-corpus'
    } progressEveryTurns=${progressEveryTurns}`,
  );

  let checksum = 0;
  let totalInputBytes = 0;
  let totalCompressedBytes = 0;
  const started = performance.now();
  for (let i = 0; i < turns; i++) {
    const payloadIndex = i % payloads.length;
    const payload = payloads[payloadIndex];
    if (!payload) {
      throw new Error('Profile payload selection failed');
    }
    const a = compress(payload.data, { level: 6 });
    const b = zlib.zstdCompressSync(Buffer.from(payload.data), {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 },
    });
    if (perPayloadTurns[payloadIndex] === undefined) {
      throw new Error('Per-payload turn tracking failed');
    }
    perPayloadTurns[payloadIndex]++;
    checksum = (checksum + (a[0] ?? 0) + (b[0] ?? 0)) | 0;
    totalInputBytes += payload.data.length * 2;
    totalCompressedBytes += a.length + b.length;

    const completedTurns = i + 1;
    if (completedTurns === turns || completedTurns % progressEveryTurns === 0) {
      const elapsedMs = performance.now() - started;
      const pct = ((completedTurns / turns) * 100).toFixed(1);
      const etaMs = completedTurns === 0 ? 0 : (elapsedMs / completedTurns) * (turns - completedTurns);
      const wallElapsedMs = Date.now() - startedAt;
      console.log(
        `[encode-profile] progress ${completedTurns}/${turns} (${pct}%) elapsed=${wallElapsedMs}ms eta=${Math.round(
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
    payloadCount: payloads.length,
    payloads: payloads.map((payload, idx) => ({
      id: payload.id,
      category: payload.category,
      bytes: payload.data.length,
      turns: perPayloadTurns[idx],
    })),
    elapsedMs: Number(elapsedMs.toFixed(2)),
    encodeOps: turns * 2,
    encodeOpsPerSecond: Number(((turns * 2 * 1000) / elapsedMs).toFixed(2)),
    inputMBPerSecond: Number(((totalInputBytes / 1_000_000 / elapsedMs) * 1000).toFixed(2)),
    compressedMBPerSecond: Number(((totalCompressedBytes / 1_000_000 / elapsedMs) * 1000).toFixed(2)),
    checksum,
  };

  fs.mkdirSync(BENCH_DIR, { recursive: true });
  const outPath = path.join(BENCH_DIR, 'encode-profile.latest.json');
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath}`);
}

main();
