/**
 * LSB-first bit writer used for reverse zstd bitstreams.
 * Callers must write symbols in reverse decode order.
 */
class ReverseBitWriter {
  private buffer = new Uint8Array(0);
  private outputSize = 0;
  private writePos = 0;
  private bitContainer = 0;
  private bitCount = 0;

  reset(bitLength: number): void {
    this.outputSize = (bitLength + 7) >>> 3;
    if (this.buffer.length < this.outputSize) {
      this.buffer = new Uint8Array(this.outputSize);
    }
    this.buffer.fill(0, 0, this.outputSize);
    this.writePos = 0;
    this.bitContainer = 0;
    this.bitCount = 0;
  }

  writeBits(n: number, bits: number): void {
    let remaining = n;
    let value = bits >>> 0;
    while (remaining > 0) {
      // Keep shifts <= 31 bits for stable JS bitwise semantics.
      const take = remaining > 24 ? 24 : remaining;
      const partMask = ((1 << take) - 1) >>> 0;
      const part = value & partMask;
      this.bitContainer |= part << this.bitCount;
      this.bitCount += take;
      value >>>= take;
      remaining -= take;

      while (this.bitCount >= 8) {
        this.buffer[this.writePos++] = this.bitContainer & 0xff;
        this.bitContainer >>>= 8;
        this.bitCount -= 8;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0 && this.writePos < this.outputSize) {
      this.buffer[this.writePos++] = this.bitContainer & 0xff;
      this.bitContainer = 0;
      this.bitCount = 0;
    }
    return this.buffer.slice(0, this.outputSize);
  }
}

const sharedReverseBitWriter = new ReverseBitWriter();

export function encodeReverseBitstream(bitCounts: ArrayLike<number>, bitValues: ArrayLike<number>): Uint8Array {
  let bitLength = 1; // End marker bit.
  for (let i = 0; i < bitCounts.length; i++) {
    const n = bitCounts[i] ?? 0;
    if (n > 0) bitLength += n;
  }

  sharedReverseBitWriter.reset(bitLength);
  for (let i = bitCounts.length - 1; i >= 0; i--) {
    const n = bitCounts[i] ?? 0;
    if (n > 0) sharedReverseBitWriter.writeBits(n, bitValues[i] ?? 0);
  }
  sharedReverseBitWriter.writeBits(1, 1);
  return sharedReverseBitWriter.finish();
}
