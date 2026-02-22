import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

type DecompressFn = (input: Uint8Array, options?: { validateChecksum?: boolean; debugTrace?: unknown }) => Uint8Array;

type CompressionMode = 0 | 1 | 2 | 3;

const CHUNK_SIZE = 64 * 1024;

export interface InteropDivergenceReport {
  payloadId: string;
  passLevel: number;
  failLevel: number;
  passCompressedBytes: number;
  failCompressedBytes: number;
  mismatchOffset: number;
  mismatchChunkIndex: number;
  expectedChunkHash: string;
  actualChunkHash: string;
  expectedContextHex: string;
  actualContextHex: string;
  failOutputLength: number;
  expectedOutputLength: number;
  passBlockAtMismatch: DecodeTraceBlockInfo | null;
  failBlockAtMismatch: DecodeTraceBlockInfo | null;
  passBlockScan: BlockScanRecord[];
  failBlockScan: BlockScanRecord[];
  suspectPaths: string[];
}

interface SequenceHeaderInfo {
  numSequences: number;
  llMode: CompressionMode;
  ofMode: CompressionMode;
  mlMode: CompressionMode;
}

interface SequenceModeInfo {
  llMode: CompressionMode;
  ofMode: CompressionMode;
  mlMode: CompressionMode;
  llModeName: string;
  ofModeName: string;
  mlModeName: string;
}

export interface DecodeTraceBlockInfo {
  blockIndex: number;
  blockType: 0 | 1 | 2;
  blockSize: number;
  lastBlock: boolean;
  inputOffset: number;
  outputStart: number;
  outputEnd: number;
  literals?: {
    blockType: 0 | 1 | 2 | 3;
    regeneratedSize: number;
    compressedSize?: number;
    numStreams: 1 | 4;
    headerSize: number;
  };
  sequences?: {
    numSequences: number;
    llMode: 0 | 1 | 2 | 3;
    ofMode: 0 | 1 | 2 | 3;
    mlMode: 0 | 1 | 2 | 3;
    llTableLog: number;
    ofTableLog: number;
    mlTableLog: number;
    repeatOffsetCandidateCount: number;
  };
}

interface BlockScanRecord {
  index: number;
  blockType: 0 | 1 | 2;
  blockSize: number;
  lastBlock: boolean;
  literals?: {
    blockType: 0 | 1 | 2 | 3;
    blockTypeName: string;
    numStreams: 1 | 4;
    regeneratedSize: number;
    compressedSize?: number;
    headerSize: number;
  };
  sequences?: SequenceHeaderInfo & SequenceModeInfo;
}

export interface RunInteropDebugOptions {
  payloadId: string;
  input: Uint8Array;
  passLevel: number;
  failLevel: number;
}

let cachedDecompress: DecompressFn | null = null;

async function resolveDecompress(): Promise<DecompressFn> {
  if (cachedDecompress) return cachedDecompress;
  try {
    const sourceMod = (await import('../../../zstdify/dist/decompress.js')) as { decompress: DecompressFn };
    cachedDecompress = sourceMod.decompress;
    return cachedDecompress;
  } catch {
    const packageMod = (await import('zstdify')) as { decompress: DecompressFn };
    cachedDecompress = packageMod.decompress;
    return cachedDecompress;
  }
}

function nodeCompress(data: Uint8Array, level: number): Uint8Array {
  const params: Record<number, number> = {
    [zlib.constants.ZSTD_c_compressionLevel]: level,
  };
  return new Uint8Array(zlib.zstdCompressSync(Buffer.from(data), { params }));
}

function modeName(mode: CompressionMode): string {
  if (mode === 0) return 'predefined';
  if (mode === 1) return 'rle';
  if (mode === 2) return 'compressed';
  return 'repeat';
}

function literalsBlockTypeName(blockType: 0 | 1 | 2 | 3): string {
  if (blockType === 0) return 'raw';
  if (blockType === 1) return 'rle';
  if (blockType === 2) return 'compressed';
  return 'treeless';
}

const ZSTD_MAGIC = 0xfd2fb528;
const ZERO_BYTE = 0;

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readByte(data: Uint8Array, offset: number): number {
  return data[offset] ?? ZERO_BYTE;
}

function parseFrameHeaderSize(data: Uint8Array): number {
  if (data.length < 6) throw new Error('Frame too short');
  if (readU32LE(data, 0) !== ZSTD_MAGIC) throw new Error('Invalid zstd magic');
  let offset = 4;
  const fhd = readByte(data, offset);
  offset++;
  const frameContentSizeFlag = (fhd >> 6) & 3;
  const singleSegment = ((fhd >> 5) & 1) === 1;
  const dictionaryIdFlag = fhd & 3;
  if (!singleSegment) {
    offset += 1;
  }
  const didFieldSize = [0, 1, 2, 4][dictionaryIdFlag] ?? 0;
  offset += didFieldSize;
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
  offset += fcsFieldSize;
  return offset;
}

