import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DATA_DIR = path.join(__dirname, '..', 'bench-data');
const BENCH_DATA_INDEX_PATH = path.join(BENCH_DATA_DIR, 'index.json');

export interface BenchCorpusFile {
  id: string;
  category: string;
  description?: string;
  localPath: string;
}

interface BenchCorpusIndex {
  version: number;
  generatedAt: string;
  files: BenchCorpusFile[];
}

export interface BenchPayload {
  id: string;
  category: string;
  description?: string;
  data: Uint8Array;
}

function missingCorpusError(): Error {
  return new Error(
    `Missing benchmark corpus index at ${BENCH_DATA_INDEX_PATH}. ` +
      'Run: pnpm --filter zstdify-tests run bench:fetch-data',
  );
}

export function loadBenchCorpus(): BenchPayload[] {
  if (!fs.existsSync(BENCH_DATA_INDEX_PATH)) {
    throw missingCorpusError();
  }

  const parsed = JSON.parse(fs.readFileSync(BENCH_DATA_INDEX_PATH, 'utf8')) as BenchCorpusIndex;
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(
      `Benchmark corpus index has no files: ${BENCH_DATA_INDEX_PATH}. ` +
        'Run: pnpm --filter zstdify-tests run bench:fetch-data',
    );
  }

  const payloads: BenchPayload[] = [];
  for (const file of parsed.files) {
    const absolutePath = path.resolve(BENCH_DATA_DIR, file.localPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(
        `Benchmark corpus file is missing: ${absolutePath}. ` +
          'Run: pnpm --filter zstdify-tests run bench:fetch-data',
      );
    }
    const bytes = fs.readFileSync(absolutePath);
    if (bytes.length === 0) {
      throw new Error(`Benchmark corpus file is empty: ${absolutePath}`);
    }
    payloads.push({
      id: file.id,
      category: file.category,
      description: file.description,
      data: new Uint8Array(bytes),
    });
  }
  return payloads;
}

export function selectProfilePayload(corpus: BenchPayload[]): BenchPayload {
  const requestedId = process.env.BENCH_PROFILE_DATASET;
  if (requestedId) {
    const requested = corpus.find((x) => x.id === requestedId);
    if (!requested) {
      throw new Error(
        `BENCH_PROFILE_DATASET=${requestedId} not found in local corpus. ` +
          'Run bench:fetch-data and check bench-data/index.json.',
      );
    }
    return requested;
  }

  const preferredText = corpus.find((x) => x.category === 'text');
  if (preferredText) {
    return preferredText;
  }
  if (corpus.length === 0) {
    throw new Error('Local benchmark corpus is empty.');
  }
  return corpus[0];
}
