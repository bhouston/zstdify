import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decompressBuffer } from './index.js';

const hasZstd = spawnSync('zstd', ['--version'], { encoding: 'utf8' }).status === 0;
const describeIfZstd = hasZstd ? describe : describe.skip;

describeIfZstd('decompressBuffer', () => {
  it('rejects dictionary-compressed input when dictionary is missing', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'simple-zstd-dict-'));
    try {
      const dictPath = join(tempRoot, 'raw-content.dict');
      writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = Buffer.from('alpha beta gamma');

      const compressedResult = spawnSync(
        'zstd',
        ['-q', '-c', '-D', dictPath, '-3', '--no-check'],
        { input: payload },
      );
      expect(compressedResult.status).toBe(0);
      const compressed = compressedResult.stdout;
      expect(Buffer.isBuffer(compressed)).toBe(true);
      expect(compressed.length).toBeGreaterThan(0);

      const baselineDecode = spawnSync('zstd', ['-q', '-d', '-c'], { input: compressed });
      expect(baselineDecode.status).not.toBe(0);

      await expect(decompressBuffer(compressed)).rejects.toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('still decompresses successfully when dictionary is provided', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'simple-zstd-dict-'));
    try {
      const dictPath = join(tempRoot, 'raw-content.dict');
      writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = Buffer.from('alpha beta gamma');

      const compressedResult = spawnSync(
        'zstd',
        ['-q', '-c', '-D', dictPath, '-3', '--no-check'],
        { input: payload },
      );
      expect(compressedResult.status).toBe(0);
      const compressed = compressedResult.stdout;

      const decoded = await decompressBuffer(compressed, {
        dictionary: { path: dictPath },
      });
      expect(Buffer.from(decoded)).toEqual(payload);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
