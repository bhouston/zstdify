import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineCommand } from 'yargs-file-commands';
import { decompress } from 'zstdify';

export const command = defineCommand({
  command: 'extract <input> <output>',
  describe: 'Decompress a zstd-compressed file',
  aliases: ['x'],
  builder: (yargs) =>
    yargs
      .positional('input', {
        describe: 'Input compressed file path',
        type: 'string',
        demandOption: true,
      })
      .positional('output', {
        describe: 'Output file path',
        type: 'string',
        demandOption: true,
      }),
  handler: async (argv) => {
    const { input, output } = argv;

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

      const result = decompress(data);
      fs.writeFileSync(output, result);
      console.log(`Decompressed ${input} -> ${output}`);
    } catch (error) {
      console.error(`Error during decompression:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
