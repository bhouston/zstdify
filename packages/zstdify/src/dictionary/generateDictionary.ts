import { ZstdError } from '../errors.js';

export type DictionaryTrainingAlgorithm = 'fastcover' | 'cover' | 'legacy';

export interface GenerateDictionaryOptions {
  /**
   * Target maximum output size for dictionary bytes.
   * Similar to zstd CLI --maxdict.
   */
  maxDictSize?: number;
  /**
   * Included for API parity with zstd terminology.
   * Raw-content dictionaries don't embed an ID in bytes; pass this value
   * separately to compress/decompress options when needed.
   */
  dictId?: number;
  /**
   * Training mode selector inspired by zstd dictionary builders.
   * This implementation is deterministic and uses algorithm-specific scoring.
   */
  algorithm?: DictionaryTrainingAlgorithm;
  /**
   * Candidate segment size (bytes) used while harvesting patterns.
   */
  k?: number;
  /**
   * Distance step (bytes) between candidate probes.
   */
  d?: number;
  /**
   * Number of score-curve refinement passes.
   */
  steps?: number;
  /**
   * Percent of each sample used for candidate harvesting (1-100).
   */
  split?: number;
  /**
   * Additional fastcover-style score multiplier.
   */
  f?: number;
  /**
   * Probe stride accelerator (1-10).
   */
  accel?: number;
  /**
   * Legacy-style density control (1-10), where lower means denser.
   */
  selectivity?: number;
  /**
   * Optional shrink pass. If true, applies default shrink factor.
   * If number, interpreted as target shrink factor >= 1.
   */
  shrink?: boolean | number;
}

type CandidateScore = {
  key: string;
  bytes: Uint8Array;
  score: number;
  hits: number;
};

