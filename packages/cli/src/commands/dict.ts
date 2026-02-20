import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineCommand } from 'yargs-file-commands';
import { type DictionaryTrainingAlgorithm, generateDictionary } from 'zstdify';

function collectFiles(inputPath: string, recursive: boolean, out: string[]): void {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    out.push(inputPath);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  const entries = fs.readdirSync(inputPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(inputPath, entry.name);
    if (entry.isFile()) {
      out.push(fullPath);
    } else if (entry.isDirectory() && recursive) {
      collectFiles(fullPath, recursive, out);
    }
  }
}

export const command = defineCommand({
  command: 'dict train <output>',
  describe: 'Train and write a dictionary from sample files',
  builder: (yargs) =>
    yargs
      .positional('output', {
        describe: 'Output dictionary file path',
        type: 'string',
        demandOption: true,
      })
      .option('input', {
        describe: 'Input sample file or directory path (repeat for multiple)',
        type: 'string',
        array: true,
        alias: 'i',
        demandOption: true,
      })
      .option('recursive', {
        describe: 'Recursively read files inside input directories',
        type: 'boolean',
        default: false,
      })
      .option('maxSamples', {
        describe: 'Maximum number of sample files to load',
        type: 'number',
        default: 10_000,
      })
      .option('algorithm', {
        describe: 'Training algorithm style',
        choices: ['fastcover', 'cover', 'legacy'] as const,
        default: 'fastcover',
      })
      .option('maxdict', {
        describe: 'Maximum dictionary size in bytes',
        type: 'number',
      })
      .option('dictID', {
        describe: 'Dictionary ID value (for metadata parity with zstd)',
        type: 'number',
      })
      .option('k', { type: 'number', describe: 'Candidate segment size' })
      .option('d', { type: 'number', describe: 'Distance step between candidate probes' })
      .option('steps', { type: 'number', describe: 'Score refinement passes' })
      .option('split', { type: 'number', describe: 'Percent of each sample to use (1-100)' })
      .option('f', { type: 'number', describe: 'fastcover-style score multiplier' })
      .option('accel', { type: 'number', describe: 'Probe stride accelerator (1-10)' })
      .option('selectivity', { type: 'number', describe: 'legacy-style density control (1-10)' })
      .option('shrink', {
        describe: 'Optional shrink pass, true or numeric factor',
      }),
  handler: async (argv) => {
    const {
      output,
      input,
      recursive,
      maxSamples,
      algorithm,
      maxdict,
      dictID,
      k,
      d,
      steps,
      split,
      f,
      accel,
      selectivity,
      shrink,
    } = argv;

    const inputPaths = (input as string[]) ?? [];
    const files: string[] = [];
    for (const inputPath of inputPaths) {
      if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input path not found: ${inputPath}`);
        process.exit(1);
      }
      collectFiles(inputPath, recursive, files);
      if (files.length >= maxSamples) break;
    }

    if (files.length === 0) {
      console.error('Error: No sample files found for dictionary training');
      process.exit(1);
    }

    const selectedFiles = files.slice(0, maxSamples);
    try {
      const samples = selectedFiles
        .map((filePath) => {
          const buf = fs.readFileSync(filePath);
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        })
        .filter((sample) => sample.length > 0);

      if (samples.length === 0) {
        console.error('Error: No non-empty sample files found');
        process.exit(1);
      }

      const dictionary = generateDictionary(samples, {
        algorithm: algorithm as DictionaryTrainingAlgorithm,
        maxDictSize: maxdict,
        dictId: dictID,
        k,
        d,
        steps,
        split,
        f,
        accel,
        selectivity,
        shrink: typeof shrink === 'string' ? Number(shrink) : (shrink as boolean | number | undefined),
      });

      const outDir = path.dirname(output);
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(output, dictionary);
      console.log(`Trained dictionary (${dictionary.length} bytes) -> ${output}`);
    } catch (error) {
      console.error(`Error during dictionary training:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
