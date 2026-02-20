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
      })
      .option('dict', {
        describe: 'Dictionary file path for dictionary-compressed input',
        type: 'string',
      })
      .option('dictID', {
        describe: 'Expected dictionary ID for validation',
        type: 'number',
      }),
  handler: async (argv) => {
    const { input, output, dict, dictID } = argv;

    if (!fs.existsSync(input)) {
      console.error(`Error: Input file not found: ${input}`);
      process.exit(1);
    }
    if (dict && !fs.existsSync(dict)) {
      console.error(`Error: Dictionary file not found: ${dict}`);
      process.exit(1);
    }

    try {
      const inputBuf = fs.readFileSync(input);
      const data = new Uint8Array(inputBuf.buffer, inputBuf.byteOffset, inputBuf.byteLength);
      const dictionary = dict
        ? (() => {
            const dictBuf = fs.readFileSync(dict);
            const bytes = new Uint8Array(dictBuf.buffer, dictBuf.byteOffset, dictBuf.byteLength);
            return dictID !== undefined ? { bytes, id: dictID } : bytes;
          })()
        : undefined;

      const outDir = path.dirname(output);
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const result = decompress(data, dictionary ? { dictionary } : undefined);
      fs.writeFileSync(output, result);
      console.log(`Decompressed ${input} -> ${output}`);
    } catch (error) {
      console.error(`Error during decompression:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
