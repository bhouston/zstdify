/**
 * Deterministic payload generators for tests (datagen-style).
 */

export function makeSeededPayload(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    data[i] = x & 0xff;
  }
  return data;
}

/** Same as makeSeededPayload with seed 0x12345678 (used by differential tests). */
export function makeBinaryPayload(size: number): Uint8Array {
  return makeSeededPayload(size, 0x12345678);
}
