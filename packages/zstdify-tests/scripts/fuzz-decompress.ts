#!/usr/bin/env node
/**
 * Decompress fuzz harness: read bytes from stdin (or file), call decompress(), exit 0.
 * Used with fuzzers or corpus: cat file.zst | node scripts/fuzz-decompress.ts
 * Crashes/hangs indicate bugs; thrown errors are caught and exit 0.
 */

import * as fs from 'node:fs';
import { decompress } from 'zstdify';

async function main(): Promise<void> {
  let input: Uint8Array;
  if (process.argv[2]) {
    input = new Uint8Array(fs.readFileSync(process.argv[2]));
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    input = new Uint8Array(Buffer.concat(chunks));
  }
  try {
    decompress(input);
  } catch {
    // Expected for invalid input; fuzzer cares about crashes/hangs only
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
