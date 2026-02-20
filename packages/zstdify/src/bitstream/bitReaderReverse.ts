/**
 * Reverse (backward) bit reader for FSE/Huffman streams in zstd.
 * Reads from end of buffer toward start. Bits are consumed from MSB to LSB in each byte.
 */

export class BitReaderReverse {
  private data: Uint8Array;
  private byteOffset: number; // points to current byte (from end)
  private bitOffset: number; // 0-7, bits consumed in current byte from high end
  private startByteOffset: number;
  private skipBitsAtStart: number;

  constructor(data: Uint8Array, startByteOffset: number, lengthBytes: number, skipBitsAtStart = 0) {
    this.data = data;
    this.startByteOffset = startByteOffset;
    this.skipBitsAtStart = skipBitsAtStart;
    this.byteOffset = startByteOffset + lengthBytes - 1; // start at last byte
    this.bitOffset = 0;
  }

  private advanceBits(count: number): void {
    let bitsLeft = count;
    while (bitsLeft > 0) {
      const bitsInByte = 8 - this.bitOffset;
      const take = Math.min(bitsLeft, bitsInByte);
      this.bitOffset += take;
      bitsLeft -= take;
      if (this.bitOffset >= 8) {
        this.byteOffset--;
        this.bitOffset = 0;
      }
    }
  }

  private readBit(): number {
    while (true) {
      if (this.byteOffset < this.startByteOffset) {
        throw new RangeError('BitReaderReverse: buffer underflow');
      }
      if (this.byteOffset === this.startByteOffset && this.skipBitsAtStart > 0) {
        const bitsInByte = 8 - this.bitOffset;
        const skip = Math.min(this.skipBitsAtStart, bitsInByte);
        this.advanceBits(skip);
        this.skipBitsAtStart -= skip;
        continue;
      }
      const byte = this.data[this.byteOffset] ?? 0;
      const bit = (byte >> (7 - this.bitOffset)) & 1;
      this.advanceBits(1);
      return bit;
    }
  }

  /** Read n bits (1-32), LSB first from current position (reading backward) */
  readBits(n: number): number {
    if (n < 1 || n > 32) {
      throw new RangeError(`BitReaderReverse.readBits: n must be 1-32, got ${n}`);
    }

    let value = 0;
    for (let i = 0; i < n; i++) {
      value |= this.readBit() << i;
    }
    return value;
  }

  /** Skip trailing zero padding, stop at the end-mark 1-bit (without consuming it). */
  skipPadding(): void {
    while (this.byteOffset >= this.startByteOffset) {
      if (this.byteOffset === this.startByteOffset && this.skipBitsAtStart > 0) {
        const bitsInByte = 8 - this.bitOffset;
        const skip = Math.min(this.skipBitsAtStart, bitsInByte);
        this.advanceBits(skip);
        this.skipBitsAtStart -= skip;
        continue;
      }
      const byte = this.data[this.byteOffset] ?? 0;
      const bit = (byte >> (7 - this.bitOffset)) & 1;
      if (bit === 1) {
        return;
      }
      this.advanceBits(1);
    }
  }

  get position(): number {
    return this.byteOffset;
  }

  /** Skip the first n bits at the logical start (the end of the buffer when reading backward). */
  skipBitsAtEnd(n: number): void {
    if (n <= 0) return;
    this.advanceBits(n);
  }
}
