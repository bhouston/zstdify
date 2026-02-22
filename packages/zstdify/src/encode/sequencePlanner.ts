import type { Sequence } from '../decode/reconstruct.js';

const WINDOW_SIZE = 128 * 1024;
const MIN_MATCH = 3;
const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;

export interface GreedyEncodeResult {
  literals: Uint8Array;
  sequences: Sequence[];
  trailingLiterals: number;
  finalRepOffsets: [number, number, number];
}

export interface SequencePlannerOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
  chainLimit: number;
  repScoreBonus?: [number, number, number];
  lazyDepth?: number;
  searchWindow?: number;
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

function buildChainPrev(data: Uint8Array): Int32Array {
  const heads = new Int32Array(HASH_SIZE);
  heads.fill(-1);
  const chainPrev = new Int32Array(data.length);
  chainPrev.fill(-1);
  for (let pos = 0; pos + MIN_MATCH <= data.length; pos++) {
    const h = hash3(data, pos);
    const prev = heads[h]!;
    chainPrev[pos] = prev;
    heads[h] = pos;
  }
  return chainPrev;
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
        }
      }
    }
    candidate = parse.chainPrev[candidate] ?? -1;
    depth++;
  }
  return best;
}

function applyRepOffsetUpdate(
  repOffsets: [number, number, number],
  offsetValue: number,
  literalsLength: number,
): [number, number, number] {
  const next: [number, number, number] = [repOffsets[0], repOffsets[1], repOffsets[2]];
  const ll0 = literalsLength === 0;
  const isNonRepeat = offsetValue > 3 || (offsetValue === 3 && ll0);
  if (isNonRepeat) {
    const actualOffset = offsetValue === 3 ? next[0] - 1 : offsetValue - 3;
    next[2] = next[1];
    next[1] = next[0];
    next[0] = actualOffset;
    return next;
  }
  let repeatIndex: 0 | 1 | 2;
  if (ll0) repeatIndex = offsetValue === 1 ? 1 : 2;
  else repeatIndex = (offsetValue - 1) as 0 | 1 | 2;
  if (repeatIndex === 1) {
    next[1] = next[0];
    next[0] = repOffsets[1];
  } else if (repeatIndex === 2) {
    next[2] = next[1];
    next[1] = next[0];
    next[0] = repOffsets[2];
  }
  return next;
}

function toOffsetValue(
  offset: number,
  literalsLength: number,
  repOffsets: [number, number, number],
): { offsetValue: number; nextRepOffsets: [number, number, number] } {
  // Keep conservative non-repeat offset encoding for interoperability.
  // Repeat-offset modeling is still used for scoring/search decisions.
  const offsetValue = offset + 3;
  return {
    offsetValue,
    nextRepOffsets: applyRepOffsetUpdate(repOffsets, offsetValue, literalsLength),
  };
}

function copyLiterals(dst: Uint8Array, dstOffset: number, data: Uint8Array, srcStart: number, srcEnd: number): number {
  if (srcEnd <= srcStart) return dstOffset;
  dst.set(data.subarray(srcStart, srcEnd), dstOffset);
  return dstOffset + (srcEnd - srcStart);
}

function pickMatch(parse: ParseState, pos: number): MatchCandidate | null {
  const direct = findBestMatchAt(parse, pos, parse.repOffsets);
  if (parse.options.searchWindow <= 1) return direct;
  let best = direct;
  const end = Math.min(parse.input.length - MIN_MATCH, pos + parse.options.searchWindow - 1);
  for (let probePos = pos + 1; probePos <= end; probePos++) {
    const probe = findBestMatchAt(parse, probePos, parse.repOffsets);
    if (!probe) continue;
    const delayedScore = probe.score - (probePos - pos) * 8;
    const currentScore = best ? best.score : 0;
    if (!best || delayedScore > currentScore) {
      best = { ...probe, score: delayedScore };
    }
  }
  return best;
}

export function planSequences(input: Uint8Array, options: SequencePlannerOptions): GreedyEncodeResult {
  if (input.length < MIN_MATCH) {
    return {
      literals: input.slice(),
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
  const combined = new Uint8Array(historyLength + input.length);
  if (historyLength > 0) combined.set(history, 0);
  combined.set(input, historyLength);

  const parse: ParseState = {
    input: combined,
    chainPrev: buildChainPrev(combined),
    repOffsets: options.repOffsets ? [options.repOffsets[0], options.repOffsets[1], options.repOffsets[2]] : [1, 4, 8],
    options: {
      chainLimit: Math.max(1, options.chainLimit),
      repScoreBonus: options.repScoreBonus ?? [48, 24, 12],
      lazyDepth: Math.max(0, options.lazyDepth ?? 0),
      searchWindow: Math.max(1, options.searchWindow ?? 1),
    },
  };

  const sequences: Sequence[] = [];
  const literals = new Uint8Array(input.length);
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
        if (candidate.score > best.score + delta * 8) best = { ...candidate };
      }
    }
    if (!best || best.length < MIN_MATCH) {
      pos++;
      continue;
    }

    const matchPos = best.pos;
    const literalsLength = matchPos - anchor;
    literalOut = copyLiterals(literals, literalOut, combined, anchor, matchPos);
    const { offsetValue, nextRepOffsets } = toOffsetValue(best.offset, literalsLength, parse.repOffsets);
    sequences.push({
      literalsLength,
      offset: offsetValue,
      matchLength: best.length,
    });
    parse.repOffsets = nextRepOffsets;

    anchor = matchPos + best.length;
    pos = anchor;
  }

  const trailingLiterals = combined.length - anchor;
  literalOut = copyLiterals(literals, literalOut, combined, anchor, combined.length);
  return {
    literals: literalOut < literals.length ? literals.subarray(0, literalOut) : literals,
    sequences,
    trailingLiterals,
    finalRepOffsets: [parse.repOffsets[0], parse.repOffsets[1], parse.repOffsets[2]],
  };
}