function parseBlockHeaderLocal(
  data: Uint8Array,
  offset: number,
): {
  lastBlock: boolean;
  blockType: 0 | 1 | 2 | 3;
  blockSize: number;
} {
  const w = (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16);
  return {
    lastBlock: (w & 1) === 1,
    blockType: ((w >> 1) & 3) as 0 | 1 | 2 | 3,
    blockSize: w >> 3,
  };
}

function parseLiteralsSectionHeaderLocal(
  data: Uint8Array,
  offset: number,
): {
  blockType: 0 | 1 | 2 | 3;
  sizeFormat: number;
  regeneratedSize: number;
  compressedSize?: number;
  numStreams: 1 | 4;
  headerSize: number;
} {
  const b0 = readByte(data, offset);
  const blockType = (b0 & 3) as 0 | 1 | 2 | 3;
  const sizeFormat = (b0 >> 2) & 3;
  if (blockType === 0 || blockType === 1) {
    if (sizeFormat === 0 || sizeFormat === 2) {
      return { blockType, sizeFormat, regeneratedSize: b0 >> 3, headerSize: 1, numStreams: 1 };
    }
    if (sizeFormat === 1) {
      const b1 = readByte(data, offset + 1);
      return { blockType, sizeFormat, regeneratedSize: (b0 >> 4) + (b1 << 4), headerSize: 2, numStreams: 1 };
    }
    const b1 = readByte(data, offset + 1);
    const b2 = readByte(data, offset + 2);
    return {
      blockType,
      sizeFormat,
      regeneratedSize: (b0 >> 4) + (b1 << 4) + (b2 << 12),
      headerSize: 3,
      numStreams: 1,
    };
  }
  let bitPos = 4;
  const readBits = (numBits: number): number => {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const absoluteBit = bitPos + i;
      const byteIndex = offset + (absoluteBit >> 3);
      const bitInByte = absoluteBit & 7;
      value |= (((data[byteIndex] ?? 0) >> bitInByte) & 1) << i;
    }
    bitPos += numBits;
    return value;
  };
  const numStreams = sizeFormat === 0 ? 1 : 4;
  const sizeBits = sizeFormat <= 1 ? 10 : sizeFormat === 2 ? 14 : 18;
  const regeneratedSize = readBits(sizeBits);
  const compressedSize = readBits(sizeBits);
  const headerSize = Math.ceil(bitPos / 8);
  return { blockType, sizeFormat, regeneratedSize, compressedSize, numStreams, headerSize };
}

function readSequenceHeader(blockContent: Uint8Array, offset: number, size: number): SequenceHeaderInfo | null {
  if (size < 1 || offset >= blockContent.length) return null;
  let pos = offset;
  const end = offset + size;
  if (end > blockContent.length) return null;
  let numSequences = readByte(blockContent, pos);
  pos++;
  if (numSequences >= 128) {
    if (numSequences === 255) {
      if (pos + 2 > end) return null;
      numSequences = readByte(blockContent, pos) + (readByte(blockContent, pos + 1) << 8) + 0x7f00;
      pos += 2;
    } else {
      if (pos >= end) return null;
      numSequences = ((numSequences - 0x80) << 8) + readByte(blockContent, pos);
      pos++;
    }
  }
  if (numSequences === 0) {
    return { numSequences, llMode: 0, ofMode: 0, mlMode: 0 };
  }
  if (pos >= end) return null;
  const modesByte = readByte(blockContent, pos);
  return {
    numSequences,
    llMode: ((modesByte >> 6) & 3) as CompressionMode,
    ofMode: ((modesByte >> 4) & 3) as CompressionMode,
    mlMode: ((modesByte >> 2) & 3) as CompressionMode,
  };
}

