/**
 * Variable-length integer (varint) decode/encode per zstd format.
 * 1-9 bytes, little-endian, 7 bits per byte, high bit = continue.
 */

export function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let pos = offset;

  for (let i = 0; i < 9; i++) {
    if (pos >= data.length) {
      throw new RangeError('decodeVarint: truncated input');
    }
    const byte = data[pos];
    if (byte === undefined) throw new RangeError('decodeVarint: truncated input');
    pos++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, bytesRead: pos - offset };
    }
    shift += 7;
    if (shift >= 56) {
      throw new RangeError('decodeVarint: value too large');
    }
  }

  throw new RangeError('decodeVarint: exceeds 9 bytes');
}

export function encodeVarint(value: number): Uint8Array {
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
