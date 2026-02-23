/**
 * Little-endian bit writer.
 * Writes bits LSB-first within bytes.
 * Uses a single pre-allocated Uint8Array buffer (grown as needed) to avoid GC pressure.
 */

const DEFAULT_BITWRITER_CAPACITY = 256;

export class BitWriter {
  private buffer: Uint8Array;
  private writePos = 0;
  private currentByte = 0;
  private bitOffset = 0; // 0-7, bits written in current byte

  constructor(initialCapacity = DEFAULT_BITWRITER_CAPACITY) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  private grow(): void {
    const next = new Uint8Array(this.buffer.length * 2);
    next.set(this.buffer, 0);
    this.buffer = next;
  }

  /** Write n bits (1-32), LSB first */
  writeBits(n: number, bits: number): void {
    if (n < 1 || n > 32) {
      throw new RangeError(`BitWriter.writeBits: n must be 1-32, got ${n}`);
    }
    const mask = n === 32 ? 0xffff_ffff : (1 << n) - 1;
    let value = (bits >>> 0) & mask;
    let bitsLeft = n;

    while (bitsLeft > 0) {
      const spaceInByte = 8 - this.bitOffset;
      const take = bitsLeft < spaceInByte ? bitsLeft : spaceInByte;
      const maskTake = (1 << take) - 1;
      this.currentByte |= (value & maskTake) << this.bitOffset;

      this.bitOffset += take;
      bitsLeft -= take;
      value >>= take;

      if (this.bitOffset >= 8) {
        if (this.writePos >= this.buffer.length) this.grow();
        this.buffer[this.writePos++] = this.currentByte & 0xff;
        this.currentByte = 0;
        this.bitOffset = 0;
      }
    }
  }

  /** Flush remaining bits to output. Call when done writing. Returns a copy so the writer can be reused. */
  flush(): Uint8Array {
    if (this.bitOffset > 0) {
      if (this.writePos >= this.buffer.length) this.grow();
      this.buffer[this.writePos++] = this.currentByte & 0xff;
      this.currentByte = 0;
      this.bitOffset = 0;
    }
    if (this.writePos === 0) return new Uint8Array(0);
    return this.buffer.slice(0, this.writePos);
  }

  /** Reset writer for reuse (keeps buffer to avoid re-allocation). */
  reset(): void {
    this.writePos = 0;
    this.currentByte = 0;
    this.bitOffset = 0;
  }
}
