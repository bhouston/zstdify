/**
 * Write raw and RLE blocks.
 */

let sharedHeader: Uint8Array | null = null;

function writeU24LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
}

function getHeader(): Uint8Array {
  if (!sharedHeader) sharedHeader = new Uint8Array(3);
  return sharedHeader;
}

export function writeRawBlock(data: Uint8Array, offset: number, size: number, last: boolean): Uint8Array {
  const header = getHeader();
  const blockHeader = (last ? 1 : 0) | (0 << 1) | (size << 3);
  writeU24LE(header, 0, blockHeader);
  const result = new Uint8Array(3 + size);
  result.set(header);
  result.set(data.subarray(offset, offset + size), 3);
  return result;
}

export function writeRLEBlock(byte: number, size: number, last: boolean): Uint8Array {
  const header = getHeader();
  const blockHeader = (last ? 1 : 0) | (1 << 1) | (size << 3);
  writeU24LE(header, 0, blockHeader);
  const result = new Uint8Array(4);
  result.set(header, 0);
  result[3] = byte & 0xff;
  return result;
}
