/**
 * Variable-length integer (varint) decode/encode per zstd format.
 * This implementation supports unsigned 32-bit values (1-5 bytes).
 * Little-endian, 7 bits per byte, high bit = continue.
 */

export function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`decodeVarint: offset must be a non-negative integer, got ${offset}`);
  }
  let value = 0;
  let shift = 0;
  let pos = offset;

  for (let i = 0; i < 5; i++) {
    if (pos >= data.length) {
      throw new RangeError('decodeVarint: truncated input');
    }
    const byte = data[pos];
    if (byte === undefined) throw new RangeError('decodeVarint: truncated input');
    pos++;
    const chunk = byte & 0x7f;
    if (shift === 28 && chunk > 0x0f) {
      throw new RangeError('decodeVarint: value too large for uint32');
    }
    value += chunk * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, bytesRead: pos - offset };
    }
    shift += 7;
  }

  throw new RangeError('decodeVarint: exceeds 5 bytes for uint32');
}

export function encodeVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`encodeVarint: value must be a uint32, got ${value}`);
  }
  const bytes: number[] = [];
  let v = value >>> 0;

  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);

  return new Uint8Array(bytes);
}
