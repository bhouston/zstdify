import { execFile, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Duplex, PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Debug from 'debug';
import isZst from 'is-zst';

const debug = Debug('SimpleZSTD');

import BufferWritable from './buffer-writable';
import PeekPassThrough from './peek-transform';
import ProcessDuplex from './process-duplex';
import ProcessQueue from './process-queue';
import type { CreateDictionaryOpts, PoolOpts, ZSTDOpts } from './types';

// Export types for consumers
export type {
  CompressOpts,
  CreateDictionaryOpts,
  DecompressOpts,
  DictionaryObject,
  PoolOpts,
  ZSTDOpts,
} from './types';

// Dictionary cache: one temp dir per cached buffer, single file inside for simple cleanup
type DictionaryCacheEntry = {
  dirPath: string;
  refCount: number;
  deleteCleanup: () => Promise<void>;
};
const dictionaryCache = new Map<string, DictionaryCacheEntry>();

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function getCachedDictionaryPath(dictionary: Buffer): Promise<{ path: string; cleanup: () => void }> {
  const hash = hashBuffer(dictionary);

  const cached = dictionaryCache.get(hash);
  if (cached) {
    cached.refCount++;
    debug(`Dictionary cache hit: ${hash.slice(0, 8)}... (refCount: ${cached.refCount})`);
    return {
      path: join(cached.dirPath, 'dict'),
      cleanup: () => {
        if (cached) {
          cached.refCount--;
          debug(`Dictionary refCount decreased: ${hash.slice(0, 8)}... (refCount: ${cached.refCount})`);
        }
      },
    };
  }

  debug(`Dictionary cache miss: ${hash.slice(0, 8)}... - creating temp dir`);
  const dirPath = await mkdtemp(join(tmpdir(), 'zstd-dict-'));
  await writeFile(join(dirPath, 'dict'), dictionary);

  const entry: DictionaryCacheEntry = {
    dirPath,
    refCount: 1,
    deleteCleanup: () => rm(dirPath, { recursive: true, force: true }),
  };
  dictionaryCache.set(hash, entry);

  return {
    path: join(dirPath, 'dict'),
    cleanup: () => {
      const c = dictionaryCache.get(hash);
      if (c) {
        c.refCount--;
        debug(`Dictionary refCount decreased: ${hash.slice(0, 8)}... (refCount: ${c.refCount})`);
      }
    },
  };
}

/**
 * Clear the dictionary cache and cleanup all temporary directories
 * This is useful for testing or manual cache management
 * @returns Promise that resolves when all cleanups are complete
 */
export async function clearDictionaryCache(): Promise<void> {
  debug('Clearing dictionary cache');
  const cleanupPromises: Promise<void>[] = [];

  for (const [hash, cached] of dictionaryCache.entries()) {
    debug(`Cleaning up cached dictionary: ${hash.slice(0, 8)}...`);
    cleanupPromises.push(cached.deleteCleanup());
  }

  await Promise.all(cleanupPromises);
  dictionaryCache.clear();
}

const find = process.platform === 'win32' ? 'where zstd.exe' : 'which zstd';

let bin: string;

try {
  bin = execSync(find, { env: process.env }).toString().replace(/\n$/, '').replace(/\r$/, '');
  debug(bin);
} catch {
  throw new Error('Can not access zstd! Is it installed?');
}

try {
  fs.accessSync(bin, fs.constants.X_OK);
} catch {
  throw new Error('zstd is not executable');
}

async function CreateCompressStream(compLevel: number, opts: ZSTDOpts): Promise<Duplex> {
  let lvl = compLevel;
  let zo = opts.zstdOptions || [];
  let path: string | null = null;
  let cleanup: () => void = () => null;

  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  // Dictionary
  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    // Use cached dictionary to avoid recreating temp files
    ({ path, cleanup } = await getCachedDictionaryPath(opts.dictionary));
    zo = [...zo, '-D', `${path}`];
  }

  let c: Duplex;

  try {
    debug(bin, ['-zc', `-${lvl}`, ...zo], opts.spawnOptions, opts.streamOptions);
    c = new ProcessDuplex(bin, ['-zc', `-${lvl}`, ...zo], opts.spawnOptions, opts.streamOptions);
  } catch (err) {
    // cleanup if error;
    cleanup();
    throw err;
  }

  c.on('exit', (code: number, signal) => {
    debug('c exit', code, signal);
    if (code !== 0) {
      setImmediate(() => {
        c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      });
    }
    cleanup();
  });

  return c;
}

