/**
 * Little-endian bit reader with bounds-safe cursor.
 * Reads bits LSB-first within bytes, bytes in forward order.
 */

export class BitReader {
  private data: Uint8Array;
  private byteOffset: number;
  private bitOffset: number; // 0-7, bits consumed in current byte

  constructor(data: Uint8Array, byteOffset = 0) {
    this.data = data;
    this.byteOffset = byteOffset;
    this.bitOffset = 0;
  }

  /** Current byte position (after last fully consumed byte) */
  get position(): number {
    return this.byteOffset;
  }

  /** Total bits consumed */
  get bitsConsumed(): number {
    return this.byteOffset * 8 + this.bitOffset;
  }

  /** True if no more bits available */
  get atEnd(): boolean {
    return this.byteOffset >= this.data.length;
  }

  /** Ensure at least n bits are available. Throws if not. */
  ensure(n: number): void {
    const bitsAvailable = (this.data.length - this.byteOffset) * 8 - this.bitOffset;
    if (bitsAvailable < n) {
      throw new RangeError(`BitReader: requested ${n} bits, only ${bitsAvailable} available`);
    }
  }

  /** Read n bits (1-32), LSB first */
  readBits(n: number): number {
    if (n < 1 || n > 32) {
      throw new RangeError(`BitReader.readBits: n must be 1-32, got ${n}`);
    }
    this.ensure(n);

    let value = 0;
    let bitsLeft = n;

    while (bitsLeft > 0) {
      const byte = this.data[this.byteOffset] ?? 0;
      const bitsInByte = 8 - this.bitOffset;
      const take = Math.min(bitsLeft, bitsInByte);
      const mask = (1 << take) - 1;
      const shift = this.bitOffset;
      value |= ((byte >> shift) & mask) << (n - bitsLeft);

      this.bitOffset += take;
      bitsLeft -= take;

      if (this.bitOffset >= 8) {
        this.byteOffset++;
        this.bitOffset = 0;
      }
    }

    return value;
  }

  /** Align to next byte boundary (skip remaining bits in current byte) */
  align(): void {
    if (this.bitOffset !== 0) {
      this.bitOffset = 0;
      this.byteOffset++;
    }
  }

  /** Read a full byte (convenience, must be aligned or will read across boundary) */
  readByte(): number {
    if (this.bitOffset === 0) {
      if (this.byteOffset >= this.data.length) {
        throw new RangeError('BitReader: no more bytes');
      }
      const v = this.data[this.byteOffset++];
      if (v === undefined) throw new RangeError('BitReader: no more bytes');
      return v;
    }
    return this.readBits(8);
  }

  /** Slice remaining bytes from current position (after aligning) */
  readRemainingBytes(): Uint8Array {
    this.align();
    if (this.byteOffset >= this.data.length) {
      return new Uint8Array(0);
    }
    return this.data.subarray(this.byteOffset);
  }
}
