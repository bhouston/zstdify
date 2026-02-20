import * as fs from 'node:fs';
import * as path from 'node:path';
import { compress } from 'zstdify';
import { defineCommand } from 'yargs-file-commands';

export const command = defineCommand({
  command: 'compress <input> <output>',
  describe: 'Compress a file with zstd',
  aliases: ['c'],
  builder: (yargs) =>
    yargs
      .positional('input', {
        describe: 'Input file path',
        type: 'string',
        demandOption: true,
      })
      .positional('output', {
        describe: 'Output file path (.zst or any)',
        type: 'string',
        demandOption: true,
      })
      .option('level', {
        describe: 'Compression level (0=raw, 1+=RLE, 2+=compressed blocks)',
        type: 'number',
        alias: 'l',
      })
      .option('checksum', {
        describe: 'Add content checksum to the frame',
        type: 'boolean',
        default: false,
      }),
  handler: async (argv) => {
    const { input, output, level, checksum } = argv;

    if (!fs.existsSync(input)) {
      console.error(`Error: Input file not found: ${input}`);
      process.exit(1);
    }

    try {
      const inputBuf = fs.readFileSync(input);
      const data = new Uint8Array(inputBuf.buffer, inputBuf.byteOffset, inputBuf.byteLength);

      const outDir = path.dirname(output);
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const result = compress(data, {
        level,
        checksum,
      });
      fs.writeFileSync(output, result);
      console.log(`Compressed ${input} -> ${output}`);
    } catch (error) {
      console.error(`Error during compression:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
