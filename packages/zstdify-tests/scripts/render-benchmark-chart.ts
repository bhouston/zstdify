#!/usr/bin/env node
/**
 * Reads benchmarks/latest.json and renders throughput and ratio charts.
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
const RATIO_VL_PATH = path.join(BENCH_DIR, 'benchmark-ratio.vl.json');
const RATIO_SVG_PATH = path.join(BENCH_DIR, 'latest-ratio.svg');

interface ThroughputRow {
  payloadId: string;
  payloadCategory?: string;
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

function renderVegaLiteChart(vlPath: string, svgPath: string): void {
  execSync(`pnpm exec vl2svg "${vlPath}" "${svgPath}"`, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  console.log(`Wrote ${svgPath}`);
}

function main(): void {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`Missing ${JSON_PATH}. Run bench:node-vs-zstdify first.`);
    process.exit(1);
  }

  const summary: Summary = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as Summary;

  // Reshape for grouped bar: one row per (payloadId, level, impl, mbps)
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
            // biome-ignore lint/security/noSecrets: chart legend label, not a secret
            legend: { title: 'Implementation' },
          },
        },
      },
      {
        // biome-ignore lint/security/noSecrets: chart title, not a secret
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
            // biome-ignore lint/security/noSecrets: chart legend label, not a secret
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

  // Side-by-side sizes: Original, Node zstd, zstdify. Order by corpus and level (throughput order); bar order fixed.
  const sizeRows: Array<{ label: string; type: string; sizeBytes: number; sizeMiB: number }> = [];
  for (const t of summary.throughput) {
    const label = `${t.payloadId} L${t.level}`;
    const originalBytes = t.payloadBytes;
    const nodeBytes = Math.round(t.payloadBytes * t.ratioNode);
    const zstdifyBytes = Math.round(t.payloadBytes * t.ratioZstdify);
    const toMiB = (b: number) => b / (1024 * 1024);
    sizeRows.push(
      { label, type: 'Original', sizeBytes: originalBytes, sizeMiB: toMiB(originalBytes) },
      { label, type: 'Node zstd', sizeBytes: nodeBytes, sizeMiB: toMiB(nodeBytes) },
      { label, type: 'zstdify', sizeBytes: zstdifyBytes, sizeMiB: toMiB(zstdifyBytes) },
    );
  }

  const ratioSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 760,
    height: { step: 18 },
    title: 'Size comparison: Original vs Node zstd vs zstdify',
    data: { values: sizeRows },
    mark: 'bar',
    encoding: {
      y: {
        field: 'label',
        type: 'ordinal',
        sort: null,
        title: 'Payload / Level',
      },
      x: {
        field: 'sizeMiB',
        type: 'quantitative',
        title: 'Size (MiB)',
      },
      yOffset: {
        field: 'type',
        sort: ['Original', 'Node zstd', 'zstdify'],
      },
      color: {
        field: 'type',
        type: 'nominal',
        sort: ['Original', 'Node zstd', 'zstdify'],
        scale: { range: ['#7f7f7f', '#1f77b4', '#ff7f0e'] },
        legend: { title: 'Size' },
      },
      tooltip: [
        { field: 'label', type: 'nominal', title: 'Payload / Level' },
        { field: 'type', type: 'nominal', title: 'Type' },
        { field: 'sizeBytes', type: 'quantitative', title: 'Size (bytes)', format: ',' },
        { field: 'sizeMiB', type: 'quantitative', title: 'Size (MiB)', format: '.3f' },
      ],
    },
    config: {
      axis: { labelLimit: 340 },
    },
  };
  fs.writeFileSync(RATIO_VL_PATH, `${JSON.stringify(ratioSpec, null, 2)}\n`);

  try {
    renderVegaLiteChart(VL_PATH, SVG_PATH);
    renderVegaLiteChart(RATIO_VL_PATH, RATIO_SVG_PATH);
  } catch (err) {
    console.error('vl2svg failed. Install vega and vega-lite in this package.');
    throw err;
  }
}

main();
