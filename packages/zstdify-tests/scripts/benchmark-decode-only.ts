#!/usr/bin/env node
/**
 * Decode-focused benchmark:
 * - zstdify decode of Node-compressed frames
 * - Node decode of Node-compressed frames
 * - zstddec decode of Node-compressed frames
 *
 * Writes packages/zstdify-tests/benchmarks/decode-only.latest.{json,md}.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { decompress as fzstdDecompress } from 'fzstd';
import { Bench } from 'tinybench';
import { ZSTDDecoder } from 'zstddec';
import { decompress } from 'zstdify';
import { loadBenchCorpus } from './bench-corpus.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');

const LEVELS = [6];

function nodeCompress(data: Uint8Array, level: number): Buffer {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: level,
  };
  return zlib.zstdCompressSync(Buffer.from(data), { params });
}

function mbps(bytes: number, ms: number): number {
  if (ms <= 0) return 0;
  return bytes / 1_000_000 / (ms / 1000);
}

interface Row {
  payloadId: string;
  payloadCategory: string;
  payloadBytes: number;
  level: number;
  decodeZstdifyFromNodeMs: number;
  decodeNodeFromNodeMs: number;
  decodeFzstdFromNodeMs: number;
  decodeZstddecFromNodeMs: number;
}

async function main(): Promise<void> {
  const decoder = new ZSTDDecoder();
  await decoder.init();
  const payloads = loadBenchCorpus();

  fs.mkdirSync(BENCH_DIR, { recursive: true });
  const rows: Row[] = [];

  for (const { id: payloadId, category: payloadCategory, data } of payloads) {
    const payloadBytes = data.length;
    for (const level of LEVELS) {
      const nodeCompressed = nodeCompress(data, level);

      const bench = new Bench({
        time: 500,
        warmupIterations: 4,
        warmupTime: 100,
        iterations: 30,
      });

      bench.add('decode zstdify <- node', () => {
        decompress(nodeCompressed, { validateChecksum: false });
      });
      bench.add('decode node <- node', () => {
        zlib.zstdDecompressSync(nodeCompressed);
      });
      bench.add('decode fzstd <- node', () => {
        fzstdDecompress(nodeCompressed);
      });
      bench.add('decode zstddec <- node', () => {
        decoder.decode(nodeCompressed, payloadBytes);
      });

      // biome-ignore lint: sequential runs for stable and comparable timings
      await bench.run();

      const getMedianMs = (taskName: string): number => {
        const t = bench.tasks.find((x) => x.name === taskName);
        if (!t?.result || t.result.state !== 'completed') return 0;
        const lat = (t.result as { latency?: { p50: number; mean: number } }).latency;
        return lat?.p50 ?? lat?.mean ?? 0;
      };

      rows.push({
        payloadId,
        payloadCategory,
        payloadBytes,
        level,
        decodeZstdifyFromNodeMs: getMedianMs('decode zstdify <- node'),
        decodeNodeFromNodeMs: getMedianMs('decode node <- node'),
        decodeFzstdFromNodeMs: getMedianMs('decode fzstd <- node'),
        decodeZstddecFromNodeMs: getMedianMs('decode zstddec <- node'),
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
      payloadCategory: r.payloadCategory,
      payloadBytes: r.payloadBytes,
      level: r.level,
      decodeZstdifyFromNodeMbps: mbps(r.payloadBytes, r.decodeZstdifyFromNodeMs),
      decodeNodeFromNodeMbps: mbps(r.payloadBytes, r.decodeNodeFromNodeMs),
      decodeFzstdFromNodeMbps: mbps(r.payloadBytes, r.decodeFzstdFromNodeMs),
      decodeZstddecFromNodeMbps: mbps(r.payloadBytes, r.decodeZstddecFromNodeMs),
    })),
  };

  const jsonPath = path.join(BENCH_DIR, 'decode-only.latest.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);

  const md = [
    '# Decode-only benchmark',
    '',
    `Generated: ${summary.timestamp} | Node: ${summary.nodeVersion}`,
    '',
    '## Throughput (MB/s)',
    '',
    '| Payload | Category | Level | zstdify <- node | node <- node | fzstd <- node | zstddec <- node |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...summary.throughput.map(
      (t) =>
        `| ${t.payloadId} | ${t.payloadCategory} | ${t.level} | ${t.decodeZstdifyFromNodeMbps.toFixed(2)} | ${t.decodeNodeFromNodeMbps.toFixed(2)} | ${t.decodeFzstdFromNodeMbps.toFixed(2)} | ${t.decodeZstddecFromNodeMbps.toFixed(2)} |`,
    ),
    '',
  ].join('\n');

  const mdPath = path.join(BENCH_DIR, 'decode-only.latest.md');
  fs.writeFileSync(mdPath, md);

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
