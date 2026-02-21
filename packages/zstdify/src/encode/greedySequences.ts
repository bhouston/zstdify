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

// Reused hash table: generation counter avoids clearing 64k slots every call.
let lastPosBuf: Int32Array | null = null;
let lastGenBuf: Uint32Array | null = null;
let hashGen = 0;

function hash3(data: Uint8Array, pos: number): number {
  const a = data[pos]!;
  const b = data[pos + 1]!;
  const c = data[pos + 2]!;
  return ((a * 2654435761 + b * 2246822519 + c * 3266489917) >>> 0) >>> (32 - HASH_BITS);
}

export function buildGreedySequences(input: Uint8Array): GreedyEncodeResult {
  const inputLen = input.length;
  if (inputLen < MIN_MATCH) {
    return { literals: input.slice(), sequences: [], trailingLiterals: input.length };
  }

  if (!lastPosBuf || lastPosBuf.length !== HASH_SIZE) {
    lastPosBuf = new Int32Array(HASH_SIZE);
    lastGenBuf = new Uint32Array(HASH_SIZE);
  }
  const lastPos = lastPosBuf;
  const lastGen = lastGenBuf!;
  hashGen += 1;
  const curGen = hashGen;

  const sequences: Sequence[] = new Array(Math.max(16, inputLen >>> 4));
  let sequenceCount = 0;
  const literals = new Uint8Array(inputLen);
  let literalOut = 0;
  let anchor = 0;
  let pos = 0;

  while (pos + MIN_MATCH <= inputLen) {
    const h = hash3(input, pos);
    const candidate = lastGen[h] === curGen ? lastPos[h]! : -1;
    lastPos[h] = pos;
    lastGen[h] = curGen;

    if (candidate < 0) {
      pos++;
      continue;
    }
    const offset = pos - candidate;
    if (offset <= 0 || offset > WINDOW_SIZE) {
      pos++;
      continue;
    }
    if (
      input[pos] !== input[candidate] ||
      input[pos + 1] !== input[candidate + 1] ||
      input[pos + 2] !== input[candidate + 2]
    ) {
      pos++;
      continue;
    }
    let len = MIN_MATCH;
    while (
      pos + len + 8 <= inputLen &&
      input[pos + len] === input[candidate + len] &&
      input[pos + len + 1] === input[candidate + len + 1] &&
      input[pos + len + 2] === input[candidate + len + 2] &&
      input[pos + len + 3] === input[candidate + len + 3] &&
      input[pos + len + 4] === input[candidate + len + 4] &&
      input[pos + len + 5] === input[candidate + len + 5] &&
      input[pos + len + 6] === input[candidate + len + 6] &&
      input[pos + len + 7] === input[candidate + len + 7]
    ) {
      len += 8;
    }
    while (pos + len < inputLen && input[pos + len] === input[candidate + len]) {
      len++;
    }

    const literalsLength = pos - anchor;
    literals.set(input.subarray(anchor, pos), literalOut);
    literalOut += literalsLength;
    const sequence = {
      literalsLength,
      offset: offset + 3,
      matchLength: len,
    };
    if (sequenceCount < sequences.length) {
      sequences[sequenceCount] = sequence;
    } else {
      sequences.push(sequence);
    }
    sequenceCount++;

    const matchEnd = pos + len;
    const insertStep = len >= 96 ? 4 : len >= 32 ? 2 : 1;
    for (let p = pos + 1; p + MIN_MATCH <= matchEnd; p += insertStep) {
      const hp = hash3(input, p);
      lastPos[hp] = p;
      lastGen[hp] = curGen;
    }
    pos = matchEnd;
    anchor = pos;
  }

  const trailingLiterals = inputLen - anchor;
  if (trailingLiterals > 0) {
    literals.set(input.subarray(anchor), literalOut);
    literalOut += trailingLiterals;
  }

  return {
    literals: literalOut < literals.length ? literals.subarray(0, literalOut) : literals,
    sequences: sequenceCount > 0 ? sequences.slice(0, sequenceCount) : [],
    trailingLiterals,
  };
}