const DEFAULT_MAX_DICT_SIZE = 112_640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashBytes(bytes: Uint8Array): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeOptions(sampleCount: number, options?: GenerateDictionaryOptions) {
  const algorithm = options?.algorithm ?? 'fastcover';
  const maxDictSize = options?.maxDictSize ?? DEFAULT_MAX_DICT_SIZE;
  const kDefault = algorithm === 'cover' ? 64 : algorithm === 'legacy' ? 32 : 48;
  const dDefault = algorithm === 'cover' ? 8 : algorithm === 'legacy' ? 4 : 8;
  const stepsDefault = algorithm === 'cover' ? 6 : algorithm === 'legacy' ? 3 : 4;
  const splitDefault = algorithm === 'legacy' ? 100 : 75;
  const accelDefault = 1;
  const fDefault = 20;
  const selectivityDefault = 9;
  const shrinkDefault = false;

  if (!Number.isInteger(maxDictSize) || maxDictSize <= 0) {
    throw new ZstdError('maxDictSize must be a positive integer', 'parameter_unsupported');
  }
  if (options?.dictId !== undefined) {
    if (!Number.isInteger(options.dictId) || options.dictId <= 0 || options.dictId > 0xffff_ffff) {
      throw new ZstdError('dictId must be a 32-bit positive integer', 'parameter_unsupported');
    }
  }

  const k = clamp(Math.trunc(options?.k ?? kDefault), 8, 1024);
  const d = clamp(Math.trunc(options?.d ?? dDefault), 1, 64);
  const steps = clamp(Math.trunc(options?.steps ?? stepsDefault), 1, 1000);
  const split = clamp(Math.trunc(options?.split ?? splitDefault), 1, 100);
  const f = clamp(Math.trunc(options?.f ?? fDefault), 1, 1000);
  const accel = clamp(Math.trunc(options?.accel ?? accelDefault), 1, 10);
  const selectivity = clamp(Math.trunc(options?.selectivity ?? selectivityDefault), 1, 10);
  const shrink = options?.shrink ?? shrinkDefault;

  if (sampleCount === 0) {
    throw new ZstdError('Training requires at least one sample', 'parameter_unsupported');
  }

  return {
    algorithm,
    maxDictSize,
    k,
    d,
    steps,
    split,
    f,
    accel,
    selectivity,
    shrink,
  };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function preprocessSamples(samples: Uint8Array[], splitPercent: number): Uint8Array[] {
  const preprocessed: Uint8Array[] = [];
  for (const sample of samples) {
    if (!(sample instanceof Uint8Array)) {
      throw new ZstdError('All samples must be Uint8Array', 'parameter_unsupported');
    }
    if (sample.length === 0) continue;
    const usable = Math.max(1, Math.floor((sample.length * splitPercent) / 100));
    preprocessed.push(sample.subarray(0, usable));
  }
  if (preprocessed.length === 0) {
    throw new ZstdError('Training requires at least one non-empty sample', 'parameter_unsupported');
  }
  return preprocessed;
}

function scoreWeight(
  algorithm: DictionaryTrainingAlgorithm,
  bytes: Uint8Array,
  hits: number,
  step: number,
  f: number,
  selectivity: number,
): number {
  const entropyBias = 1 + (hashBytes(bytes) % 13) / 32;
  const length = bytes.length;
  if (algorithm === 'legacy') {
    const density = 11 - selectivity;
    return hits * (1 + density / 4) + length * 0.5 + entropyBias;
  }
  if (algorithm === 'cover') {
    return hits * (1 + step / 10) + length * 1.1 + entropyBias;
  }
  // fastcover
  return hits * (1 + f / 40) + length * 0.9 + entropyBias;
}

function harvestCandidates(
  samples: Uint8Array[],
  k: number,
  d: number,
  accel: number,
  algorithm: DictionaryTrainingAlgorithm,
  steps: number,
  f: number,
  selectivity: number,
): CandidateScore[] {
  const map = new Map<string, CandidateScore>();
  for (let step = 0; step < steps; step++) {
    const size = clamp(k + step * d, 8, 2048);
    const stride = Math.max(1, Math.floor((d * accel) / Math.max(1, step + 1)));
    for (const sample of samples) {
      if (sample.length < size) continue;
      for (let i = 0; i + size <= sample.length; i += stride) {
        const bytes = sample.subarray(i, i + size);
        const key = toHex(bytes);
        const existing = map.get(key);
        if (existing) {
          existing.hits += 1;
          existing.score = scoreWeight(algorithm, existing.bytes, existing.hits, step + 1, f, selectivity);
          continue;
        }
        const cloned = bytes.slice();
        map.set(key, {
          key,
          bytes: cloned,
          hits: 1,
          score: scoreWeight(algorithm, cloned, 1, step + 1, f, selectivity),
        });
      }
    }
  }
  return [...map.values()];
}

function maybeShrink(target: number, shrink: boolean | number): number {
  if (shrink === false) return target;
  if (shrink === true) return Math.max(256, Math.floor(target * 0.75));
  if (Number.isFinite(shrink) && shrink >= 1) {
    return Math.max(256, Math.floor(target / shrink));
  }
  throw new ZstdError('shrink must be boolean or number >= 1', 'parameter_unsupported');
}

function buildDictionaryBytes(candidates: CandidateScore[], maxDictSize: number): Uint8Array {
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.hits !== a.hits) return b.hits - a.hits;
    if (b.bytes.length !== a.bytes.length) return b.bytes.length - a.bytes.length;
    return a.key.localeCompare(b.key);
  });

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const candidate of sorted) {
    if (total >= maxDictSize) break;
    if (candidate.hits <= 1 && candidate.bytes.length < 24) continue;
    const remaining = maxDictSize - total;
    if (remaining < 8) break;
    const piece = candidate.bytes.length <= remaining ? candidate.bytes : candidate.bytes.subarray(0, remaining);
    if (piece.length < 8) break;
    chunks.push(piece.slice());
    total += piece.length;
  }

  if (chunks.length === 0) {
    // Fallback: ensure at least one deterministic dictionary segment exists.
    const fallback = new Uint8Array(Math.min(256, maxDictSize));
    for (let i = 0; i < fallback.length; i++) fallback[i] = i & 0xff;
    return fallback;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Generate a deterministic raw-content dictionary from training samples.
 *
 * The output is intentionally a raw-content dictionary byte sequence, which is
 * compatible with zstd's -D usage and zstdify dictionary decode paths.
 */
export function generateDictionary(samples: Uint8Array[], options?: GenerateDictionaryOptions): Uint8Array {
  const normalized = normalizeOptions(samples.length, options);
  const preprocessed = preprocessSamples(samples, normalized.split);
  const candidates = harvestCandidates(
    preprocessed,
    normalized.k,
    normalized.d,
    normalized.accel,
    normalized.algorithm,
    normalized.steps,
    normalized.f,
    normalized.selectivity,
  );
  const targetSize = maybeShrink(normalized.maxDictSize, normalized.shrink);
  return buildDictionaryBytes(candidates, targetSize);
}
