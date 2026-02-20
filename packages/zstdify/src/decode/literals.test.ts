import { describe, expect, it } from 'vitest';
import { BitWriter } from '../bitstream/bitWriter.js';
import { parseLiteralsSectionHeader } from './literals.js';

describe('literals header parsing', () => {
  it('parses compressed literals header with bit-accurate layout', () => {
    const writer = new BitWriter();
    writer.writeBits(2, 2); // blockType=Compressed
    writer.writeBits(2, 1); // sizeFormat=1 => 4 streams, 10-bit sizes
    writer.writeBits(10, 513); // regeneratedSize
    writer.writeBits(10, 700); // compressedSize
    const headerBytes = writer.flush();

    const { header, dataOffset } = parseLiteralsSectionHeader(headerBytes, 0);
    expect(header.blockType).toBe(2);
    expect(header.numStreams).toBe(4);
    expect(header.regeneratedSize).toBe(513);
    expect(header.compressedSize).toBe(700);
    expect(header.headerSize).toBe(3);
    expect(dataOffset).toBe(3);
  });
});
