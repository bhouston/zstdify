import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compress } from 'zstdify';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';

describe('CLI extract command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('extracts a file produced by zstdify compress', () => {
    const original = new TextEncoder().encode('round-trip content');
    const compressedPath = path.join(tempDir, 'in.zst');
    const outputPath = path.join(tempDir, 'out.bin');
    fs.writeFileSync(compressedPath, compress(original));

    const result = runCli(['extract', compressedPath, outputPath]);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
    const restored = new Uint8Array(fs.readFileSync(outputPath));
    expect(restored).toEqual(original);
  });

  it('accepts alias x for extract', () => {
    const original = new Uint8Array([10, 20, 30]);
    const compressedPath = path.join(tempDir, 'in.zst');
    const outputPath = path.join(tempDir, 'out.bin');
    fs.writeFileSync(compressedPath, compress(original));

    const result = runCli(['x', compressedPath, outputPath]);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(new Uint8Array(fs.readFileSync(outputPath))).toEqual(original);
  });

  describe('error cases', () => {
    it('fails when input file does not exist', () => {
      const output = path.join(tempDir, 'out.bin');
      const result = runCli(['extract', '/nonexistent/in.zst', output]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('fails when input is not valid zstd', () => {
      const invalidPath = path.join(tempDir, 'invalid.zst');
      const outputPath = path.join(tempDir, 'out.bin');
      fs.writeFileSync(invalidPath, new Uint8Array([1, 2, 3, 4, 5]));

      const result = runCli(['extract', invalidPath, outputPath]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/error|decompress|corrupt/i);
    });
  });
});
