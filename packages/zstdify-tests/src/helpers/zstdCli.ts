import { spawnSync } from 'node:child_process';

export function hasZstdCli(): boolean {
  const result = spawnSync('zstd', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

export function requireZstdCli(): void {
  if (!hasZstdCli()) {
    throw new Error(
      'zstd CLI is required for interop/differential tests. Please install zstd and ensure it is available on PATH.',
    );
  }
}

export function zstdCompress(input: Uint8Array, args: string[]): Uint8Array {
  const result = spawnSync('zstd', ['-q', '-c', ...args], {
    input: Buffer.from(input),
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(`zstd compress failed: ${result.stderr?.toString() ?? 'unknown error'}`);
  }
  return new Uint8Array(result.stdout);
}

export function zstdDecompress(input: Uint8Array, args: string[] = []): Uint8Array {
  const result = spawnSync('zstd', ['-q', '-d', '-c', ...args], {
    input: Buffer.from(input),
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(`zstd decompress failed: ${result.stderr?.toString() ?? 'unknown error'}`);
  }
  return new Uint8Array(result.stdout);
}
