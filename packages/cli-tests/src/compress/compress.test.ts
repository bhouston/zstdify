import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';

describe('CLI compress command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('compresses a file with default options', () => {
    const input = path.join(tempDir, 'in.bin');
    const output = path.join(tempDir, 'out.zst');
    const data = new TextEncoder().encode('hello world');
    fs.writeFileSync(input, data);

    const result = runCli(['compress', input, output]);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const compressed = new Uint8Array(fs.readFileSync(output));
    const restored = decompress(compressed);
    expect(restored).toEqual(data);
  });

  it('compresses with --level 0', () => {
    const input = path.join(tempDir, 'in.bin');
    const output = path.join(tempDir, 'out.zst');
    const data = new TextEncoder().encode('raw block test');
    fs.writeFileSync(input, data);

    const result = runCli(['compress', input, output, '--level', '0']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const restored = decompress(new Uint8Array(fs.readFileSync(output)));
    expect(restored).toEqual(data);
  });

  it('compresses with --level 3', () => {
    const input = path.join(tempDir, 'in.bin');
    const output = path.join(tempDir, 'out.zst');
    const data = new TextEncoder().encode('abcdabcdabcdabcd');
    fs.writeFileSync(input, data);

    const result = runCli(['compress', input, output, '--level', '3']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const restored = decompress(new Uint8Array(fs.readFileSync(output)));
    expect(restored).toEqual(data);
  });

  it('compresses with --checksum', () => {
    const input = path.join(tempDir, 'in.bin');
    const output = path.join(tempDir, 'out.zst');
    const data = new TextEncoder().encode('checksum payload');
    fs.writeFileSync(input, data);

    const result = runCli(['compress', input, output, '--checksum']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const restored = decompress(new Uint8Array(fs.readFileSync(output)));
    expect(restored).toEqual(data);
  });

  it('accepts alias c for compress', () => {
    const input = path.join(tempDir, 'in.bin');
    const output = path.join(tempDir, 'out.zst');
    fs.writeFileSync(input, new Uint8Array([1, 2, 3]));

    const result = runCli(['c', input, output]);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
  });

  describe('error cases', () => {
    it('fails when input file does not exist', () => {
      const output = path.join(tempDir, 'out.zst');
      const result = runCli(['compress', '/nonexistent/in.bin', output]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });
  });
});
