#!/usr/bin/env node
/**
 * Benchmark/minify bundle sizes for zstdify and zstddec with Rollup.
 * Writes packages/zstdify-tests/benchmarks/bundle-size.latest.{json,md}.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

type SizeTriplet = {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
};

type BundleResult = {
  id: string;
  importCode: string;
  sizes: SizeTriplet;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');
const TMP_DIR = path.join(BENCH_DIR, '.bundle-size-tmp');
const require = createRequire(import.meta.url);
const zstddecEntryPath = require.resolve('zstddec');
const zstddecDistDir = path.dirname(zstddecEntryPath);
const zstddecModernPath = path.join(zstddecDistDir, 'zstddec.modern.js');
const ZSTDDEC_WASM_REGEX = /const wasm = '([A-Za-z0-9+/=]+)';/;

function measureBytes(content: Uint8Array | string): SizeTriplet {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  const gzip = zlib.gzipSync(buffer, { level: 9 });
  const brotli = zlib.brotliCompressSync(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  return {
    rawBytes: buffer.byteLength,
    gzipBytes: gzip.byteLength,
    brotliBytes: brotli.byteLength,
  };
}

async function bundleAndMeasure(id: string, importCode: string): Promise<BundleResult> {
  const entryPath = path.join(TMP_DIR, `${id}.entry.mjs`);
  fs.writeFileSync(entryPath, `${importCode}\n`);

  const bundle = await rollup({
    input: entryPath,
    treeshake: true,
    plugins: [nodeResolve({ browser: true, preferBuiltins: false }), commonjs()],
  });

  const output = await bundle.generate({
    format: 'esm',
    plugins: [terser()],
  });
  await bundle.close();

  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error(`No chunk generated for ${id}`);
  }

  return {
    id,
    importCode,
    sizes: measureBytes(chunk.code),
  };
}

function readZstddecEmbeddedWasm(): string {
  const content = fs.readFileSync(zstddecModernPath, 'utf8');
  const match = content.match(ZSTDDEC_WASM_REGEX);
  if (!match || !match[1]) {
    throw new Error('Could not locate embedded wasm blob in zstddec.modern.js');
  }
  return match[1];
}

function fmt(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

async function main(): Promise<void> {
  fs.mkdirSync(BENCH_DIR, { recursive: true });
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const bundleResults = await Promise.all([
    bundleAndMeasure(
      'zstdify-compress',
      "import { compress } from 'zstdify/compress';\nexport { compress };",
    ),
    bundleAndMeasure(
      'zstdify-decompress',
      "import { decompress } from 'zstdify/decompress';\nexport { decompress };",
    ),
    bundleAndMeasure(
      'zstddec-decoder',
      "import { ZSTDDecoder } from 'zstddec';\nexport { ZSTDDecoder };",
    ),
  ]);

  const zstddecModernCode = fs.readFileSync(zstddecModernPath, 'utf8');
  const zstddecModernSizes = measureBytes(zstddecModernCode);

  const zstddecWasmBase64 = readZstddecEmbeddedWasm();
  const zstddecWasmBytes = Buffer.from(zstddecWasmBase64, 'base64');
  const zstddecWasmSizes = measureBytes(zstddecWasmBytes);

  const summary = {
    version: 1,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    rollupBundles: bundleResults,
    zstddecPublished: {
      modernJsPath: 'zstddec/dist/zstddec.modern.js',
      modernJsSizes: zstddecModernSizes,
      embeddedWasmSizesDecoded: zstddecWasmSizes,
      combinedModernJsPlusDecodedWasm: {
        rawBytes: zstddecModernSizes.rawBytes + zstddecWasmSizes.rawBytes,
        gzipBytes: zstddecModernSizes.gzipBytes + zstddecWasmSizes.gzipBytes,
        brotliBytes: zstddecModernSizes.brotliBytes + zstddecWasmSizes.brotliBytes,
      },
    },
  };

  const jsonPath = path.join(BENCH_DIR, 'bundle-size.latest.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const zstdifyCompress = bundleResults.find((r) => r.id === 'zstdify-compress');
  const zstdifyDecompress = bundleResults.find((r) => r.id === 'zstdify-decompress');
  const zstddecDecoder = bundleResults.find((r) => r.id === 'zstddec-decoder');
  if (!zstdifyCompress || !zstdifyDecompress || !zstddecDecoder) {
    throw new Error('Missing expected bundle results');
  }

  const md = [
    '# Bundle size snapshot (Rollup + Terser)',
    '',
    `Generated: ${summary.timestamp} | Node: ${summary.nodeVersion}`,
    '',
    '## Rollup bundle comparison',
    '',
    '| Target | Raw | Gzip | Brotli |',
    '|---|---:|---:|---:|',
    `| zstdify/compress | ${fmt(zstdifyCompress.sizes.rawBytes)} | ${fmt(zstdifyCompress.sizes.gzipBytes)} | ${fmt(zstdifyCompress.sizes.brotliBytes)} |`,
    `| zstdify/decompress | ${fmt(zstdifyDecompress.sizes.rawBytes)} | ${fmt(zstdifyDecompress.sizes.gzipBytes)} | ${fmt(zstdifyDecompress.sizes.brotliBytes)} |`,
    `| zstddec decoder API | ${fmt(zstddecDecoder.sizes.rawBytes)} | ${fmt(zstddecDecoder.sizes.gzipBytes)} | ${fmt(zstddecDecoder.sizes.brotliBytes)} |`,
    '',
    '## zstddec published artifact detail',
    '',
    '| Artifact | Raw | Gzip | Brotli |',
    '|---|---:|---:|---:|',
    `| zstddec modern JS (published) | ${fmt(zstddecModernSizes.rawBytes)} | ${fmt(zstddecModernSizes.gzipBytes)} | ${fmt(zstddecModernSizes.brotliBytes)} |`,
    `| zstddec embedded wasm (decoded bytes) | ${fmt(zstddecWasmSizes.rawBytes)} | ${fmt(zstddecWasmSizes.gzipBytes)} | ${fmt(zstddecWasmSizes.brotliBytes)} |`,
    `| modern JS + decoded wasm (sum) | ${fmt(summary.zstddecPublished.combinedModernJsPlusDecodedWasm.rawBytes)} | ${fmt(summary.zstddecPublished.combinedModernJsPlusDecodedWasm.gzipBytes)} | ${fmt(summary.zstddecPublished.combinedModernJsPlusDecodedWasm.brotliBytes)} |`,
    '',
    'Notes:',
    '- `zstddec` embeds wasm as base64 in JS, so the Rollup bundle already includes it.',
    '- The decoded wasm row estimates the underlying wasm payload size separately for reference.',
    '',
  ].join('\n');

  const mdPath = path.join(BENCH_DIR, 'bundle-size.latest.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
