import type { Sequence } from '../decode/reconstruct.js';

export interface GreedyEncodeResult {
  literals: Uint8Array;
  sequences: Sequence[];
  trailingLiterals: number;
}

const WINDOW_SIZE = 128 * 1024;
const MIN_MATCH = 3;
const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;

function hash3(data: Uint8Array, pos: number): number {
  const a = data[pos] ?? 0;
  const b = data[pos + 1] ?? 0;
  const c = data[pos + 2] ?? 0;
  return ((a * 2654435761 + b * 2246822519 + c * 3266489917) >>> 0) >>> (32 - HASH_BITS);
}

function matchLength(data: Uint8Array, a: number, b: number): number {
  const max = data.length - a;
  let n = 0;
  while (n < max && (data[a + n] ?? 0) === (data[b + n] ?? 0)) {
    n++;
  }
  return n;
}

export function buildGreedySequences(input: Uint8Array): GreedyEncodeResult {
  if (input.length < MIN_MATCH) {
    return { literals: input.slice(), sequences: [], trailingLiterals: input.length };
  }

  const lastPos = new Int32Array(HASH_SIZE);
  lastPos.fill(-1);

  const sequences: Sequence[] = [];
  const literalSpans: Array<[number, number]> = [];
  let anchor = 0;
  let pos = 0;

  while (pos + MIN_MATCH <= input.length) {
    const h = hash3(input, pos);
    const candidate = lastPos[h] ?? -1;
    lastPos[h] = pos;

    if (candidate < 0) {
      pos++;
      continue;
    }
    const offset = pos - candidate;
    if (offset <= 0 || offset > WINDOW_SIZE) {
      pos++;
      continue;
    }
    if ((input[pos] ?? 0) !== (input[candidate] ?? 0)) {
      pos++;
      continue;
    }
    const len = matchLength(input, pos, candidate);
    if (len < MIN_MATCH) {
      pos++;
      continue;
    }

    const literalsLength = pos - anchor;
    literalSpans.push([anchor, pos]);
    sequences.push({
      literalsLength,
      // We currently emit non-repeat offsets only; repeated-offset coding can be layered later.
      offset: offset + 3,
      matchLength: len,
    });

    const matchEnd = pos + len;
    for (let p = pos + 1; p + MIN_MATCH <= matchEnd; p++) {
      const hp = hash3(input, p);
      lastPos[hp] = p;
    }
    pos = matchEnd;
    anchor = pos;
  }

  const trailingLiterals = input.length - anchor;
  const totalLiteralBytes = input.length - sequences.reduce((sum, s) => sum + s.matchLength, 0);
  const literals = new Uint8Array(totalLiteralBytes);
  let out = 0;
  for (const [start, end] of literalSpans) {
    const chunk = input.subarray(start, end);
    literals.set(chunk, out);
    out += chunk.length;
  }
  if (trailingLiterals > 0) {
    const tail = input.subarray(anchor);
    literals.set(tail, out);
  }

  return { literals, sequences, trailingLiterals };
}
