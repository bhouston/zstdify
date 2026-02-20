/**
 * XXH64 checksum for zstd content validation.
 * Pure TypeScript implementation, seed=0 for frame checksum.
 */

import { readU64LE } from '../bitstream/littleEndian.js';

const PRIME64_1 = 0x9e3779b185ebc87an;
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn;
const PRIME64_3 = 0x165667b19e3779f9n;
const PRIME64_4 = 0x85ebc77b32000073n;
const PRIME64_5 = 0x27d4eb2f165667c5n;

function rotl64(x: bigint, r: number): bigint {
  r = r & 63;
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & 0xffffffffffffffffn;
}

function round64(acc: bigint, input: bigint): bigint {
  acc += input * PRIME64_2;
  acc = rotl64(acc, 31);
  acc *= PRIME64_1;
  return acc & 0xffffffffffffffffn;
}

function mergeRound64(acc: bigint, val: bigint): bigint {
  val = round64(0n, val);
  acc ^= val;
  acc = (acc * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn;
  return acc;
}

/**
 * Compute XXH64 hash of data with given seed.
 * Returns full 64-bit hash as bigint.
 */
export function xxh64(data: Uint8Array, seed = 0n): bigint {
  let acc: bigint;
  const len = data.length;

  if (len >= 32) {
    let v1 = (seed + PRIME64_1 + PRIME64_2) & 0xffffffffffffffffn;
    let v2 = (seed + PRIME64_2) & 0xffffffffffffffffn;
    let v3 = seed;
    let v4 = (seed - PRIME64_1) & 0xffffffffffffffffn;

    let offset = 0;
    const limit = len - 32;

    while (offset <= limit) {
      v1 = round64(v1, readU64LE(data, offset));
      v2 = round64(v2, readU64LE(data, offset + 8));
      v3 = round64(v3, readU64LE(data, offset + 16));
      v4 = round64(v4, readU64LE(data, offset + 24));
      offset += 32;
    }

    acc = rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18);
    acc = mergeRound64(acc, v1);
    acc = mergeRound64(acc, v2);
    acc = mergeRound64(acc, v3);
    acc = mergeRound64(acc, v4);
  } else {
    acc = (seed + PRIME64_5) & 0xffffffffffffffffn;
  }

  acc += BigInt(len);

  let offset = 0;

  while (offset + 8 <= len) {
    acc ^= round64(0n, readU64LE(data, offset));
    acc = rotl64(acc, 27) * PRIME64_1 + PRIME64_4;
    acc &= 0xffffffffffffffffn;
    offset += 8;
  }

  if (offset < len) {
    let remaining = len - offset;
    let val = 0n;
    if (remaining >= 4) {
      val =
        BigInt(
          ((data[offset] ?? 0) |
            ((data[offset + 1] ?? 0) << 8) |
            ((data[offset + 2] ?? 0) << 16) |
            ((data[offset + 3] ?? 0) << 24)) >>>
            0,
        ) |
        (val << 32n);
      offset += 4;
      remaining -= 4;
    }
    while (remaining > 0) {
      val = (val << 8n) | BigInt(data[offset] ?? 0);
      offset++;
      remaining--;
    }
    acc ^= round64(0n, val);
    acc = (rotl64(acc, 27) * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn;
  }

  acc ^= acc >> 33n;
  acc = (acc * PRIME64_2) & 0xffffffffffffffffn;
  acc ^= acc >> 29n;
  acc = (acc * PRIME64_3) & 0xffffffffffffffffn;
  acc ^= acc >> 32n;

  return acc & 0xffffffffffffffffn;
}

/**
 * Validate content checksum: low 4 bytes of XXH64(data, 0) must match stored.
 */
export function validateContentChecksum(data: Uint8Array, storedChecksum: number): boolean {
  const hash = xxh64(data, 0n);
  const low32 = Number(hash & 0xffffffffn);
  return low32 === storedChecksum >>> 0;
}
