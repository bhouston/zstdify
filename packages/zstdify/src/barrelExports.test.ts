import { describe, expect, it } from 'vitest';
import * as bitstream from './bitstream/index.js';
import * as entropy from './entropy/index.js';
import * as frame from './frame/index.js';
import * as root from './index.js';

describe('public barrel exports smoke', () => {
  it('exposes root API functions', () => {
    expect(typeof root.compress).toBe('function');
    expect(typeof root.decompress).toBe('function');
  });

  it('exposes bitstream helpers', () => {
    expect(typeof bitstream.BitReader).toBe('function');
    expect(typeof bitstream.BitWriter).toBe('function');
    expect(typeof bitstream.readU32LE).toBe('function');
    expect(typeof bitstream.encodeVarint).toBe('function');
  });

  it('exposes entropy and frame helpers', () => {
    expect(typeof entropy.buildFSEDecodeTable).toBe('function');
    expect(typeof entropy.buildHuffmanDecodeTable).toBe('function');
    expect(typeof frame.parseZstdFrame).toBe('function');
    expect(typeof frame.validateContentChecksum).toBe('function');
    expect(typeof frame.isSkippableFrame).toBe('function');
  });
});
