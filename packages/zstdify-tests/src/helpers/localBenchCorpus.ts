import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DATA_DIR = path.resolve(__dirname, '..', '..', 'bench-data');
const BENCH_DATA_INDEX_PATH = path.join(BENCH_DATA_DIR, 'index.json');
const DEFAULT_TEST_SAMPLE_BYTES = 1024 * 1024; // Keep tests bounded while still realistic.

interface BenchCorpusIndex {
  version: number;
  generatedAt: string;
  files: Array<{
    id: string;
    category: string;
    description?: string;
    localPath: string;
  }>;
}

export interface BenchCorpusPayload {
  id: string;
  category: string;
  description?: string;
  data: Uint8Array;
  sourceBytes: number;
}

export function loadLocalBenchCorpusForTests(
  maxSampleBytes = DEFAULT_TEST_SAMPLE_BYTES,
): BenchCorpusPayload[] {
  if (!fs.existsSync(BENCH_DATA_INDEX_PATH)) {
    throw new Error(
      `Missing local benchmark corpus index at ${BENCH_DATA_INDEX_PATH}. ` +
        'Run: pnpm --filter zstdify-tests run bench:fetch-data',
    );
  }

  const parsed = JSON.parse(fs.readFileSync(BENCH_DATA_INDEX_PATH, 'utf8')) as BenchCorpusIndex;
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(
      `Local benchmark corpus index has no files at ${BENCH_DATA_INDEX_PATH}. ` +
        'Run: pnpm --filter zstdify-tests run bench:fetch-data',
    );
  }

  const payloads: BenchCorpusPayload[] = [];
  for (const file of parsed.files) {
    const absolutePath = path.resolve(BENCH_DATA_DIR, file.localPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(
        `Missing local benchmark corpus file ${absolutePath}. ` +
          'Run: pnpm --filter zstdify-tests run bench:fetch-data',
      );
    }
    const bytes = fs.readFileSync(absolutePath);
    if (bytes.length === 0) {
      throw new Error(`Benchmark corpus file is empty: ${absolutePath}`);
    }
    const sample = bytes.length > maxSampleBytes ? bytes.subarray(0, maxSampleBytes) : bytes;
    payloads.push({
      id: file.id,
      category: file.category,
      description: file.description,
      data: new Uint8Array(sample),
      sourceBytes: bytes.length,
    });
  }

  return payloads;
}
