import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireZstdCli, zstdCompress, zstdDecompress } from '../helpers/zstdCli.js';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';

function runZstdTrain(dictPath: string, samplePaths: string[]): void {
  const train = spawnSync('zstd', ['--train', ...samplePaths, '--maxdict=2048', '-o', dictPath, '--quiet'], {
    encoding: null,
  });
  if (train.status !== 0) {
    throw new Error(`zstd dictionary training failed: ${train.stderr?.toString() ?? 'unknown error'}`);
  }
}

function writeSamples(dir: string): string[] {
  const sampleTexts = [
    'alpha beta gamma delta epsilon',
    'header vertex texture normal index tangent bitangent',
    'offset match literal sequence table repeat mode huffman fse decode',
    'typescript package workspace monorepo vitest biome lint check',
    'mesh primitive material shader pipeline render scene graph transform',
    'packet stream frame header footer checksum block entropy symbols',
    'browser node runtime buffer array uint8array encoder decoder api',
    'compressor dictionary training corpus repeated tokens phrase phrase phrase',
  ];
  return sampleTexts.map((text, index) => {
    const samplePath = path.join(dir, `sample-${index}.txt`);
    fs.writeFileSync(samplePath, text);
    return samplePath;
  });
}

describe('CLI dictionary differential interop', () => {
  requireZstdCli();
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('zstd-trained dictionary: zstd -> zstdify-cli and zstdify-cli -> zstd', () => {
    const samplesDir = path.join(tempDir, 'samples-zstd');
    fs.mkdirSync(samplesDir, { recursive: true });
    const samplePaths = writeSamples(samplesDir);
    const dictPath = path.join(tempDir, 'zstd-trained.dict');
    runZstdTrain(dictPath, samplePaths);

    const payload = new TextEncoder().encode('header vertex texture offset match literal sequence table');
    const compressedByZstd = zstdCompress(payload, ['-D', dictPath, '--no-check']);

    const fromZstdPath = path.join(tempDir, 'from-zstd.zst');
    const extractedByCliPath = path.join(tempDir, 'from-zstd.restored.txt');
    fs.writeFileSync(fromZstdPath, compressedByZstd);
    const cliExtract = runCli(['extract', fromZstdPath, extractedByCliPath, '--dict', dictPath]);
    expect(cliExtract.exitCode).toBe(0);
    expect(new Uint8Array(fs.readFileSync(extractedByCliPath))).toEqual(payload);

    const inputPath = path.join(tempDir, 'cli-input.txt');
    const cliCompressedPath = path.join(tempDir, 'cli-out.zst');
    fs.writeFileSync(inputPath, payload);
    const cliCompress = runCli(['compress', inputPath, cliCompressedPath, '--dict', dictPath]);
    expect(cliCompress.exitCode).toBe(0);
    const decodedByZstd = zstdDecompress(new Uint8Array(fs.readFileSync(cliCompressedPath)), ['-D', dictPath]);
    expect(decodedByZstd).toEqual(payload);
  });

  it('zstdify-trained dictionary: zstd -> zstdify-cli and zstdify-cli -> zstd', () => {
    const samplesDir = path.join(tempDir, 'samples-zstdify');
    fs.mkdirSync(samplesDir, { recursive: true });
    writeSamples(samplesDir);
    const dictPath = path.join(tempDir, 'zstdify-trained.dict');

    const cliTrain = runCli(['dict', 'train', dictPath, '--input', samplesDir, '--recursive', '--maxdict', '2048']);
    expect(cliTrain.exitCode).toBe(0);
    expect(fs.existsSync(dictPath)).toBe(true);

    const payload = new TextEncoder().encode('alpha beta gamma header vertex texture normal index');
    const compressedByZstd = zstdCompress(payload, ['-D', dictPath, '--no-check']);

    const fromZstdPath = path.join(tempDir, 'from-zstdify-dict.zst');
    const extractedByCliPath = path.join(tempDir, 'from-zstdify-dict.restored.txt');
    fs.writeFileSync(fromZstdPath, compressedByZstd);
    const cliExtract = runCli(['extract', fromZstdPath, extractedByCliPath, '--dict', dictPath]);
    expect(cliExtract.exitCode).toBe(0);
    expect(new Uint8Array(fs.readFileSync(extractedByCliPath))).toEqual(payload);

    const inputPath = path.join(tempDir, 'cli-input-zstdify-dict.txt');
    const cliCompressedPath = path.join(tempDir, 'cli-zstdify-dict-out.zst');
    fs.writeFileSync(inputPath, payload);
    const cliCompress = runCli(['compress', inputPath, cliCompressedPath, '--dict', dictPath]);
    expect(cliCompress.exitCode).toBe(0);
    const decodedByZstd = zstdDecompress(new Uint8Array(fs.readFileSync(cliCompressedPath)), ['-D', dictPath]);
    expect(decodedByZstd).toEqual(payload);
  });
});