function CompressBuffer(buffer: Buffer, c: Duplex): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable({});

    c.once('close', () => {
      setImmediate(() => {
        const result = w.getBuffer();
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Compression failed'));
        }
      });
    });

    pipeline(Readable.from(buffer), c, w)
      .then(() => {
        c.destroy();
      })
      .catch((err: Error) => {
        reject(err);
        c.destroy();
      });
  });
}

async function CreateDecompressStream(opts: ZSTDOpts): Promise<Duplex> {
  // Dictionary
  let zo = opts.zstdOptions || [];
  let path: string | null = null;
  let cleanup: () => void = () => null;

  let terminate = false;

  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    // Use cached dictionary to avoid recreating temp files
    ({ path, cleanup } = await getCachedDictionaryPath(opts.dictionary));
    zo = [...zo, '-D', `${path}`];
  }

  let d: Duplex;

  try {
    debug(bin, ['-dc', ...zo], opts.spawnOptions, opts.streamOptions);
    d = new ProcessDuplex(bin, ['-dc', ...zo], opts.spawnOptions, opts.streamOptions);
  } catch (err) {
    // cleanup if error
    cleanup();
    throw err;
  }

  let wrapper: PeekPassThrough | null = null;

  d.on('exit', (code: number, signal) => {
    debug('d exit', code, signal);
    if (wrapper) {
      wrapper.emit('exit', code, signal);
    }
    if (code !== 0 && !terminate) {
      setImmediate(() => {
        const error = new Error(`zstd exited non zero. code: ${code} signal: ${signal}`);
        if (wrapper && !wrapper.destroyed) {
          wrapper.destroy(error);
        } else if (!d.destroyed) {
          d.destroy(error);
        }
      });
    }
    cleanup();
  });

  wrapper = new PeekPassThrough({ maxBuffer: 10 }, (data: Buffer, swap) => {
    if (isZst(data)) {
      swap(null, d);
    } else {
      debug('not zstd');
      terminate = true;
      d.end();
      swap(null, new PassThrough());
    }
  });

  d.once('error', (err: unknown) => {
    if (wrapper && !wrapper.destroyed) {
      wrapper.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return wrapper;
}

function DecompressBuffer(buffer: Buffer, d: Duplex): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable({});
    const stderrChunks: string[] = [];

    const resolveOnce = (value: Buffer) => {
      resolve(value);
    };

    const rejectOnce = (error: Error) => {
      reject(error);
    };

    d.once('error', (err: unknown) => {
      rejectOnce(err instanceof Error ? err : new Error(String(err)));
    });

    d.on('stderr', (chunk: unknown) => {
      stderrChunks.push(String(chunk));
    });

    d.once('close', () => {
      setImmediate(() => {
        const stderrOutput = stderrChunks.join('').trim();
        if (stderrOutput.length > 0) {
          rejectOnce(new Error(stderrOutput));
        } else {
          resolveOnce(w.getBuffer() || Buffer.alloc(0));
        }
      });
    });

    pipeline(Readable.from(buffer), d, w)
      .then(() => {})
      .catch((err: Error) => {
        rejectOnce(err);
        d.destroy();
      });
  });
}

// Standalone Functions

export function compress(compLevel: number, opts: ZSTDOpts = {}): Promise<Duplex> {
  return CreateCompressStream(compLevel, opts);
}

export async function compressBuffer(buffer: Buffer, compLevel: number, opts: ZSTDOpts = {}): Promise<Buffer> {
  const c = await CreateCompressStream(compLevel, opts);
  return CompressBuffer(buffer, c);
}

export function decompress(opts: ZSTDOpts = {}): Promise<Duplex> {
  return CreateDecompressStream(opts);
}

