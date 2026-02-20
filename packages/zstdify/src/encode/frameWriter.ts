/**
 * Write zstd frame header.
 */

const ZSTD_MAGIC = 0xfd2fb528;

function writeDictionaryId(chunks: number[], dictionaryId: number): void {
  if (dictionaryId <= 0xff) {
    chunks.push(dictionaryId & 0xff);
    return;
  }
  if (dictionaryId <= 0xffff) {
    chunks.push(dictionaryId & 0xff, (dictionaryId >>> 8) & 0xff);
    return;
  }
  chunks.push(
    dictionaryId & 0xff,
    (dictionaryId >>> 8) & 0xff,
    (dictionaryId >>> 16) & 0xff,
    (dictionaryId >>> 24) & 0xff,
  );
}

export function writeFrameHeader(
  contentSize: number,
  hasChecksum: boolean,
  dictionaryId: number | null = null,
): Uint8Array {
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
  if (dictionaryId !== null) {
    if (!Number.isInteger(dictionaryId) || dictionaryId <= 0 || dictionaryId > 0xffff_ffff) {
      throw new Error('Invalid dictionaryId in frame header');
    }
    if (dictionaryId <= 0xff) fhd |= 1;
    else if (dictionaryId <= 0xffff) fhd |= 2;
    else fhd |= 3;
  }
  fhd |= (hasChecksum ? 1 : 0) << 2;
  chunks.push(fhd);

  if (dictionaryId !== null) {
    writeDictionaryId(chunks, dictionaryId >>> 0);
  }

  if (contentSize <= 255) {
    chunks.push(contentSize & 0xff);
  } else if (contentSize <= 256 + 65535 - 1) {
    chunks.push((contentSize - 256) & 0xff, ((contentSize - 256) >> 8) & 0xff);
  } else {
    chunks.push(contentSize & 0xff, (contentSize >> 8) & 0xff, (contentSize >> 16) & 0xff, (contentSize >> 24) & 0xff);
  }

  return new Uint8Array(chunks);
}
