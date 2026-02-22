#!/usr/bin/env node

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DATA_DIR = path.join(__dirname, '..', 'bench-data');
const MANIFEST_PATH = path.join(BENCH_DATA_DIR, 'datasets.manifest.json');
const FILES_DIR = path.join(BENCH_DATA_DIR, 'files');
const INDEX_PATH = path.join(BENCH_DATA_DIR, 'index.json');

interface DatasetManifestEntry {
  id: string;
  category: string;
  url: string;
  outputFileName: string;
  description?: string;
  maxBytes?: number;
  extract?: {
    type: 'zip' | 'xz';
    entry?: string;
  };
}

interface DatasetManifest {
  version: number;
  datasets: DatasetManifestEntry[];
}

interface BenchCorpusIndex {
  version: number;
  generatedAt: string;
  files: Array<{
    id: string;
    category: string;
    description?: string;
    localPath: string;
  }>;
}

function downloadFile(urlString: string, destinationPath: string, redirects = 0): Promise<void> {
  if (redirects > 8) {
    throw new Error(`Too many redirects while downloading ${urlString}`);
  }
  const client = urlString.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      urlString,
      {
        headers: {
          'user-agent': 'zstdify-bench-fetch/1.0 (+https://github.com/bhouston/zstdify)',
          accept: '*/*',
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(statusCode) && typeof location === 'string' && location.length > 0) {
          response.resume();
          const nextUrl = new URL(location, urlString).toString();
          void downloadFile(nextUrl, destinationPath, redirects + 1).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Download failed for ${urlString}: HTTP ${statusCode}`));
          return;
        }

        const out = fs.createWriteStream(destinationPath);
        response.pipe(out);

        out.on('finish', () => {
          out.close();
          resolve();
        });

        out.on('error', (err) => {
          reject(err);
        });
      },
    );

    request.on('error', (err) => {
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as DatasetManifest;
  if (!Array.isArray(manifest.datasets) || manifest.datasets.length === 0) {
    throw new Error(`No datasets listed in manifest: ${MANIFEST_PATH}`);
  }

  fs.mkdirSync(FILES_DIR, { recursive: true });

  async function extractZipEntry(archivePath: string, entryName: string, destinationPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('unzip', ['-p', archivePath, entryName], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      const out = fs.createWriteStream(destinationPath);
      child.stdout.pipe(out);
      out.on('error', reject);

      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to extract ${entryName} from ${archivePath}: ${stderr.trim()}`));
          return;
        }
        out.close();
        resolve();
      });
    });
  }

  async function extractXzFile(archivePath: string, destinationPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('xz', ['-dc', archivePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      const out = fs.createWriteStream(destinationPath);
      child.stdout.pipe(out);
      out.on('error', reject);

      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to extract xz ${archivePath}: ${stderr.trim()}`));
          return;
        }
        out.close();
        resolve();
      });
    });
  }

  function truncateIfNeeded(filePath: string, maxBytes?: number): void {
    if (!maxBytes || maxBytes <= 0) {
      return;
    }
    const stats = fs.statSync(filePath);
    if (stats.size <= maxBytes) {
      return;
    }
    fs.truncateSync(filePath, maxBytes);
    console.log(`Truncated ${path.basename(filePath)} to ${maxBytes} bytes`);
  }

  const files = await Promise.all(
    manifest.datasets.map(async (dataset) => {
      const destinationPath = path.join(FILES_DIR, dataset.outputFileName);
      if (!fs.existsSync(destinationPath)) {
        if (dataset.extract) {
          const archiveSuffix = dataset.extract.type === 'zip' ? '.zip' : '.xz';
          const archivePath = path.join(FILES_DIR, `${dataset.outputFileName}${archiveSuffix}`);
          if (!fs.existsSync(archivePath)) {
            console.log(`Downloading ${dataset.id} archive from ${dataset.url}`);
            await downloadFile(dataset.url, archivePath);
          } else {
            console.log(`Using existing archive for ${dataset.id}: ${archivePath}`);
          }
          if (dataset.extract.type === 'zip') {
            if (!dataset.extract.entry) {
              throw new Error(`Missing zip entry for dataset ${dataset.id}`);
            }
            console.log(`Extracting ${dataset.extract.entry} for ${dataset.id}`);
            await extractZipEntry(archivePath, dataset.extract.entry, destinationPath);
          } else {
            console.log(`Extracting xz payload for ${dataset.id}`);
            await extractXzFile(archivePath, destinationPath);
          }
        } else {
          console.log(`Downloading ${dataset.id} from ${dataset.url}`);
          await downloadFile(dataset.url, destinationPath);
        }
      } else {
        console.log(`Using existing ${dataset.id}: ${destinationPath}`);
      }
      truncateIfNeeded(destinationPath, dataset.maxBytes);
      const stats = fs.statSync(destinationPath);
      if (stats.size <= 0) {
        throw new Error(`Downloaded file is empty: ${destinationPath}`);
      }
      return {
        id: dataset.id,
        category: dataset.category,
        description: dataset.description,
        localPath: path.relative(BENCH_DATA_DIR, destinationPath).replaceAll(path.sep, '/'),
      };
    }),
  );

  const index: BenchCorpusIndex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${INDEX_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
