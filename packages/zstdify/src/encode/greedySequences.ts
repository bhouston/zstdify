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

/** Compare 4-byte words where safe, then byte tail. */
function matchLength(data: Uint8Array, dv: DataView | null, a: number, b: number): number {
  const len = data.length - a;
  let n = 0;
  if (dv && len >= 4) {
    const end = a + len;
    let pa = a;
    let pb = b;
    while (pa + 4 <= end) {
      if (dv.getUint32(pa, true) !== dv.getUint32(pb, true)) break;
      pa += 4;
      pb += 4;
      n += 4;
    }
    a = pa;
    b = pb;
  }
  while (n < len && data[a + n] === data[b + n]) {
    n++;
  }
  return n;
}

export function buildGreedySequences(input: Uint8Array): GreedyEncodeResult {
  if (input.length < MIN_MATCH) {
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

  const sequences: Sequence[] = [];
  const literals = new Uint8Array(input.length);
  let literalOut = 0;
  let anchor = 0;
  let pos = 0;
  const dv = input.byteLength >= 4 ? new DataView(input.buffer, input.byteOffset, input.byteLength) : null;

  while (pos + MIN_MATCH <= input.length) {
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
    if (input[pos] !== input[candidate]) {
      pos++;
      continue;
    }
    const len = matchLength(input, dv, pos, candidate);
    if (len < MIN_MATCH) {
      pos++;
      continue;
    }

    const literalsLength = pos - anchor;
    literals.set(input.subarray(anchor, pos), literalOut);
    literalOut += literalsLength;
    sequences.push({
      literalsLength,
      offset: offset + 3,
      matchLength: len,
    });

    const matchEnd = pos + len;
    for (let p = pos + 1; p + MIN_MATCH <= matchEnd; p++) {
      const hp = hash3(input, p);
      lastPos[hp] = p;
      lastGen[hp] = curGen;
    }
    pos = matchEnd;
    anchor = pos;
  }

  const trailingLiterals = input.length - anchor;
  if (trailingLiterals > 0) {
    literals.set(input.subarray(anchor), literalOut);
    literalOut += trailingLiterals;
  }

  return {
    literals: literalOut < literals.length ? literals.subarray(0, literalOut) : literals,
    sequences,
    trailingLiterals,
  };
}