function scanBlocks(compressed: Uint8Array): BlockScanRecord[] {
  let pos = parseFrameHeaderSize(compressed);
  const records: BlockScanRecord[] = [];
  let index = 0;
  while (pos + 3 <= compressed.length) {
    const block = parseBlockHeaderLocal(compressed, pos);
    pos += 3;
    if (block.blockType === 3) break;
    const record: BlockScanRecord = {
      index,
      blockType: block.blockType,
      blockSize: block.blockSize,
      lastBlock: block.lastBlock,
    };
    if (block.blockType === 2) {
      const blockContent = compressed.subarray(pos, pos + block.blockSize);
      const litHeader = parseLiteralsSectionHeaderLocal(blockContent, 0);
      const compressedSize = litHeader.compressedSize;
      let litBytesConsumed = 0;
      if (litHeader.blockType === 0) litBytesConsumed = litHeader.headerSize + litHeader.regeneratedSize;
      else if (litHeader.blockType === 1) litBytesConsumed = litHeader.headerSize + 1;
      else litBytesConsumed = litHeader.headerSize + (compressedSize ?? 0);
      const seqSize = block.blockSize - litBytesConsumed;
      const seqHeader = seqSize > 0 ? readSequenceHeader(blockContent, litBytesConsumed, seqSize) : null;
      record.literals = {
        blockType: litHeader.blockType,
        blockTypeName: literalsBlockTypeName(litHeader.blockType),
        numStreams: litHeader.numStreams,
        regeneratedSize: litHeader.regeneratedSize,
        compressedSize,
        headerSize: litHeader.headerSize,
      };
      if (seqHeader) {
        record.sequences = {
          ...seqHeader,
          llModeName: modeName(seqHeader.llMode),
          ofModeName: modeName(seqHeader.ofMode),
          mlModeName: modeName(seqHeader.mlMode),
        };
      }
    }
    records.push(record);
    pos += block.blockSize;
    index++;
    if (block.lastBlock) break;
  }
  return records;
}

function findFirstMismatch(expected: Uint8Array, actual: Uint8Array): { offset: number; chunkIndex: number } {
  const minLen = Math.min(expected.length, actual.length);
  const chunkCount = Math.ceil(minLen / CHUNK_SIZE);
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, minLen);
    const expectedChunk = expected.subarray(start, end);
    const actualChunk = actual.subarray(start, end);
    const eHash = createHash('sha256').update(expectedChunk).digest('hex');
    const aHash = createHash('sha256').update(actualChunk).digest('hex');
    if (eHash !== aHash) {
      for (let j = start; j < end; j++) {
        if (expected[j] !== actual[j]) {
          return { offset: j, chunkIndex: i };
        }
      }
      return { offset: start, chunkIndex: i };
    }
  }
  if (expected.length !== actual.length) {
    return { offset: minLen, chunkIndex: Math.floor(minLen / CHUNK_SIZE) };
  }
  return { offset: -1, chunkIndex: -1 };
}

function contextHex(data: Uint8Array, center: number, radius = 16): string {
  if (center < 0 || data.length === 0) return '';
  const start = Math.max(0, center - radius);
  const end = Math.min(data.length, center + radius);
  return Array.from(data.subarray(start, end))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join(' ');
}

function findTraceBlockAtOffset(blocks: DecodeTraceBlockInfo[], offset: number): DecodeTraceBlockInfo | null {
  for (const block of blocks) {
    if (offset >= block.outputStart && offset < block.outputEnd) {
      return block;
    }
  }
  return null;
}

function classifySuspects(block: DecodeTraceBlockInfo | null): string[] {
  if (!block) return ['Could not map mismatch offset to a decoded block'];
  const suspects: string[] = [];
  if (block.literals?.blockType === 3) {
    suspects.push('Treeless literals path (depends on previous Huffman table state)');
  }
  const seq = block.sequences;
  if (seq) {
    if (seq.llMode === 3 || seq.ofMode === 3 || seq.mlMode === 3) {
      suspects.push('Sequence repeat-mode table reuse path');
    }
    if (seq.llMode === 2 || seq.ofMode === 2 || seq.mlMode === 2) {
      suspects.push('FSE-compressed sequence tables path');
    }
    if (seq.repeatOffsetCandidateCount > 0) {
      suspects.push(`Repeat-offset execution path (${seq.repeatOffsetCandidateCount} candidate sequences)`);
    }
  }
  if (suspects.length === 0) {
    suspects.push('Compressed block sequence/literals execution path (non-raw, non-RLE)');
  }
  return suspects;
}

function formatBlockSummary(block: DecodeTraceBlockInfo | null): string {
  if (!block) return 'none';
  const lit = block.literals
    ? `lit=${literalsBlockTypeName(block.literals.blockType)} streams=${block.literals.numStreams}`
    : 'lit=n/a';
  const seq = block.sequences
    ? `seq=${block.sequences.numSequences} modes=${modeName(block.sequences.llMode)}/${modeName(block.sequences.ofMode)}/${modeName(block.sequences.mlMode)} repeatOffsetCandidates=${block.sequences.repeatOffsetCandidateCount}`
    : 'seq=n/a';
  return `index=${block.blockIndex} type=${block.blockType} size=${block.blockSize} out=[${block.outputStart},${block.outputEnd}) ${lit} ${seq}`;
}

