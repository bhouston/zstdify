import type { SpawnOptions } from 'node:child_process';
import type { DuplexOptions } from 'node:stream';

export interface CompressOpts {
  compLevel?: number;
  dictionary?: Buffer | { path: string };
  zstdOptions?: Array<string>;
  spawnOptions?: SpawnOptions;
  streamOptions?: DuplexOptions;
}

export interface DecompressOpts {
  dictionary?: Buffer | { path: string };
  zstdOptions?: Array<string>;
  spawnOptions?: SpawnOptions;
  streamOptions?: DuplexOptions;
}

export interface CreateDictionaryOpts {
  /** Training samples as file paths and/or in-memory buffers. */
  trainingFiles: (string | Buffer)[];
  maxDictSize?: number;
  zstdOptions?: string[];
  spawnOptions?: SpawnOptions;
}

export interface PoolOpts {
  compressQueueSize?: number;
  decompressQueueSize?: number;
  compressQueue?: CompressOpts;
  decompressQueue?: DecompressOpts;
}

export interface DictionaryObject {
  path: string;
}

export interface ZSTDOpts {
  spawnOptions?: object;
  streamOptions?: DuplexOptions;
  zstdOptions?: string[];
  dictionary?: DictionaryObject | Buffer;
}
