#!/usr/bin/env node
/**
 * Reads benchmarks/latest.json and renders throughput bar charts to benchmarks/latest.svg.
 * Run: pnpm --filter zstdify-tests run bench:render
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');
const JSON_PATH = path.join(BENCH_DIR, 'latest.json');
const VL_PATH = path.join(BENCH_DIR, 'benchmark.vl.json');
const SVG_PATH = path.join(BENCH_DIR, 'latest.svg');

interface ThroughputRow {
  payloadId: string;
  payloadBytes: number;
  level: number;
  compressZstdifyMbps: number;
  compressNodeMbps: number;
  decompressZstdifyMbps: number;
  decompressNodeMbps: number;
  decompressZstddecMbps?: number;
  ratioZstdify: number;
  ratioNode: number;
}

interface Summary {
  version: number;
  nodeVersion: string;
  timestamp: string;
  throughput: ThroughputRow[];
}

function main(): void {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`Missing ${JSON_PATH}. Run bench:node-vs-zstdify first.`);
    process.exit(1);
  }

  const summary: Summary = JSON.parse(
    fs.readFileSync(JSON_PATH, 'utf8'),
  ) as Summary;

  // Reshape for grouped bar: one row per (payloadId, level, impl, op, mbps)
  const compressRows: Array<{
    label: string;
    impl: string;
    mbps: number;
  }> = [];
  const decompressRows: Array<{
    label: string;
    impl: string;
    mbps: number;
  }> = [];

  for (const t of summary.throughput) {
    const label = `${t.payloadId} L${t.level}`;
    compressRows.push(
      { label, impl: 'zstdify', mbps: t.compressZstdifyMbps },
      { label, impl: 'Node', mbps: t.compressNodeMbps },
    );
    decompressRows.push(
      { label, impl: 'zstdify', mbps: t.decompressZstdifyMbps },
      { label, impl: 'Node', mbps: t.decompressNodeMbps },
    );
    if (t.decompressZstddecMbps !== undefined) {
      decompressRows.push({ label, impl: 'zstddec', mbps: t.decompressZstddecMbps });
    }
  }

  // Side-by-side grouped bars: xOffset places bars next to each other per category.
  // Single scale range (zstdify, Node, zstddec) so vconcat does not merge conflicting scales.
  const implColors = ['#1f77b4', '#ff7f0e', '#2ca02c'] as const; // blue, orange, green
  const vlSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    vconcat: [
      {
        title: 'Compression throughput (MB/s)',
        data: { values: compressRows },
        mark: 'bar',
        encoding: {
          x: { field: 'label', type: 'ordinal', title: 'Payload / Level' },
          y: { field: 'mbps', type: 'quantitative', title: 'MB/s' },
          xOffset: { field: 'impl' },
          color: {
            field: 'impl',
            type: 'nominal',
            scale: { range: [...implColors] },
            legend: { title: 'Implementation' },
          },
        },
      },
      {
        title: 'Decompression throughput (MB/s)',
        data: { values: decompressRows },
        mark: 'bar',
        encoding: {
          x: { field: 'label', type: 'ordinal', title: 'Payload / Level' },
          y: { field: 'mbps', type: 'quantitative', title: 'MB/s' },
          xOffset: { field: 'impl' },
          color: {
            field: 'impl',
            type: 'nominal',
            scale: { range: [...implColors] },
            legend: { title: 'Implementation' },
          },
        },
      },
    ],
    config: { view: { continuousWidth: 520, continuousHeight: 220 } },
  };

  if (!fs.existsSync(BENCH_DIR)) {
    fs.mkdirSync(BENCH_DIR, { recursive: true });
  }
  fs.writeFileSync(VL_PATH, `${JSON.stringify(vlSpec, null, 2)}\n`);

  try {
    execSync(`pnpm exec vl2svg "${VL_PATH}" "${SVG_PATH}"`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
    console.log(`Wrote ${SVG_PATH}`);
  } catch (err) {
    console.error('vl2svg failed. Install vega and vega-lite in this package.');
    throw err;
  }
}

main();
