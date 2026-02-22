#!/usr/bin/env node
/**
 * Decode benchmark guardrails:
 * - ensure zstdify decode remains a reasonable fraction of fzstd on the same run
 * - ensure node-compressed decode doesn't regress far below zstdify-compressed decode
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');
const DECODE_ONLY_JSON = path.join(BENCH_DIR, 'decode-only.latest.json');

const MIN_RATIO_VS_FZSTD_PER_PAYLOAD = 0.25;
const MIN_RATIO_VS_FZSTD_AVG = 0.32;
const MIN_NODE_PARITY_PER_PAYLOAD = 0.85;

type ThroughputRow = {
  payloadId: string;
  decodeZstdifyFromZstdifyMbps: number;
  decodeZstdifyFromNodeMbps: number;
  decodeFzstdFromNodeMbps: number;
};

type DecodeOnlySummary = {
  throughput: ThroughputRow[];
};

function fail(message: string): never {
  console.error(`Decode benchmark assertion failed: ${message}`);
  process.exit(1);
}

function main(): void {
  if (!fs.existsSync(DECODE_ONLY_JSON)) {
    fail(`Missing benchmark file: ${DECODE_ONLY_JSON}. Run bench:decode-only first.`);
  }

  const parsed = JSON.parse(fs.readFileSync(DECODE_ONLY_JSON, 'utf8')) as DecodeOnlySummary;
  const rows = parsed.throughput ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    fail('decode-only.latest.json has no throughput rows.');
  }

  let ratioSum = 0;
  for (const row of rows) {
    const zstdifyNode = Number(row.decodeZstdifyFromNodeMbps);
    const fzstdNode = Number(row.decodeFzstdFromNodeMbps);
    const zstdifySelf = Number(row.decodeZstdifyFromZstdifyMbps);
    if (!(zstdifyNode > 0) || !(fzstdNode > 0) || !(zstdifySelf > 0)) {
      fail(`Non-positive throughput value for payload ${row.payloadId}.`);
    }

    const ratioVsFzstd = zstdifyNode / fzstdNode;
    const nodeParity = zstdifyNode / zstdifySelf;
    ratioSum += ratioVsFzstd;

    if (ratioVsFzstd < MIN_RATIO_VS_FZSTD_PER_PAYLOAD) {
      fail(
        `${row.payloadId} ratio zstdify(node)/fzstd(node)=${ratioVsFzstd.toFixed(3)} is below ${MIN_RATIO_VS_FZSTD_PER_PAYLOAD.toFixed(3)}.`,
      );
    }
    if (nodeParity < MIN_NODE_PARITY_PER_PAYLOAD) {
      fail(
        `${row.payloadId} parity zstdify(node)/zstdify(zstdify)=${nodeParity.toFixed(3)} is below ${MIN_NODE_PARITY_PER_PAYLOAD.toFixed(3)}.`,
      );
    }
  }

  const avgRatio = ratioSum / rows.length;
  if (avgRatio < MIN_RATIO_VS_FZSTD_AVG) {
    fail(
      `Average ratio zstdify(node)/fzstd(node)=${avgRatio.toFixed(3)} is below ${MIN_RATIO_VS_FZSTD_AVG.toFixed(3)}.`,
    );
  }

  console.log(
    `Decode benchmark assertions passed: avg zstdify(node)/fzstd(node)=${avgRatio.toFixed(3)} across ${rows.length} payloads.`,
  );
}

main();
