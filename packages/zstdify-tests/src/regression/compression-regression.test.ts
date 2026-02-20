/**
 * Compression ratio regression: for fixed payloads and levels, compressed
 * sizes must not exceed golden values. Golden file is maintained by
 * scripts/compression-regression.ts (run once to create or update).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compress } from 'zstdify';
import { makeSeededPayload } from '../helpers/payloadHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, '../../scripts/compression-regression-golden.json');

interface Golden {
  version: number;
  entries: Array<{ id: string; level: number; size: number }>;
}

const PAYLOADS: Array<{ id: string; data: Uint8Array }> = [
  { id: 'empty', data: new Uint8Array(0) },
  { id: '1k-seed42', data: makeSeededPayload(1024, 42) },
  { id: '4k-seed0', data: makeSeededPayload(4 * 1024, 0) },
  { id: '64k-seed123', data: makeSeededPayload(64 * 1024, 123) },
];

const LEVELS = [0, 1, 3];

describe('compression regression', () => {
  it('compressed sizes do not exceed golden (ratio stability)', () => {
    if (!fs.existsSync(GOLDEN_PATH)) {
      throw new Error(`Missing ${GOLDEN_PATH}. It should be committed in the repo.`);
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Golden;
    for (const { id, data } of PAYLOADS) {
      for (const level of LEVELS) {
        const out = compress(data, { level });
        const g = golden.entries.find((e) => e.id === id && e.level === level);
        expect(g, `Golden entry for ${id} level ${level}`).toBeDefined();
        expect(
          out.length,
          `Regression: ${id} level ${level} size ${out.length} > golden ${g?.size}`,
        ).toBeLessThanOrEqual(g?.size ?? 0);
      }
    }
  });
});