export async function decompressBuffer(buffer: Buffer, opts: ZSTDOpts = {}): Promise<Buffer> {
  let zo = opts.zstdOptions || [];
  let path: string | null = null;
  let cleanup: () => void = () => null;

  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    ({ path, cleanup } = await getCachedDictionaryPath(opts.dictionary));
    zo = [...zo, '-D', `${path}`];
  }

  return new Promise((resolve, reject) => {
    const execOptions = {
      ...(opts.spawnOptions as Record<string, unknown> | undefined),
      encoding: 'buffer',
    } as Record<string, unknown>;

    debug(bin, ['-dc', ...zo], execOptions);
    const child = execFile(
      bin,
      ['-dc', ...zo],
      execOptions as never,
      (error, stdout: string | Buffer, stderr: string | Buffer) => {
        cleanup();
        if (error) {
          const code = typeof error.code === 'number' ? error.code : null;
          const signal = error.signal ?? null;
          const stderrMessage = (Buffer.isBuffer(stderr) ? stderr.toString() : String(stderr || '')).trim();
          const message = stderrMessage
            ? `zstd exited non zero. code: ${code} signal: ${signal}: ${stderrMessage}`
            : `zstd exited non zero. code: ${code} signal: ${signal}`;
          reject(new Error(message));
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );

    if (!child.stdin) {
      cleanup();
      reject(new Error('zstd stdin is not available'));
      return;
    }
    child.stdin.end(buffer);
  });
}

export async function createDictionary(opts: CreateDictionaryOpts): Promise<Buffer> {
  if (!Array.isArray(opts.trainingFiles) || opts.trainingFiles.length === 0) {
    throw new Error('createDictionary requires at least one training file');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'zstd-train-'));
  const trainingPaths: string[] = [];

  try {
    const writePromises: Promise<void>[] = [];
    for (let i = 0; i < opts.trainingFiles.length; i++) {
      const item = opts.trainingFiles[i];
      if (item === undefined) {
        throw new Error('createDictionary trainingFiles may not contain undefined');
      }
      if (typeof item === 'string') {
        trainingPaths.push(item);
      } else {
        const samplePath = join(tempDir, `sample-${i}`);
        trainingPaths.push(samplePath);
        writePromises.push(writeFile(samplePath, item));
      }
    }
    await Promise.all(writePromises);

    const outputPath = join(tempDir, 'dict');

    const args = ['--train', ...trainingPaths, '-o', outputPath];

    if (opts.maxDictSize && opts.maxDictSize > 0) {
      args.push(`--maxdict=${opts.maxDictSize}`);
    }

    if (opts.zstdOptions?.length) {
      args.push(...opts.zstdOptions);
    }

    await new Promise<void>((resolve, reject) => {
      debug(bin, args, opts.spawnOptions);
      execFile(bin, args, opts.spawnOptions ?? {}, (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }

        const code = typeof error.code === 'number' ? error.code : null;
        const signal = error.signal ?? null;
        const stdErrMessage = stderr?.toString().trim();
        const errorMessage = stdErrMessage
          ? `zstd dictionary training failed (code: ${code}, signal: ${signal}): ${stdErrMessage}`
          : `zstd dictionary training failed (code: ${code}, signal: ${signal})`;

        reject(new Error(errorMessage));
      });
    });

    return readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// SimpleZSTD Class
export class SimpleZSTD {
  #compressQueue!: ProcessQueue<Duplex>;
  #decompressQueue!: ProcessQueue<Duplex>;
  #tempDir: string | null = null;
  #ready;
  #poolOptions?: PoolOpts;

  private constructor(poolOptions?: PoolOpts) {
    debug('constructor', poolOptions);
    this.#poolOptions = poolOptions;

    this.#ready = new Promise((resolve, reject) => {
      (async () => {
        try {
          const compressDict = poolOptions?.compressQueue?.dictionary;
          const decompressDict = poolOptions?.decompressQueue?.dictionary;
          const needsTempDir =
            (compressDict && Buffer.isBuffer(compressDict)) || (decompressDict && Buffer.isBuffer(decompressDict));

          let compressDictPath: string | undefined;
          let decompressDictPath: string | undefined;

          if (needsTempDir) {
            this.#tempDir = await mkdtemp(join(tmpdir(), 'zstd-pool-'));
            if (compressDict && Buffer.isBuffer(compressDict)) {
              const p = join(this.#tempDir, 'compress.dict');
              await writeFile(p, compressDict);
              compressDictPath = p;
            }
            if (decompressDict && Buffer.isBuffer(decompressDict)) {
              const p = join(this.#tempDir, 'decompress.dict');
              await writeFile(p, decompressDict);
              decompressDictPath = p;
            }
          } else {
            if (compressDict && 'path' in compressDict) {
              compressDictPath = compressDict.path;
            }
            if (decompressDict && 'path' in decompressDict) {
              decompressDictPath = decompressDict.path;
            }
          }

          this.#compressQueue = new ProcessQueue(
            poolOptions?.compressQueueSize || 0,
            () => {
              debug('compress factory');
              return CreateCompressStream(poolOptions?.compressQueue?.compLevel || 3, {
                ...poolOptions?.compressQueue,
                dictionary: compressDictPath ? { path: compressDictPath } : undefined,
              });
            },
            async (p: Promise<Duplex>) => {
              debug('compress cleanup');
              const stream = await p;
              await new Promise<void>((onStreamClose) => {
                if (stream.destroyed) {
                  onStreamClose();
                } else {
                  stream.once('close', () => onStreamClose());
                  stream.destroy();
                }
              });
            },
          );

          this.#decompressQueue = new ProcessQueue(
            poolOptions?.decompressQueueSize || 0,
            () => {
              debug('decompress factory');
              return CreateDecompressStream({
                ...poolOptions?.decompressQueue,
                dictionary: decompressDictPath ? { path: decompressDictPath } : undefined,
              });
            },
            async (p: Promise<Duplex>) => {
              debug('decompress cleanup');
              const stream = await p;
              await new Promise<void>((onStreamClose) => {
                if (stream.destroyed) {
                  onStreamClose();
                } else {
                  stream.once('close', () => onStreamClose());
                  stream.destroy();
                }
              });
            },
          );

          debug('READY');
          resolve(null);
        } catch (err) {
          reject(err);
        }
      })().catch(reject);
    }).catch(async (err) => {
      debug('ready error', err);
      if (this.#tempDir !== null) {
        await rm(this.#tempDir, { recursive: true, force: true });
        this.#tempDir = null;
      }
    });
  }

  /**
   * Create a new SimpleZSTD instance with process pooling
   * @param poolOptions - Configuration for compression and decompression process pools
   * @returns Promise resolving to initialized SimpleZSTD instance
   */
  static async create(poolOptions?: PoolOpts): Promise<SimpleZSTD> {
    const instance = new SimpleZSTD(poolOptions);
    await instance.#ready;
    return instance;
  }

  get queueStats() {
    return {
      compress: {
        hits: this.#compressQueue.hits,
        misses: this.#compressQueue.misses,
      },
      decompress: {
        hits: this.#decompressQueue.hits,
        misses: this.#decompressQueue.misses,
      },
    };
  }

  async destroy() {
    await Promise.all([this.#compressQueue.destroy(), this.#decompressQueue.destroy()]);
    if (this.#tempDir !== null) {
      await rm(this.#tempDir, { recursive: true, force: true });
      this.#tempDir = null;
    }
  }

  /**
   * Get a compression stream from the pool, or create a one-off stream with custom compression level
   * @param compLevel - Optional compression level (1-22). If provided, creates a new stream instead of using the pool
   * @returns Promise resolving to a Duplex compression stream
   */
  async compress(compLevel?: number): Promise<Duplex> {
    await this.#ready;

    // If custom compression level is provided, create a one-off stream
    if (compLevel !== undefined) {
      return CreateCompressStream(compLevel, {
        ...this.#poolOptions?.compressQueue,
      });
    }

    // Otherwise, acquire from pool
    return this.#compressQueue.acquire();
  }

  /**
   * Compress a buffer using the pool, or with a custom compression level
   * @param buffer - Buffer to compress
   * @param compLevel - Optional compression level (1-22). If provided, uses this level instead of pool default
   * @returns Promise resolving to compressed buffer
   */
  async compressBuffer(buffer: Buffer, compLevel?: number): Promise<Buffer> {
    await this.#ready;
    const c = await this.compress(compLevel);
    return CompressBuffer(buffer, c);
  }

  async decompress(): Promise<Duplex> {
    await this.#ready;
    return this.#decompressQueue.acquire();
  }

  async decompressBuffer(buffer: Buffer): Promise<Buffer> {
    await this.#ready;
    const d = await this.#decompressQueue.acquire();
    return DecompressBuffer(buffer, d);
  }
}

// module.exports = {
//   SimpleZSTD,
//   compress,
//   compressBuffer,
//   decompress,
//   decompressBuffer,
// };
