import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';

describe('CLI dictionary workflows', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('trains dictionary and round-trips with --dict', () => {
    const samplesDir = path.join(tempDir, 'samples');
    const inputPath = path.join(tempDir, 'input.txt');
    const dictPath = path.join(tempDir, 'trained.dict');
    const compressedPath = path.join(tempDir, 'output.zst');
    const restoredPath = path.join(tempDir, 'restored.txt');
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.writeFileSync(path.join(samplesDir, 'sample1.txt'), 'alpha beta gamma delta');
    fs.writeFileSync(path.join(samplesDir, 'sample2.txt'), 'header vertex texture normal index');
    fs.writeFileSync(path.join(samplesDir, 'sample3.txt'), 'offset match literal sequence table');
    fs.writeFileSync(inputPath, 'header vertex texture offset match literal sequence table');

    const train = runCli(['dict', 'train', dictPath, '--input', samplesDir, '--recursive', '--maxdict', '1024']);
    expect(train.exitCode).toBe(0);
    expect(fs.existsSync(dictPath)).toBe(true);

    const c = runCli(['compress', inputPath, compressedPath, '--dict', dictPath, '--dictID', '42']);
    expect(c.exitCode).toBe(0);
    expect(fs.existsSync(compressedPath)).toBe(true);

    const x = runCli(['extract', compressedPath, restoredPath, '--dict', dictPath, '--dictID', '42']);
    expect(x.exitCode).toBe(0);
    expect(fs.readFileSync(restoredPath, 'utf8')).toBe('header vertex texture offset match literal sequence table');
  });

  it('fails dictionary training when no sample files found', () => {
    const emptyDir = path.join(tempDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const dictPath = path.join(tempDir, 'trained.dict');
    const train = runCli(['dict', 'train', dictPath, '--input', emptyDir]);
    expect(train.exitCode).toBe(1);
    expect(train.stderr).toMatch(/no sample files/i);
  });
});
