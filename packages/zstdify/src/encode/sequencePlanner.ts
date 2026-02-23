import type { Sequence } from '../decode/reconstruct.js';

const WINDOW_SIZE = 128 * 1024;
const MAX_BLOCK_SIZE = 128 * 1024;
const MIN_MATCH = 3;
const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;

/** Max combined length (history + block) for buffer pre-allocation. */
const MAX_COMBINED = WINDOW_SIZE + MAX_BLOCK_SIZE;

export interface GreedyEncodeResult {
  literals: Uint8Array;
  sequences: Sequence[];
  trailingLiterals: number;
  finalRepOffsets: [number, number, number];
}

export interface SequencePlannerOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
  plannerState?: SequencePlannerState;
  chainLimit: number;
  repScoreBonus?: [number, number, number];
  lazyDepth?: number;
  searchWindow?: number;
}

export interface SequencePlannerState {
  historyBytes: Uint8Array;
  historyChainPrev: Int32Array;
  historyHeads: Int32Array;
  /** Reusable buffers to reduce allocations in hot path (internal). */
  _combinedBuffer?: Uint8Array;
  _literalsBuffer?: Uint8Array;
  _chainPrevBuffer?: Int32Array;
  _headsBuffer?: Int32Array;
  _historyBytesBuffer?: Uint8Array;
  _historyChainPrevBuffer?: Int32Array;
}

export function createSequencePlannerState(): SequencePlannerState {
  const historyHeads = new Int32Array(HASH_SIZE);
  historyHeads.fill(-1);
  return {
    historyBytes: new Uint8Array(0),
    historyChainPrev: new Int32Array(0),
    historyHeads,
    _combinedBuffer: new Uint8Array(MAX_COMBINED),
    _literalsBuffer: new Uint8Array(MAX_BLOCK_SIZE),
    _chainPrevBuffer: new Int32Array(MAX_COMBINED),
    _headsBuffer: new Int32Array(HASH_SIZE),
    _historyBytesBuffer: new Uint8Array(WINDOW_SIZE),
    _historyChainPrevBuffer: new Int32Array(WINDOW_SIZE),
  };
}

interface MatchCandidate {
  pos: number;
  offset: number;
  length: number;
  score: number;
}

interface ParseState {
  input: Uint8Array;
  chainPrev: Int32Array;
  repOffsets: [number, number, number];
  options: Required<Pick<SequencePlannerOptions, 'chainLimit' | 'repScoreBonus' | 'lazyDepth' | 'searchWindow'>>;
}

