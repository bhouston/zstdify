import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFrameHeader } from '../frame/frameHeader.js';
import { parseBlockHeader } from './block.js';
import { parseLiteralsSectionHeader, decodeRawLiterals } from './literals.js';
import { executeSequences } from './reconstruct.js';
import { decodeSequences } from './sequences.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../../../zstdify-tests/fixtures/level1.zst');

describe('sequence internals (level1 fixture)', () => {
  it('decodes exact sequence tuple and reconstructs output length', () => {
    if (!fs.existsSync(fixturePath)) {
      console.warn(
        'Skipping: run "echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -c --no-check -1 > packages/zstdify-tests/fixtures/level1.zst"',
      );
      return;
    }

    const data = new Uint8Array(fs.readFileSync(fixturePath));
    const header = parseFrameHeader(data, 4);
    let pos = 4 + header.headerSize;
    const block = parseBlockHeader(data, pos);
    pos += 3;
    const blockContent = data.subarray(pos, pos + block.blockSize);

    const { header: litHeader, dataOffset } = parseLiteralsSectionHeader(blockContent, 0);
    expect(litHeader.blockType).toBe(0); // Raw literals for this fixture.
    const literals = decodeRawLiterals(blockContent, dataOffset, litHeader.regeneratedSize);
    const litBytesConsumed = litHeader.headerSize + litHeader.regeneratedSize;

    const seq = decodeSequences(blockContent, litBytesConsumed, block.blockSize - litBytesConsumed, null);
    expect(seq.sequences).toEqual([{ literalsLength: 12, offset: 15, matchLength: 108 }]);

    const output = executeSequences(literals, seq.sequences, header.windowSize, [1, 4, 8]);
    expect(output.length).toBe(120);
    expect(new TextDecoder().decode(output)).toBe(
      'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world ',
    );
  });
});
