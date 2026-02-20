/**
 * Little-endian read helpers for Uint8Array.
 * All reads are bounds-checked.
 */

export function readU16LE(data: Uint8Array, offset: number): number {
  if (offset + 2 > data.length) {
    throw new RangeError(`readU16LE: offset ${offset} + 2 exceeds length ${data.length}`);
  }
  const a = data[offset];
  const b = data[offset + 1];
  if (a === undefined || b === undefined) throw new Error('unreachable');
  return a | (b << 8);
}

export function readU32LE(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    throw new RangeError(`readU32LE: offset ${offset} + 4 exceeds length ${data.length}`);
  }
  const a = data[offset];
  const b = data[offset + 1];
  const c = data[offset + 2];
  const d = data[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('unreachable');
  return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
}

export function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) {
    throw new RangeError(`readU64LE: offset ${offset} + 8 exceeds length ${data.length}`);
  }
  const b0 = data[offset];
  const b1 = data[offset + 1];
  const b2 = data[offset + 2];
  const b3 = data[offset + 3];
  const b4 = data[offset + 4];
  const b5 = data[offset + 5];
  const b6 = data[offset + 6];
  const b7 = data[offset + 7];
  if ([b0, b1, b2, b3, b4, b5, b6, b7].some((x) => x === undefined)) throw new Error('unreachable');
  const lo = ((b0 as number) | ((b1 as number) << 8) | ((b2 as number) << 16) | ((b3 as number) << 24)) >>> 0;
  const hi = ((b4 as number) | ((b5 as number) << 8) | ((b6 as number) << 16) | ((b7 as number) << 24)) >>> 0;
  return BigInt(lo) | (BigInt(hi) << 32n);
}
