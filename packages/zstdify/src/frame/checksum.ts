/**
 * XXH64 checksum for zstd content validation.
 * Pure TypeScript implementation, seed=0 for frame checksum.
 */

import { readU32LE, readU64LE } from '../bitstream/littleEndian.js';

const PRIME64_1 = 0x9e3779b185ebca87n;
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn;
const PRIME64_3 = 0x165667b19e3779f9n;
const PRIME64_4 = 0x85ebca77c2b2ae63n;
const PRIME64_5 = 0x27d4eb2f165667c5n;
const MASK64 = 0xffffffffffffffffn;

function rotl64(x: bigint, r: number): bigint {
  r = (r & 63) | 0; // Hint JIT: integer
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & MASK64;
}

function round64(acc: bigint, input: bigint): bigint {
  acc = (acc + input * PRIME64_2) & MASK64;
  acc = rotl64(acc, 31);
  return (acc * PRIME64_1) & MASK64;
}

function mergeRound64(acc: bigint, val: bigint): bigint {
  val = round64(0n, val);
  acc ^= val;
  acc = (acc * PRIME64_1 + PRIME64_4) & MASK64;
  return acc;
}

/**
 * Compute XXH64 hash of data with given seed.
 * Returns full 64-bit hash as bigint.
 */
export function xxh64(data: Uint8Array, seed = 0n): bigint {
  let acc: bigint;
  const len = data.length | 0; // Hint JIT: integer for hot loop
  let offset = 0 | 0;

  if (len >= 32) {
    let v1 = (seed + PRIME64_1 + PRIME64_2) & MASK64;
    let v2 = (seed + PRIME64_2) & MASK64;
    let v3 = seed & MASK64;
    let v4 = (seed - PRIME64_1) & MASK64;

    const limit = len - 32;

    while (offset <= limit) {
      v1 = round64(v1, readU64LE(data, offset));
      v2 = round64(v2, readU64LE(data, offset + 8));
      v3 = round64(v3, readU64LE(data, offset + 16));
      v4 = round64(v4, readU64LE(data, offset + 24));
      offset += 32;
    }

    acc = (rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18)) & MASK64;
    acc = mergeRound64(acc, v1);
    acc = mergeRound64(acc, v2);
    acc = mergeRound64(acc, v3);
    acc = mergeRound64(acc, v4);
  } else {
    acc = (seed + PRIME64_5) & MASK64;
  }

  acc = (acc + BigInt(len)) & MASK64;

  while (offset + 8 <= len) {
    acc ^= round64(0n, readU64LE(data, offset));
    acc = rotl64(acc, 27) * PRIME64_1 + PRIME64_4;
    acc &= MASK64;
    offset += 8;
  }

  if (offset + 4 <= len) {
    acc ^= (BigInt(readU32LE(data, offset)) * PRIME64_1) & 0xffffffffffffffffn;
    acc = (rotl64(acc, 23) * PRIME64_2 + PRIME64_3) & MASK64;
    offset += 4;
  }

  while (offset < len) {
    acc ^= (BigInt(data[offset] ?? 0) * PRIME64_5) & MASK64;
    acc = (rotl64(acc, 11) * PRIME64_1) & MASK64;
    offset++;
  }

  acc ^= acc >> 33n;
  acc = (acc * PRIME64_2) & MASK64;
  acc ^= acc >> 29n;
  acc = (acc * PRIME64_3) & MASK64;
  acc ^= acc >> 32n;

  return acc & MASK64;
}

/**
 * Validate content checksum: low 4 bytes of XXH64(data, 0) must match stored.
 */
export function validateContentChecksum(data: Uint8Array, storedChecksum: number): boolean {
  return computeContentChecksum32(data) === storedChecksum >>> 0;
}

/**
 * Compute the 32-bit frame content checksum (low 32 bits of XXH64).
 */
export function computeContentChecksum32(data: Uint8Array): number {
  const hash = xxh64(data, 0n);
  return Number(hash & 0xffffffffn) >>> 0;
}
