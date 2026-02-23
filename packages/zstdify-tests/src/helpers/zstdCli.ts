import { spawnSync } from 'node:child_process';
import { compressBuffer, decompressBuffer } from 'simple-zstd';

const LEVEL_FLAG_REGEX = /^-\d+$/;

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

export function zstdTrainDictionary(samplePaths: string[], dictPath: string, maxDictSize: number): void {
  const train = spawnSync('zstd', ['--train', ...samplePaths, `--maxdict=${maxDictSize}`, '-o', dictPath, '--quiet'], {
    encoding: null,
  });
  if (train.status !== 0) {
    throw new Error(`zstd dictionary training failed: ${train.stderr?.toString() ?? 'unknown error'}`);
  }
}

function parseArgs(args: string[]): {
  level?: number;
  dictionaryPath?: string;
  zstdOptions: string[];
} {
  const zstdOptions: string[] = [];
  let level: number | undefined;
  let dictionaryPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '-D') {
      const maybePath = args[i + 1];
      if (maybePath === undefined) {
        throw new Error('zstd args parse failed: missing dictionary path after -D');
      }
      dictionaryPath = maybePath;
      i++;
      continue;
    }
    if (arg === '-q' || arg === '-c' || arg === '-d') {
      continue;
    }
    if (LEVEL_FLAG_REGEX.test(arg)) {
      level = Number(arg.slice(1));
      continue;
    }
    zstdOptions.push(arg);
  }

  return { level, dictionaryPath, zstdOptions };
}

export async function zstdCompress(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const { level, dictionaryPath, zstdOptions } = parseArgs(args);
  try {
    const compressed = await compressBuffer(Buffer.from(input), level ?? 3, {
      dictionary: dictionaryPath ? { path: dictionaryPath } : undefined,
      zstdOptions,
    });
    return new Uint8Array(compressed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`zstd compress failed: ${message}`);
  }
}

export async function zstdDecompress(input: Uint8Array, args: string[] = []): Promise<Uint8Array> {
  const { dictionaryPath, zstdOptions } = parseArgs(args);
  try {
    const decompressed = await decompressBuffer(Buffer.from(input), {
      dictionary: dictionaryPath ? { path: dictionaryPath } : undefined,
      zstdOptions,
    });
    return new Uint8Array(decompressed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`zstd decompress failed: ${message}`);
  }
}

export async function zstdCompressWithDictionary(
  input: Uint8Array,
  dictionaryPath: string,
  level = 3,
): Promise<Uint8Array> {
  return zstdCompress(input, ['-D', dictionaryPath, `-${level}`, '--no-check']);
}

export async function zstdDecompressWithDictionary(input: Uint8Array, dictionaryPath: string): Promise<Uint8Array> {
  return zstdDecompress(input, ['-D', dictionaryPath]);
}