export async function runNodeInteropDivergenceDebug(
  options: RunInteropDebugOptions,
): Promise<InteropDivergenceReport | null> {
  const decompress = await resolveDecompress();
  const passCompressed = nodeCompress(options.input, options.passLevel);
  const failCompressed = nodeCompress(options.input, options.failLevel);
  const passTraceBlocks: DecodeTraceBlockInfo[] = [];
  const failTraceBlocks: DecodeTraceBlockInfo[] = [];
  const passDecoded = decompress(passCompressed, {
    validateChecksum: false,
    debugTrace: {
      onBlockDecoded: (info: DecodeTraceBlockInfo) => passTraceBlocks.push(info),
    },
  });
  const failDecoded = decompress(failCompressed, {
    validateChecksum: false,
    debugTrace: {
      onBlockDecoded: (info: DecodeTraceBlockInfo) => failTraceBlocks.push(info),
    },
  });
  const mismatch = findFirstMismatch(passDecoded, failDecoded);
  if (mismatch.offset < 0) return null;
  const chunkStart = mismatch.chunkIndex * CHUNK_SIZE;
  const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, Math.min(passDecoded.length, failDecoded.length));
  const expectedChunkHash = createHash('sha256').update(passDecoded.subarray(chunkStart, chunkEnd)).digest('hex');
  const actualChunkHash = createHash('sha256').update(failDecoded.subarray(chunkStart, chunkEnd)).digest('hex');
  const passBlockAtMismatch = findTraceBlockAtOffset(passTraceBlocks, mismatch.offset);
  const failBlockAtMismatch = findTraceBlockAtOffset(failTraceBlocks, mismatch.offset);
  return {
    payloadId: options.payloadId,
    passLevel: options.passLevel,
    failLevel: options.failLevel,
    passCompressedBytes: passCompressed.length,
    failCompressedBytes: failCompressed.length,
    mismatchOffset: mismatch.offset,
    mismatchChunkIndex: mismatch.chunkIndex,
    expectedChunkHash,
    actualChunkHash,
    expectedContextHex: contextHex(passDecoded, mismatch.offset),
    actualContextHex: contextHex(failDecoded, mismatch.offset),
    failOutputLength: failDecoded.length,
    expectedOutputLength: passDecoded.length,
    passBlockAtMismatch,
    failBlockAtMismatch,
    passBlockScan: scanBlocks(passCompressed),
    failBlockScan: scanBlocks(failCompressed),
    suspectPaths: classifySuspects(failBlockAtMismatch),
  };
}

function summarizeScanWindow(scan: BlockScanRecord[], center: number): string {
  const start = Math.max(0, center - 2);
  const end = Math.min(scan.length, center + 3);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    const rec = scan[i];
    if (!rec) continue;
    const lit =
      rec.literals !== undefined
        ? `lit=${rec.literals.blockTypeName}/${rec.literals.numStreams} regen=${rec.literals.regeneratedSize} comp=${rec.literals.compressedSize ?? '-'}`
        : 'lit=n/a';
    const seq =
      rec.sequences !== undefined
        ? `seq=${rec.sequences.numSequences} modes=${rec.sequences.llModeName}/${rec.sequences.ofModeName}/${rec.sequences.mlModeName}`
        : 'seq=n/a';
    lines.push(`  #${rec.index} type=${rec.blockType} size=${rec.blockSize} ${lit} ${seq}`);
  }
  return lines.join('\n');
}

export function formatInteropDivergenceReport(report: InteropDivergenceReport): string {
  const failCenter = report.failBlockAtMismatch?.blockIndex ?? -1;
  const passCenter = report.passBlockAtMismatch?.blockIndex ?? -1;
  const parts: string[] = [];
  parts.push(`[interop-debug] ${report.payloadId} level ${report.passLevel} -> ${report.failLevel}`);
  parts.push(`[interop-debug] compressed bytes pass=${report.passCompressedBytes} fail=${report.failCompressedBytes}`);
  parts.push(
    `[interop-debug] mismatch offset=${report.mismatchOffset} chunk=${report.mismatchChunkIndex} passLen=${report.expectedOutputLength} failLen=${report.failOutputLength}`,
  );
  parts.push(`[interop-debug] chunk sha256 pass=${report.expectedChunkHash} fail=${report.actualChunkHash}`);
  parts.push(`[interop-debug] context pass=${report.expectedContextHex}`);
  parts.push(`[interop-debug] context fail=${report.actualContextHex}`);
  parts.push(`[interop-debug] pass block @ mismatch: ${formatBlockSummary(report.passBlockAtMismatch)}`);
  parts.push(`[interop-debug] fail block @ mismatch: ${formatBlockSummary(report.failBlockAtMismatch)}`);
  parts.push('[interop-debug] suspect paths:');
  for (const suspect of report.suspectPaths) {
    parts.push(`  - ${suspect}`);
  }
  if (passCenter >= 0) {
    parts.push('[interop-debug] pass block window:');
    parts.push(summarizeScanWindow(report.passBlockScan, passCenter));
  }
  if (failCenter >= 0) {
    parts.push('[interop-debug] fail block window:');
    parts.push(summarizeScanWindow(report.failBlockScan, failCenter));
  }
  return parts.join('\n');
}
