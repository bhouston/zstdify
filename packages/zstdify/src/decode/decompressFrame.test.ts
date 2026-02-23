import { describe, expect, it } from 'vitest';
import { BitWriter } from '../bitstream/bitWriter.js';
import { readU32LE } from '../bitstream/littleEndian.js';
import { compress } from '../compress.js';
import { writeRawBlock, writeRLEBlock } from '../encode/blockWriter.js';
import { writeFrameHeader } from '../encode/frameWriter.js';
import { computeContentChecksum32 } from '../frame/checksum.js';
import { parseZstdFrame } from '../frame/frameHeader.js';
import { decompressFrame } from './decompressFrame.js';

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function checksumBytes(data: Uint8Array): Uint8Array {
  const checksum = computeContentChecksum32(data);
  return new Uint8Array([checksum & 0xff, (checksum >>> 8) & 0xff, (checksum >>> 16) & 0xff, (checksum >>> 24) & 0xff]);
}

describe('decompressFrame', () => {
  it('decodes an RLE block path', () => {
    const expected = new Uint8Array(5);
    expected.fill(0x61);
    const frame = concatBytes(writeFrameHeader(expected.length, false), writeRLEBlock(0x61, expected.length, true));
    const { header } = parseZstdFrame(frame, 0);
    const result = decompressFrame(frame, 0, header);
    expect(result.output).toEqual(expected);
  });

  it('decodes compressed block with empty sequence section', () => {
    const literals = new TextEncoder().encode('abc');
    const literalsSection = concatBytes(new Uint8Array([(literals.length << 3) | 0]), literals);
    const compressedBlockHeader = new Uint8Array([0x25, 0x00, 0x00]); // last=1, type=2, size=4
    const frame = concatBytes(writeFrameHeader(literals.length, false), compressedBlockHeader, literalsSection);
    const { header } = parseZstdFrame(frame, 0);
    const result = decompressFrame(frame, 0, header);
    expect(result.output).toEqual(literals);
  });

  it('rejects truncated checksum and checksum mismatch', () => {
    const payload = new TextEncoder().encode('hello');
    const header = writeFrameHeader(payload.length, true);
    const rawBlock = writeRawBlock(payload, 0, payload.length, true);

    const truncated = concatBytes(header, rawBlock);
    const parsedTruncated = parseZstdFrame(truncated, 0).header;
    expect(() => decompressFrame(truncated, 0, parsedTruncated)).toThrowError(/checksum truncated/i);

    const validChecksum = checksumBytes(payload);
    const mismatch = concatBytes(header, rawBlock, validChecksum);
    const last = mismatch.length - 1;
    mismatch[last] = (mismatch[last] ?? 0) ^ 0xff;
    const parsedMismatch = parseZstdFrame(mismatch, 0).header;
    expect(() => decompressFrame(mismatch, 0, parsedMismatch)).toThrowError(/checksum mismatch/i);
    // When validateChecksum is false, wrong checksum is skipped and output is still returned
    const result = decompressFrame(mismatch, 0, parsedMismatch, undefined, undefined, false);
    expect(result.output).toEqual(payload);
    expect(result.bytesConsumed).toBe(mismatch.length);
  });

  it('rejects frame content-size mismatch', () => {
    const payload = new TextEncoder().encode('hello');
    const frame = concatBytes(
      writeFrameHeader(payload.length, false),
      writeRawBlock(payload, 0, payload.length - 1, true),
    );
    const { header } = parseZstdFrame(frame, 0);
    expect(() => decompressFrame(frame, 0, header)).toThrowError(/content size mismatch/i);
  });

  it('rejects when in-frame decompressed output exceeds maxSize', () => {
    const payload = new TextEncoder().encode('hello');
    const frame = concatBytes(writeFrameHeader(payload.length, false), writeRawBlock(payload, 0, payload.length, true));
    const { header } = parseZstdFrame(frame, 0);
    expect(() => decompressFrame(frame, 0, header, null, 4)).toThrowError(/maxSize/i);
  });

  it('rejects treeless literals when no previous Huffman table exists', () => {
    const writer = new BitWriter();
    writer.writeBits(2, 3); // blockType = treeless
    writer.writeBits(2, 0); // sizeFormat = 0 (10-bit fields)
    writer.writeBits(10, 1); // regeneratedSize
    writer.writeBits(10, 1); // compressedSize
    const literalsHeader = writer.flush();
    const blockContent = concatBytes(literalsHeader, new Uint8Array([0x00]));
    const blockHeaderWord = (blockContent.length << 3) | (2 << 1) | 1; // compressed block
    const blockHeader = new Uint8Array([
      blockHeaderWord & 0xff,
      (blockHeaderWord >>> 8) & 0xff,
      (blockHeaderWord >>> 16) & 0xff,
    ]);
    const frame = concatBytes(writeFrameHeader(1, false), blockHeader, blockContent);
    const { header } = parseZstdFrame(frame, 0);
    expect(() => decompressFrame(frame, 0, header)).toThrowError(/Treeless literals without previous Huffman table/i);
  });

  it('rejects truncated compressed blocks before block decode', () => {
    const blockHeader = new Uint8Array([0x15, 0x00, 0x00]); // last=1, type=2, size=2
    const frame = concatBytes(writeFrameHeader(1, false), blockHeader, new Uint8Array([0x00]));
    const { header } = parseZstdFrame(frame, 0);
    expect(() => decompressFrame(frame, 0, header)).toThrowError(/compressed block truncated/i);
  });

  it('reports consumed bytes including checksum bytes', () => {
    const payload = new TextEncoder().encode('world');
    const frame = concatBytes(
      writeFrameHeader(payload.length, true),
      writeRawBlock(payload, 0, payload.length, true),
      checksumBytes(payload),
    );
    const { header } = parseZstdFrame(frame, 0);
    const result = decompressFrame(frame, 0, header);
    const stored = readU32LE(frame, frame.length - 4);
    expect(stored).toBe(computeContentChecksum32(payload));
    expect(result.bytesConsumed).toBe(frame.length);
  });

  it('reusing decoder context does not change output', () => {
    const input = new TextEncoder().encode('lorem ipsum lorem ipsum lorem ipsum 1234567890 lorem ipsum');
    const frame = compress(input, { level: 6, checksum: true });
    const { header } = parseZstdFrame(frame, 0);
    const reuseContext = {};
    const first = decompressFrame(frame, 0, header, undefined, undefined, true, reuseContext);
    const second = decompressFrame(frame, 0, header, undefined, undefined, true, reuseContext);
    expect(first.output).toEqual(second.output);
    expect(first.bytesConsumed).toBe(second.bytesConsumed);
  });
});
