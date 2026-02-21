#!/usr/bin/env node
/**
 * Benchmark: zstdify vs Node built-in zstd vs zstddec (compress/decompress throughput + ratio).
 * Writes packages/zstdify-tests/benchmarks/latest.json and latest.md.
 * Run: pnpm --filter zstdify-tests run bench:node-vs-zstdify
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { Bench } from 'tinybench';
import { ZSTDDecoder } from 'zstddec';
import { compress, decompress } from 'zstdify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');

function makeSeededPayload(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

function makeBinaryPayload(size: number): Uint8Array {
  return makeSeededPayload(size, 0x12345678);
}

const PAYLOADS: Array<{ id: string; data: Uint8Array }> = [
  {
    id: 'small-text',
    data: new TextEncoder().encode(
      'hello world hello world hello world hello world hello world ',
    ),
  },
  { id: 'binary-1k', data: makeSeededPayload(1024, 42) },
  { id: 'binary-4k', data: makeBinaryPayload(4 * 1024) },
  { id: 'binary-64k', data: makeBinaryPayload(64 * 1024) },
  { id: 'repeated-byte', data: new Uint8Array(4096).fill(0x61) },
];

const LEVELS = [3, 5, 9];

function nodeCompress(data: Uint8Array, level: number): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: level,
  };
  return zlib.zstdCompressSync(Buffer.from(data), { params });
}

interface ResultRow {
  payloadId: string;
  payloadBytes: number;
  level: number;
  compressZstdifyMs: number;
  compressNodeMs: number;
  decompressZstdifyMs: number;
  decompressNodeMs: number;
  decompressZstddecMs: number;
  ratioZstdify: number;
  ratioNode: number;
}

function mbps(bytes: number, ms: number): number {
  if (ms <= 0) return 0;
  return (bytes / 1_000_000) / (ms / 1000);
}

async function main(): Promise<void> {
  const decoder = new ZSTDDecoder();
  await decoder.init();

  if (!fs.existsSync(BENCH_DIR)) {
    fs.mkdirSync(BENCH_DIR, { recursive: true });
  }

  const rows: ResultRow[] = [];

  for (const { id: payloadId, data } of PAYLOADS) {
    const payloadBytes = data.length;
    for (const level of LEVELS) {
      const zstdifyCompressed = compress(data, { level });
      const nodeCompressed = nodeCompress(data, level);
      const zstdifyDecompressInput = zstdifyCompressed;
      const nodeDecompressInput = nodeCompressed;

      const bench = new Bench({
        time: 300,
        warmupIterations: 3,
        warmupTime: 50,
        iterations: 20,
      });

      bench.add('compress zstdify', () => {
        compress(data, { level });
      });
      bench.add('compress node', () => {
        nodeCompress(data, level);
      });
      bench.add('decompress zstdify', () => {
        decompress(zstdifyDecompressInput, { validateChecksum: false });
      });
      bench.add('decompress node', () => {
        zlib.zstdDecompressSync(nodeDecompressInput);
      });
      bench.add('decompress zstddec', () => {
        decoder.decode(zstdifyDecompressInput, payloadBytes);
      });

      // biome-ignore lint: sequential runs for stable, comparable timings
      await bench.run();

      const getMedianMs = (taskName: string): number => {
        const t = bench.tasks.find((x) => x.name === taskName);
        if (!t?.result || t.result.state !== 'completed') return 0;
        const lat = (t.result as { latency?: { p50: number; mean: number } })
          .latency;
        return lat?.p50 ?? lat?.mean ?? 0;
      };

      const compressZstdifyMs = getMedianMs('compress zstdify');
      const compressNodeMs = getMedianMs('compress node');
      const decompressZstdifyMs = getMedianMs('decompress zstdify');
      const decompressNodeMs = getMedianMs('decompress node');
      const decompressZstddecMs = getMedianMs('decompress zstddec');

      rows.push({
        payloadId,
        payloadBytes,
        level,
        compressZstdifyMs,
        compressNodeMs,
        decompressZstdifyMs,
        decompressNodeMs,
        decompressZstddecMs,
        ratioZstdify: payloadBytes > 0 ? zstdifyCompressed.length / payloadBytes : 0,
        ratioNode: payloadBytes > 0 ? nodeCompressed.length / payloadBytes : 0,
      });
    }
  }

  const summary = {
    version: 1,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    rows,
    throughput: rows.map((r) => ({
      payloadId: r.payloadId,
      payloadBytes: r.payloadBytes,
      level: r.level,
      compressZstdifyMbps: mbps(r.payloadBytes, r.compressZstdifyMs),
      compressNodeMbps: mbps(r.payloadBytes, r.compressNodeMs),
      decompressZstdifyMbps: mbps(r.payloadBytes, r.decompressZstdifyMs),
      decompressNodeMbps: mbps(r.payloadBytes, r.decompressNodeMs),
      decompressZstddecMbps: mbps(r.payloadBytes, r.decompressZstddecMs),
      ratioZstdify: r.ratioZstdify,
      ratioNode: r.ratioNode,
    })),
  };

  const jsonPath = path.join(BENCH_DIR, 'latest.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote ${jsonPath}`);

  const md = [
    '# zstdify vs Node built-in zstd vs zstddec',
    '',
    `Generated: ${summary.timestamp} | Node: ${summary.nodeVersion}`,
    '',
    '## Throughput (MB/s)',
    '',
    '| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress zstddec |',
    '|------------|-------|------------------|---------------|-------------------|-----------------|---------------------|',
    ...summary.throughput.map(
      (t) =>
        `| ${t.payloadId.padEnd(10)} | ${t.level} | ${t.compressZstdifyMbps.toFixed(2)} | ${t.compressNodeMbps.toFixed(2)} | ${t.decompressZstdifyMbps.toFixed(2)} | ${t.decompressNodeMbps.toFixed(2)} | ${t.decompressZstddecMbps.toFixed(2)} |`,
    ),
    '',
    '## Compression ratio (compressed/original)',
    '',
    '| Payload     | Level | zstdify | Node |',
    '|------------|-------|---------|------|',
    ...summary.throughput.map(
      (t) =>
        `| ${t.payloadId.padEnd(10)} | ${t.level} | ${t.ratioZstdify.toFixed(4)} | ${t.ratioNode.toFixed(4)} |`,
    ),
    '',
  ].join('\n');

  const mdPath = path.join(BENCH_DIR, 'latest.md');
  fs.writeFileSync(mdPath, md);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