function hash3(data: Uint8Array, pos: number): number {
  const a = data[pos]!;
  const b = data[pos + 1]!;
  const c = data[pos + 2]!;
  return ((a * 2654435761 + b * 2246822519 + c * 3266489917) >>> 0) >>> (32 - HASH_BITS);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  const len = a.length;
  if (len !== b.length) return false;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildChainPrev(data: Uint8Array, historyLength: number, plannerState?: SequencePlannerState): Int32Array {
  const dataLen = data.length;
  const reuseHeads = plannerState?._headsBuffer;
  const reuseChain = plannerState?._chainPrevBuffer;
  const heads = reuseHeads && reuseHeads.length >= HASH_SIZE ? reuseHeads : new Int32Array(HASH_SIZE);
  heads.fill(-1);
  const chainPrev =
    reuseChain && reuseChain.length >= dataLen ? reuseChain.subarray(0, dataLen) : new Int32Array(dataLen);
  chainPrev.fill(-1);
  let startPos = 0;
  if (
    plannerState &&
    historyLength > 0 &&
    plannerState.historyBytes.length === historyLength &&
    plannerState.historyChainPrev.length === historyLength &&
    bytesEqual(data.subarray(0, historyLength), plannerState.historyBytes)
  ) {
    chainPrev.set(plannerState.historyChainPrev, 0);
    heads.set(plannerState.historyHeads);
    startPos = historyLength;
  }
  for (let pos = startPos; pos + MIN_MATCH <= dataLen; pos++) {
    const h = hash3(data, pos);
    const prev = heads[h]!;
    chainPrev[pos] = prev;
    heads[h] = pos;
  }
  return chainPrev.length === dataLen ? chainPrev : chainPrev.subarray(0, dataLen);
}

function updatePlannerState(
  plannerState: SequencePlannerState | undefined,
  combined: Uint8Array,
  chainPrev: Int32Array,
): void {
  if (!plannerState) return;
  const historyStart = Math.max(0, combined.length - WINDOW_SIZE);
  const historyLength = combined.length - historyStart;
  const hbb = plannerState._historyBytesBuffer;
  const hcb = plannerState._historyChainPrevBuffer;
  const historyBytes =
    hbb && hbb.length >= historyLength ? hbb.subarray(0, historyLength) : new Uint8Array(historyLength);
  historyBytes.set(combined.subarray(historyStart), 0);
  const historyChainPrev =
    hcb && hcb.length >= historyLength ? hcb.subarray(0, historyLength) : new Int32Array(historyLength);
  for (let pos = 0; pos < historyLength; pos++) {
    const globalPos = historyStart + pos;
    const prev = chainPrev[globalPos] ?? -1;
    historyChainPrev[pos] = prev >= historyStart ? prev - historyStart : -1;
  }
  const historyHeads = plannerState.historyHeads;
  historyHeads.fill(-1);
  for (let pos = 0; pos + MIN_MATCH <= historyLength; pos++) {
    const h = hash3(historyBytes, pos);
    historyHeads[h] = pos;
  }
  plannerState.historyBytes = historyBytes;
  plannerState.historyChainPrev = historyChainPrev;
}

function longestMatch(data: Uint8Array, pos: number, candidate: number, maxLength: number): number {
  let len = 0;
  while (len + 8 <= maxLength) {
    if (
      data[pos + len] !== data[candidate + len] ||
      data[pos + len + 1] !== data[candidate + len + 1] ||
      data[pos + len + 2] !== data[candidate + len + 2] ||
      data[pos + len + 3] !== data[candidate + len + 3] ||
      data[pos + len + 4] !== data[candidate + len + 4] ||
      data[pos + len + 5] !== data[candidate + len + 5] ||
      data[pos + len + 6] !== data[candidate + len + 6] ||
      data[pos + len + 7] !== data[candidate + len + 7]
    ) {
      break;
    }
    len += 8;
  }
  while (len < maxLength && data[pos + len] === data[candidate + len]) {
    len++;
  }
  return len;
}

function scoreMatch(
  length: number,
  offset: number,
  repOffsets: [number, number, number],
  repScoreBonus: [number, number, number],
): number {
  let score = length * 16;
  if (offset === repOffsets[0]) score += repScoreBonus[0];
  else if (offset === repOffsets[1]) score += repScoreBonus[1];
  else if (offset === repOffsets[2]) score += repScoreBonus[2];
  return score;
}

function findBestMatchAt(parse: ParseState, pos: number, repOffsets: [number, number, number]): MatchCandidate | null {
  const data = parse.input;
  if (pos + MIN_MATCH > data.length) return null;
  let candidate = parse.chainPrev[pos] ?? -1;
  if (candidate < 0) return null;
  const minCandidate = Math.max(0, pos - WINDOW_SIZE);
  const maxLength = data.length - pos;
  let depth = 0;
  let best: MatchCandidate | null = null;
  while (candidate >= minCandidate && depth < parse.options.chainLimit) {
    const offset = pos - candidate;
    if (
      offset > 0 &&
      data[pos] === data[candidate] &&
      data[pos + 1] === data[candidate + 1] &&
      data[pos + 2] === data[candidate + 2]
    ) {
      const length = longestMatch(data, pos, candidate, maxLength);
      if (length >= MIN_MATCH) {
        const score = scoreMatch(length, offset, repOffsets, parse.options.repScoreBonus);
        if (!best || score > best.score || (score === best.score && length > best.length)) {
          best = { pos, offset, length, score };
          if (length >= maxLength) break;
        }
      }
    }
    candidate = parse.chainPrev[candidate] ?? -1;
    depth++;
  }
  return best;
}

/** Mutates repOffsets in place to avoid allocations in the match loop. */
function applyRepOffsetUpdate(
  repOffsets: [number, number, number],
  offsetValue: number,
  literalsLength: number,
): void {
  const ll0 = literalsLength === 0;
  const isNonRepeat = offsetValue > 3 || (offsetValue === 3 && ll0);
  if (isNonRepeat) {
    const actualOffset = offsetValue === 3 ? repOffsets[0] - 1 : offsetValue - 3;
    repOffsets[2] = repOffsets[1];
    repOffsets[1] = repOffsets[0];
    repOffsets[0] = actualOffset;
    return;
  }
  let repeatIndex: 0 | 1 | 2;
  if (ll0) repeatIndex = offsetValue === 1 ? 1 : 2;
  else repeatIndex = (offsetValue - 1) as 0 | 1 | 2;
  if (repeatIndex === 1) {
    const r1 = repOffsets[1];
    repOffsets[1] = repOffsets[0];
    repOffsets[0] = r1;
  } else if (repeatIndex === 2) {
    const r2 = repOffsets[2];
    repOffsets[2] = repOffsets[1];
    repOffsets[1] = repOffsets[0];
    repOffsets[0] = r2;
  }
}

/** Returns offsetValue and updates repOffsets in place. */
function toOffsetValue(
  offset: number,
  literalsLength: number,
  repOffsets: [number, number, number],
): number {
  const offsetValue = (offset + 3) | 0;
  applyRepOffsetUpdate(repOffsets, offsetValue, literalsLength);
  return offsetValue;
}

function copyLiterals(dst: Uint8Array, dstOffset: number, data: Uint8Array, srcStart: number, srcEnd: number): number {
  if (srcEnd <= srcStart) return dstOffset;
  dst.set(data.subarray(srcStart, srcEnd), dstOffset);
  return dstOffset + (srcEnd - srcStart);
}

/** Single reusable candidate to avoid object allocation in pickMatch hot path. */
const pickMatchScratch: MatchCandidate = { pos: 0, offset: 0, length: 0, score: 0 };

function pickMatch(parse: ParseState, pos: number): MatchCandidate | null {
  const direct = findBestMatchAt(parse, pos, parse.repOffsets);
  if (parse.options.searchWindow <= 1) return direct;
  let best = direct;
  let bestScore = best?.score ?? 0;
  const end = Math.min(parse.input.length - MIN_MATCH, pos + parse.options.searchWindow - 1);
  const repBonus = parse.options.repScoreBonus;
  const maxRepBonus = repBonus[0]! >= repBonus[1]! && repBonus[0]! >= repBonus[2]!
    ? repBonus[0]!
    : repBonus[1]! >= repBonus[2]!
      ? repBonus[1]!
      : repBonus[2]!;
  for (let probePos = pos + 1; probePos <= end; probePos++) {
    const delayed = probePos - pos;
    const maxProbeLength = parse.input.length - probePos;
    const theoreticalBestDelayedScore = maxProbeLength * 16 + maxRepBonus - delayed * 8;
    if (theoreticalBestDelayedScore <= bestScore) {
      break;
    }
    const probeCandidate = parse.chainPrev[probePos] ?? -1;
    if (probeCandidate < 0 || probeCandidate < Math.max(0, probePos - WINDOW_SIZE)) continue;
    const probe = findBestMatchAt(parse, probePos, parse.repOffsets);
    if (!probe) continue;
    const delayedScore = probe.score - delayed * 8;
    if (!best || delayedScore > bestScore) {
      pickMatchScratch.pos = probe.pos;
      pickMatchScratch.offset = probe.offset;
      pickMatchScratch.length = probe.length;
      pickMatchScratch.score = delayedScore;
      best = pickMatchScratch;
      bestScore = delayedScore;
    }
  }
  if (best === pickMatchScratch) {
    return { pos: best.pos, offset: best.offset, length: best.length, score: best.score };
  }
  return best;
}

/** Reusable candidate for lazy-depth loop to avoid object spread allocation. */
const lazyMatchScratch: MatchCandidate = { pos: 0, offset: 0, length: 0, score: 0 };

export function planSequences(input: Uint8Array, options: SequencePlannerOptions): GreedyEncodeResult {
  if (input.length < MIN_MATCH) {
    return {
      literals: input.length > 0 ? input.subarray(0, input.length) : input,
      sequences: [],
      trailingLiterals: input.length,
      finalRepOffsets: options.repOffsets ?? [1, 4, 8],
    };
  }

  const history =
    options.history && options.history.length > 0
      ? options.history.subarray(Math.max(0, options.history.length - WINDOW_SIZE))
      : new Uint8Array(0);
  const historyLength = history.length;
  const combinedLen = historyLength + input.length;
  const combinedBuf = options.plannerState?._combinedBuffer;
  const combined =
    combinedBuf && combinedBuf.length >= combinedLen ? combinedBuf.subarray(0, combinedLen) : new Uint8Array(combinedLen);
  if (historyLength > 0) combined.set(history, 0);
  combined.set(input, historyLength);

  const parse: ParseState = {
    input: combined,
    chainPrev: buildChainPrev(combined, historyLength, options.plannerState),
    repOffsets: options.repOffsets ?? [1, 4, 8],
    options: {
      chainLimit: Math.max(1, options.chainLimit),
      repScoreBonus: options.repScoreBonus ?? [48, 24, 12],
      lazyDepth: Math.max(0, options.lazyDepth ?? 0),
      searchWindow: Math.max(1, options.searchWindow ?? 1),
    },
  };

  const sequences: Sequence[] = [];
  const literalsBuf = options.plannerState?._literalsBuffer;
  const literals =
    literalsBuf && literalsBuf.length >= input.length
      ? literalsBuf.subarray(0, input.length)
      : new Uint8Array(input.length);
  let literalOut = 0;
  let anchor = historyLength;
  let pos = historyLength;

  while (pos + MIN_MATCH <= combined.length) {
    let best = pickMatch(parse, pos);
    if (best && parse.options.lazyDepth > 0 && best.pos === pos) {
      const maxDelta = Math.min(parse.options.lazyDepth, combined.length - pos - MIN_MATCH);
      for (let delta = 1; delta <= maxDelta; delta++) {
        const candidate = findBestMatchAt(parse, pos + delta, parse.repOffsets);
        if (!candidate) continue;
        if (candidate.score > best.score + delta * 8) {
          lazyMatchScratch.pos = candidate.pos;
          lazyMatchScratch.offset = candidate.offset;
          lazyMatchScratch.length = candidate.length;
          lazyMatchScratch.score = candidate.score;
          best = lazyMatchScratch;
        }
      }
    }
    if (!best || best.length < MIN_MATCH) {
      pos++;
      continue;
    }
    if (best === pickMatchScratch || best === lazyMatchScratch) {
      best = { pos: best.pos, offset: best.offset, length: best.length, score: best.score };
    }

    const matchPos = best.pos;
    const literalsLength = matchPos - anchor;
    literalOut = copyLiterals(literals, literalOut, combined, anchor, matchPos);
    const offsetValue = toOffsetValue(best.offset, literalsLength, parse.repOffsets);
    sequences.push({
      literalsLength,
      offset: offsetValue,
      matchLength: best.length,
    });

    anchor = matchPos + best.length;
    pos = anchor;
  }

  const trailingLiterals = combined.length - anchor;
  literalOut = copyLiterals(literals, literalOut, combined, anchor, combined.length);
  updatePlannerState(options.plannerState, combined, parse.chainPrev);
  const literalsOut =
    literalOut < literals.length ? literals.subarray(0, literalOut) : literals;
  return {
    literals: literalsOut,
    sequences,
    trailingLiterals,
    finalRepOffsets: parse.repOffsets,
  };
}
