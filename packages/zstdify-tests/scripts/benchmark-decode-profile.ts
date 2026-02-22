#!/usr/bin/env node
/**
 * Focused decode profiler:
 * - compress once
 * - run many decode turns in a tight loop
 * - intended to run with --cpu-prof for hotspot analysis
 *
 * Example:
 *   node --cpu-prof --cpu-prof-name=zstdify-decode-profile.cpuprofile scripts/benchmark-decode-profile.ts --turns 120000
 */

import zlib from 'node:zlib';
import { compress, type DecoderContext, decompress } from 'zstdify';
import { loadBenchCorpus, selectProfilePayload } from './bench-corpus.ts';

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
  const payload = selectProfilePayload(loadBenchCorpus());
  const zstdifyCompressed = compress(payload.data, { level: 6 });
  const nodeCompressed = zlib.zstdCompressSync(Buffer.from(payload.data), {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 },
  });

  const ctxZstdify: DecoderContext = {};
  const ctxNode: DecoderContext = {};
  let checksum = 0;
  const started = performance.now();
  for (let i = 0; i < turns; i++) {
    const a = decompress(zstdifyCompressed, { validateChecksum: false, reuseContext: ctxZstdify });
    const b = decompress(nodeCompressed, { validateChecksum: false, reuseContext: ctxNode });
    // biome-ignore lint/style/noNonNullAssertion: safe
    checksum = (checksum + a[0]! + b[0]!) | 0;
  }
  const elapsedMs = performance.now() - started;

  console.log(
    JSON.stringify(
      {
        turns,
        payloadId: payload.id,
        payloadCategory: payload.category,
        payloadBytes: payload.data.length,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        decodeOps: turns * 2,
        checksum,
      },
      null,
      2,
    ),
  );
}

main();
