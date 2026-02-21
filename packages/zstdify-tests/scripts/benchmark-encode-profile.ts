#!/usr/bin/env node
/**
 * Focused encode profiler:
 * - one payload, run many compress turns in a tight loop
 * - intended to run with --cpu-prof for hotspot analysis
 *
 * Example:
 *   node --cpu-prof --cpu-prof-name=zstdify-encode-profile.cpuprofile scripts/benchmark-encode-profile.ts --turns 120000
 */

import zlib from 'node:zlib';
import { compress } from 'zstdify';

function makeSeededPayload(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

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
  return 80_000;
}

function main(): void {
  const turns = parseTurns(process.argv.slice(2));
  const payload = makeSeededPayload(64 * 1024, 0x12345678);

  let checksum = 0;
  const started = performance.now();
  for (let i = 0; i < turns; i++) {
    const a = compress(payload, { level: 9 });
    const b = zlib.zstdCompressSync(Buffer.from(payload), {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 9 },
    });
    // biome-ignore lint/style/noNonNullAssertion: safe
    checksum = (checksum + (a[0] ?? 0) + (b[0] ?? 0)) | 0;
  }
  const elapsedMs = performance.now() - started;

  console.log(
    JSON.stringify(
      {
        turns,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        encodeOps: turns * 2,
        checksum,
      },
      null,
      2,
    ),
  );
}

main();
