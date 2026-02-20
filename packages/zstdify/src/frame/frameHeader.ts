/**
 * Zstandard frame header parser.
 * Parses magic, frame descriptor, window descriptor, content size.
 */

import { readU32LE } from '../bitstream/littleEndian.js';
import { ZstdError } from '../errors.js';

export const ZSTD_MAGIC = 0xfd2fb528;
export const ZSTD_FRAMEHEADER_SIZE_MIN = 2;
export const ZSTD_FRAMEHEADER_SIZE_MAX = 14;

export interface FrameHeader {
  /** Total header size in bytes */
  headerSize: number;
  /** Window size (minimum buffer for decompression) */
  windowSize: number;
  /** Decompressed content size, or null if unknown */
  contentSize: number | null;
  /** Whether content checksum is present at end of frame */
  hasContentChecksum: boolean;
  /** Dictionary ID if present, else null */
  dictionaryId: number | null;
  /** Single segment mode (no window descriptor) */
  singleSegment: boolean;
}

export function parseFrameHeader(data: Uint8Array, offset: number): FrameHeader {
  if (offset + 2 > data.length) {
    throw new ZstdError('Frame header truncated', 'corruption_detected');
  }

  const fhd = data[offset]!;
  offset++;

  const frameContentSizeFlag = (fhd >> 6) & 3;
  const singleSegment = ((fhd >> 5) & 1) === 1;
  const contentChecksumFlag = ((fhd >> 2) & 1) === 1;
  const dictionaryIdFlag = fhd & 3;

  if ((fhd & 0x10) !== 0) {
    throw new ZstdError('Unused bit set in frame header', 'corruption_detected');
  }
  if ((fhd & 0x08) !== 0) {
    throw new ZstdError('Reserved bit set in frame header', 'corruption_detected');
  }

  let windowSize = 0; // set below: from window descriptor (non-single) or from content size (single)
  let contentSize: number | null = null;
  let headerSize = 1;

  // Order per spec: Frame_Header_Descriptor | [Window_Descriptor] | [Dictionary_ID] | [Frame_Content_Size]
  if (singleSegment) {
    // No Window_Descriptor; next is Dictionary_ID then Frame_Content_Size; windowSize set from FCS below
  } else {
    if (offset + 1 > data.length) {
      throw new ZstdError('Frame header truncated (window descriptor)', 'corruption_detected');
    }
    const wd = data[offset]!;
    offset++;
    headerSize++;

    const exponent = (wd >> 3) & 0x1f;
    const mantissa = wd & 7;
    const windowLog = 10 + exponent;
    const windowBase = 1 << windowLog;
    const windowAdd = (windowBase / 8) * mantissa;
    windowSize = windowBase + windowAdd;
  }

  // Dictionary_ID (before Frame_Content_Size per spec)
  let dictionaryId: number | null = null;
  const didFieldSize = [0, 1, 2, 4][dictionaryIdFlag]!;
  if (didFieldSize > 0) {
    if (offset + didFieldSize > data.length) {
      throw new ZstdError('Frame header truncated (dictionary ID)', 'corruption_detected');
    }
    let did = 0;
    if (didFieldSize === 1) did = data[offset]!;
    else if (didFieldSize === 2) did = data[offset]! | (data[offset + 1]! << 8);
    else did = readU32LE(data, offset);
    dictionaryId = did !== 0 ? did : null;
    offset += didFieldSize;
    headerSize += didFieldSize;
  }

  // Frame_Content_Size
  const fcsFieldSize =
    frameContentSizeFlag === 0
      ? singleSegment
        ? 1
        : 0
      : frameContentSizeFlag === 1
        ? 2
        : frameContentSizeFlag === 2
          ? 4
          : 8;
  if (fcsFieldSize > 0) {
    if (offset + fcsFieldSize > data.length) {
      throw new ZstdError('Frame header truncated (content size)', 'corruption_detected');
    }
    contentSize = readFrameContentSize(data, offset, fcsFieldSize);
    offset += fcsFieldSize;
    headerSize += fcsFieldSize;
    if (singleSegment) {
      windowSize = contentSize;
    }
  }

  return {
    headerSize,
    windowSize,
    contentSize,
    hasContentChecksum: contentChecksumFlag,
    dictionaryId: dictionaryId !== 0 ? dictionaryId : null,
    singleSegment,
  };
}

function readFrameContentSize(data: Uint8Array, offset: number, size: number): number {
  if (size === 1) {
    return data[offset]!;
  }
  if (size === 2) {
    return 256 + (data[offset]! | (data[offset + 1]! << 8));
  }
  if (size === 4) {
    return readU32LE(data, offset);
  }
  if (size === 8) {
    const lo = readU32LE(data, offset);
    const hi = readU32LE(data, offset + 4);
    const v = lo + hi * 0x1_0000_0000;
    if (v > Number.MAX_SAFE_INTEGER) {
      throw new ZstdError('Content size exceeds safe integer range', 'parameter_unsupported');
    }
    return v;
  }
  throw new ZstdError(`Invalid FCS field size: ${size}`, 'corruption_detected');
}

export function parseZstdFrame(data: Uint8Array, offset: number): { magic: number; header: FrameHeader } {
  if (offset + 4 > data.length) {
    throw new ZstdError('Input too short for magic number', 'corruption_detected');
  }

  const magic = readU32LE(data, offset);
  if (magic !== ZSTD_MAGIC) {
    throw new ZstdError(`Invalid zstd magic: 0x${magic.toString(16)}`, 'corruption_detected');
  }

  const header = parseFrameHeader(data, offset + 4);
  return { magic, header };
}
