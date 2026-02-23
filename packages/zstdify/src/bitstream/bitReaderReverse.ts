/**
 * Reverse (backward) bit reader for FSE/Huffman streams in zstd.
 * Modeled after zstd's reverse stream semantics:
 * - compute an absolute bit offset from stream start,
 * - consume bits by decrementing that offset,
 * - extract bits in little-endian bit order.
 */

const BIT_MASKS = new Uint32Array(33);
for (let i = 0; i <= 32; i++) {
  BIT_MASKS[i] = i === 32 ? 0xffffffff : ((1 << i) - 1) >>> 0;
}

function readU32LEBounded(data: Uint8Array, idx: number): number {
  return (
    ((data[idx] ?? 0) | ((data[idx + 1] ?? 0) << 8) | ((data[idx + 2] ?? 0) << 16) | ((data[idx + 3] ?? 0) << 24)) >>> 0
  );
}

function readU32LEFast(data: Uint8Array, idx: number): number {
  return (data[idx]! | (data[idx + 1]! << 8) | (data[idx + 2]! << 16) | (data[idx + 3]! << 24)) >>> 0;
}

export class BitReaderReverse {
  private readonly data: Uint8Array;
  private readonly dataLength: number;
  private readonly startBit: number;
  private readonly endBit: number;
  private bitOffset: number;

  constructor(data: Uint8Array, startByteOffset: number, lengthBytes: number, skipBitsAtStart = 0) {
    if (lengthBytes < 0) {
      throw new RangeError(`BitReaderReverse: negative length ${lengthBytes}`);
    }
    this.data = data;
    this.dataLength = data.length;
    this.startBit = startByteOffset * 8 + skipBitsAtStart;
    this.endBit = (startByteOffset + lengthBytes) * 8;
    this.bitOffset = this.endBit;
  }

  /** Read n bits (1-32), LSB first from current position (reading backward) */
  readBits(n: number): number {
    if (n < 1 || n > 32) {
      throw new RangeError(`BitReaderReverse.readBits: n must be 1-32, got ${n}`);
    }

    const requestedStart = this.bitOffset - n;
    const clampedStart = requestedStart < this.startBit ? this.startBit : requestedStart;
    this.bitOffset = clampedStart;

    if (requestedStart >= this.startBit) {
      const byteIndex = requestedStart >>> 3;
      const bitInByte = requestedStart & 7;
      if (bitInByte + n <= 8) {
        return ((this.data[byteIndex]! >>> bitInByte) & BIT_MASKS[n]!) >>> 0;
      }

      const hasEightBytes = byteIndex + 7 < this.dataLength;
      const word0 = hasEightBytes ? readU32LEFast(this.data, byteIndex) : readU32LEBounded(this.data, byteIndex);
      if (bitInByte + n <= 32) {
        const value = word0 >>> bitInByte;
        return n === 32 ? value >>> 0 : (value & BIT_MASKS[n]!) >>> 0;
      }

      const low = word0 >>> bitInByte;
      const highBits = n - (32 - bitInByte);
      const word1 = hasEightBytes
        ? readU32LEFast(this.data, byteIndex + 4)
        : readU32LEBounded(this.data, byteIndex + 4);
      const high = ((word1 & BIT_MASKS[highBits]!) << (32 - bitInByte)) >>> 0;
      const merged = (low | high) >>> 0;
      return n === 32 ? merged : (merged & BIT_MASKS[n]!) >>> 0;
    }

    let value = 0;
    for (let i = 0; i < n; i++) {
      const absoluteBit = requestedStart + i;
      if (absoluteBit < this.startBit) {
        continue;
      }
      const byteIndex = absoluteBit >>> 3;
      const bitInByte = absoluteBit & 7;
      const bit = ((this.data[byteIndex] ?? 0) >>> bitInByte) & 1;
      value |= bit << i;
    }
    return value;
  }

  /**
   * Read n bits and throw if request crosses the logical stream start.
   *
   * Use strict reads for inputs that must fail fast on truncation/corruption.
   * Keep readBits()/readBitsFast() for decode paths that intentionally rely on
   * zstd-compatible zero-fill behavior near the stream start.
   */
  readBitsStrict(n: number): number {
    if (n < 1 || n > 32) {
      throw new RangeError(`BitReaderReverse.readBitsStrict: n must be 1-32, got ${n}`);
    }
    if (n > this.bitsRemaining) {
      throw new RangeError('BitReaderReverse: buffer underflow');
    }
    return this.readBits(n);
  }

  /**
   * Fast path used by validated hot loops.
   * Falls back to readBits() when the request crosses the logical stream start.
   */
  readBitsFast(n: number): number {
    if (n < 1 || n > 24) {
      return this.readBits(n);
    }
    const requestedStart = this.bitOffset - n;
    if (requestedStart < this.startBit) {
      return this.readBits(n);
    }
    this.bitOffset = requestedStart;
    const byteIndex = requestedStart >>> 3;
    const bitInByte = requestedStart & 7;
    const word =
      byteIndex + 3 < this.dataLength ? readU32LEFast(this.data, byteIndex) : readU32LEBounded(this.data, byteIndex);
    return ((word >>> bitInByte) & BIT_MASKS[n]!) >>> 0;
  }

  /** Fast-path strict variant that forbids crossing stream start. */
  readBitsFastStrict(n: number): number {
    if (n < 1 || n > 24) {
      return this.readBitsStrict(n);
    }
    if (n > this.bitsRemaining) {
      throw new RangeError('BitReaderReverse: buffer underflow');
    }
    return this.readBitsFast(n);
  }

  /**
   * Hot-loop helper: read n bits quickly, returning 0 when n is 0.
   */
  readBitsFastOrZero(n: number): number {
    if (n === 0) {
      return 0;
    }
    return this.readBitsFast(n);
  }

  /** Skip trailing zero padding and end-mark bit from the stream tail. */
  skipPadding(): void {
    if (this.endBit <= this.startBit) {
      throw new RangeError('BitReaderReverse: empty stream');
    }
    const lastByteIndex = (this.endBit >>> 3) - 1;
    const lastByte = this.data[lastByteIndex] ?? 0;
    if (lastByte === 0) {
      throw new RangeError('BitReaderReverse: invalid end marker');
    }
    const highestSetBit = 31 - Math.clz32(lastByte);
    const paddingBits = 8 - highestSetBit; // includes end-mark + zero padding bits.
    this.bitOffset = this.endBit - paddingBits;
    if (this.bitOffset < this.startBit) {
      throw new RangeError('BitReaderReverse: invalid padding');
    }
  }

  get position(): number {
    if (this.bitOffset <= this.startBit) {
      return this.startBit >>> 3;
    }
    return (this.bitOffset - 1) >>> 3;
  }

  get bitsRemaining(): number {
    return this.bitOffset - this.startBit;
  }

  /** Skip the first n bits at the logical start (the end of the buffer when reading backward). */
  skipBitsAtEnd(n: number): void {
    if (n <= 0) return;
    this.bitOffset -= n;
    if (this.bitOffset < this.startBit) {
      throw new RangeError('BitReaderReverse: buffer underflow');
    }
  }

  /** Undo a previous readBits() by pushing the cursor forward. */
  unreadBits(n: number): void {
    if (n <= 0) return;
    this.bitOffset += n;
    if (this.bitOffset > this.endBit) {
      throw new RangeError('BitReaderReverse: unread overflow');
    }
  }
}
