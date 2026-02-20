/**
 * Write zstd frame header.
 */

const ZSTD_MAGIC = 0xfd2fb528;

export function writeFrameHeader(contentSize: number, hasChecksum: boolean): Uint8Array {
  const chunks: number[] = [];
  chunks.push(ZSTD_MAGIC & 0xff, (ZSTD_MAGIC >> 8) & 0xff, (ZSTD_MAGIC >> 16) & 0xff, (ZSTD_MAGIC >> 24) & 0xff);

  let fhd = 0;
  if (contentSize <= 255) {
    fhd |= 0 << 6;
    fhd |= 1 << 5;
  } else if (contentSize <= 256 + 65535 - 1) {
    fhd |= 1 << 6;
    fhd |= 1 << 5;
  } else {
    fhd |= 2 << 6;
    fhd |= 1 << 5;
  }
  fhd |= (hasChecksum ? 1 : 0) << 2;
  chunks.push(fhd);

  if (contentSize <= 255) {
    chunks.push(contentSize & 0xff);
  } else if (contentSize <= 256 + 65535 - 1) {
    chunks.push((contentSize - 256) & 0xff, ((contentSize - 256) >> 8) & 0xff);
  } else {
    chunks.push(contentSize & 0xff, (contentSize >> 8) & 0xff, (contentSize >> 16) & 0xff, (contentSize >> 24) & 0xff);
  }

  return new Uint8Array(chunks);
}
