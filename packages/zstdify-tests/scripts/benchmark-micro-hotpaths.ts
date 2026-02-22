#!/usr/bin/env node
/**
 * Microbench harness for key encode/decode hot paths.
 */

import { Bench } from 'tinybench';
import { __benchInternals, buildCompressedBlockPayload } from '../../zstdify/dist/encode/compressedBlock.js';
import { buildGreedySequences } from '../../zstdify/dist/encode/greedySequences.js';
import { loadBenchCorpus } from './bench-corpus.ts';

function choosePayload(): Uint8Array {
  const corpus = loadBenchCorpus();
  const preferred = corpus.find((x) => x.category === 'text') ?? corpus[0];
  if (!preferred) throw new Error('No benchmark payload found. Run bench:fetch-data first.');
  const maxBytes = 128 * 1024;
  return preferred.data.length > maxBytes ? preferred.data.subarray(0, maxBytes) : preferred.data;
}

function createBitInputs(size: number): { bitCounts: Uint8Array; bitValues: Uint32Array } {
  const bitCounts = new Uint8Array(size);
  const bitValues = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    const width = (i % 13) + 1;
    bitCounts[i] = width;
    bitValues[i] = (1 << Math.min(width, 16)) - 1;
  }
  return { bitCounts, bitValues };
}

async function main(): Promise<void> {
  const payload = choosePayload();
  const history = payload.subarray(0, Math.min(64 * 1024, payload.length));
  const block = payload.subarray(Math.min(64 * 1024, payload.length));
  const planningInput = block.length >= 64 ? block : payload;
  const plan = buildGreedySequences(planningInput, { strategy: 'lazy', history });
  if (plan.sequences.length === 0) throw new Error('Unable to produce sequences for microbench payload.');

  const literalsForHuffman =
    plan.literals.length >= 32 ? plan.literals : payload.subarray(0, Math.min(payload.length, 512));
  const bitInputs = createBitInputs(4096);

  const bench = new Bench({
    time: 400,
    warmupIterations: 4,
    warmupTime: 100,
    iterations: 40,
  });

  bench.add('match finder (lazy strategy)', () => {
    buildGreedySequences(planningInput, { strategy: 'lazy', history });
  });
  bench.add('sequence entropy encode', () => {
    __benchInternals.buildPredefinedSequenceSection(plan.sequences);
  });
  bench.add('literals encode', () => {
    __benchInternals.buildGeneralCompressedLiterals(literalsForHuffman);
  });
  bench.add('reverse bit IO', () => {
    __benchInternals.encodeReverseBitstream(bitInputs.bitCounts, bitInputs.bitValues);
  });
  bench.add('full compressed payload build', () => {
    buildCompressedBlockPayload(plan.literals, plan.sequences);
  });

  await bench.run();
  console.log('Microbench results (median ms/op, lower is better):');
  for (const task of bench.tasks) {
    const latency = (task.result as { latency?: { p50: number; mean: number } } | undefined)?.latency;
    const median = latency?.p50 ?? latency?.mean ?? 0;
    console.log(`- ${task.name}: ${median.toFixed(4)} ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
