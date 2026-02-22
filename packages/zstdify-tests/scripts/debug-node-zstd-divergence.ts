#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatInteropDivergenceReport, runNodeInteropDivergenceDebug } from '../src/helpers/divergenceDebug.ts';
import { loadLocalBenchCorpusForTests } from '../src/helpers/localBenchCorpus.ts';

interface CliOptions {
  payloadId: string | null;
  payloadPath: string | null;
  passLevel: number;
  failLevel: number;
  sampleBytes: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PREFIX_RE = /^corpus-/;

function parseNumber(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    payloadId: 'linux-kernel-tar',
    payloadPath: null,
    passLevel: 3,
    failLevel: 5,
    sampleBytes: 1024 * 1024,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    const next = argv[i + 1];
    if (arg === '--payload-id' && next) {
      options.payloadId = next;
      i++;
      continue;
    }
    if (arg === '--payload-path' && next) {
      options.payloadPath = next;
      options.payloadId = null;
      i++;
      continue;
    }
    if (arg === '--pass-level' && next) {
      options.passLevel = parseNumber(next, '--pass-level');
      i++;
      continue;
    }
    if (arg === '--fail-level' && next) {
      options.failLevel = parseNumber(next, '--fail-level');
      i++;
      continue;
    }
    if (arg === '--sample-bytes' && next) {
      options.sampleBytes = parseNumber(next, '--sample-bytes');
      i++;
      continue;
    }
    if (arg === '--help') {
      console.log(`Usage:
  node scripts/debug-node-zstd-divergence.ts [options]

Options:
  --payload-id <id>        Corpus payload id (default: linux-kernel-tar)
  --payload-path <path>    Absolute or relative file path payload
  --pass-level <n>         Passing level (default: 3)
  --fail-level <n>         Failing level (default: 5)
  --sample-bytes <n>       Corpus sample size cap (default: 1048576)
`);
      process.exit(0);
    }
  }
  return options;
}

function resolvePayload(options: CliOptions): { id: string; data: Uint8Array } {
  if (options.payloadPath) {
    const absolutePath = path.isAbsolute(options.payloadPath)
      ? options.payloadPath
      : path.resolve(__dirname, '..', options.payloadPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Payload file not found: ${absolutePath}`);
    }
    const bytes = fs.readFileSync(absolutePath);
    return { id: path.basename(absolutePath), data: new Uint8Array(bytes) };
  }
  const corpus = loadLocalBenchCorpusForTests(options.sampleBytes);
  const payloadId = options.payloadId ?? 'linux-kernel-tar';
  const normalizedId = payloadId.replace(CORPUS_PREFIX_RE, '');
  const match = corpus.find((x) => x.id === normalizedId);
  if (!match) {
    throw new Error(`Payload id not found in local corpus: ${payloadId}`);
  }
  return { id: `corpus-${match.id}`, data: match.data };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const payload = resolvePayload(options);
  const report = await runNodeInteropDivergenceDebug({
    payloadId: payload.id,
    input: payload.data,
    passLevel: options.passLevel,
    failLevel: options.failLevel,
  });
  if (!report) {
    console.log(
      `[interop-debug] ${payload.id} level ${options.passLevel} -> ${options.failLevel}: no divergence between decoded outputs`,
    );
    return;
  }
  console.log(formatInteropDivergenceReport(report));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
