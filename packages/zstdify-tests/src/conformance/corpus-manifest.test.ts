/**
 * Conformance and decompress-robustness tests: one test per corpus fixture.
 * Each manifest entry is decompressed and verified (length + sha256). These
 * tests also ensure decompress() does not throw or crash on each corpus file.
 * Fixtures are from scripts/generate-corpus.ts (zstd CLI); corpus is committed.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decompress } from 'zstdify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.join(__dirname, '../../fixtures/corpus');
const manifestPath = path.join(corpusDir, 'manifest.json');

interface ManifestEntry {
  file: string;
  level: number;
  originalSize: number;
  sha256: string;
  description?: string;
}

interface Manifest {
  version: number;
  entries: ManifestEntry[];
}

function loadManifest(): Manifest | null {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw) as Manifest;
}

function sha256Hex(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('corpus manifest conformance (decompress robustness)', () => {
  const manifest = loadManifest();

  if (!manifest) {
    it('corpus manifest is required', () => {
      expect(fs.existsSync(manifestPath), `Missing required ${manifestPath}. Corpus fixtures must be committed.`).toBe(
        true,
      );
    });
    return;
  }

  for (const entry of manifest.entries) {
    it(`decompresses ${entry.file} (${entry.description ?? `level ${entry.level}`})`, () => {
      const zstPath = path.join(corpusDir, entry.file);
      if (!fs.existsSync(zstPath)) {
        throw new Error(`Missing fixture ${entry.file}. Regenerate with generate:corpus.`);
      }
      const compressed = new Uint8Array(fs.readFileSync(zstPath));
      const result = decompress(compressed);
      expect(result.length).toBe(entry.originalSize);
      expect(sha256Hex(result)).toBe(entry.sha256);
    });
  }
});
