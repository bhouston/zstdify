import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';
import { hasZstdCli, zstdDecompress, zstdCompress } from '../helpers/zstdCli.js';

describe('CLI round-trip', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('round-trips: zstdify compress then zstdify extract', () => {
    const inputPath = path.join(tempDir, 'in.bin');
    const compressedPath = path.join(tempDir, 'out.zst');
    const outputPath = path.join(tempDir, 'restored.bin');
    const data = new TextEncoder().encode('hello world round-trip');
    fs.writeFileSync(inputPath, data);

    const r1 = runCli(['compress', inputPath, compressedPath]);
    expect(r1.exitCode).toBe(0);

    const r2 = runCli(['extract', compressedPath, outputPath]);
    expect(r2.exitCode).toBe(0);

    const restored = new Uint8Array(fs.readFileSync(outputPath));
    expect(restored).toEqual(data);
  });

  it('round-trips with --level and --checksum', () => {
    const inputPath = path.join(tempDir, 'in.bin');
    const compressedPath = path.join(tempDir, 'out.zst');
    const outputPath = path.join(tempDir, 'restored.bin');
    const data = new Uint8Array(1024);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    fs.writeFileSync(inputPath, data);

    const r1 = runCli(['compress', inputPath, compressedPath, '--level', '3', '--checksum']);
    expect(r1.exitCode).toBe(0);

    const r2 = runCli(['extract', compressedPath, outputPath]);
    expect(r2.exitCode).toBe(0);

    expect(new Uint8Array(fs.readFileSync(outputPath))).toEqual(data);
  });
});

const hasZstd = hasZstdCli();
const describeIfZstd = hasZstd ? describe : describe.skip;

describeIfZstd('CLI round-trip with zstd CLI', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('zstd CLI decodes output from zstdify compress', () => {
    const inputPath = path.join(tempDir, 'in.bin');
    const compressedPath = path.join(tempDir, 'out.zst');
    const data = new TextEncoder().encode('zstd interop from cli');
    fs.writeFileSync(inputPath, data);

    const result = runCli(['compress', inputPath, compressedPath]);
    expect(result.exitCode).toBe(0);

    const compressed = new Uint8Array(fs.readFileSync(compressedPath));
    const decoded = zstdDecompress(compressed);
    expect(decoded).toEqual(data);
  });

  it('zstdify extract decodes output from zstd CLI', () => {
    const inputPath = path.join(tempDir, 'in.bin');
    const compressedPath = path.join(tempDir, 'out.zst');
    const outputPath = path.join(tempDir, 'restored.bin');
    const data = new TextEncoder().encode('zstd compress then zstdify extract');
    fs.writeFileSync(inputPath, data);

    const compressed = zstdCompress(data);
    fs.writeFileSync(compressedPath, compressed);

    const result = runCli(['extract', compressedPath, outputPath]);
    expect(result.exitCode).toBe(0);

    const restored = new Uint8Array(fs.readFileSync(outputPath));
    expect(restored).toEqual(data);
  });
});
