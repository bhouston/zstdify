# zstdify Compression Improvement Plan

## Goals

- Improve compression ratio to approach reference `zstd` behavior on text, archive, and document corpora.
- Improve compression throughput while ratio improves (avoid large speed regressions).
- Preserve format compatibility and existing interop guarantees (`zstd` CLI, Node zstd, `zstddec`).
- Keep implementation practical for pure TypeScript.

## Current Gaps (Observed)

- Match finding is currently single-candidate greedy (low ratio ceiling).
- Sequence entropy coding uses predefined tables only in encoder path (misses adaptive gains).
- Literal compression path is constrained (size and symbol-range limitations).
- Encoder spends significant CPU in bitstream/state-path mechanics.
- Decoder has hot loops in reverse bit reading and sequence reconstruction.

## Success Metrics

- Ratio: reduce `zstdify_size / zstd_size` gap substantially on benchmark corpus.
- Speed: improve encode MB/s vs current baseline; avoid major regressions from ratio work.
- Stability: all current tests and interop checks pass.
- Predictability: level settings map to clear strategy tiers.

## Phase 0 - Baseline, Profiling, and Guardrails (1-2 days)

### Deliverables

- Freeze a baseline from:
  - `pnpm --filter zstdify-tests run bench:update`
  - `pnpm --filter zstdify-tests run bench:node-vs-zstdify`
  - `pnpm --filter zstdify-tests run bench:decode-only`
- Add CI artifact retention for benchmark outputs (`latest.md`, `latest.json`, SVGs).
- Add targeted microbench harness for:
  - match finder
  - sequence entropy encode
  - literals encode
  - reverse bit IO

### Exit Criteria

- Repeatable benchmark snapshot stored and compared in PRs.
- Hotspots confirmed with CPU profiles for encode + decode scripts.

---

## Phase 1 - Match Finder and Parsing Strategy Ladder (highest ratio ROI)

### Why first

Reference `zstd` (located at ../zstd) gets major ratio gains from stronger search and parser strategies per level.

### Work Items

1. Introduce level-to-strategy mapping (progressive complexity):
   - levels 0-1: raw/RLE fast paths (existing behavior)
   - levels 2-3: fast matcher with multi-candidate hash chain
   - levels 4-6: lazy matching + deeper candidate evaluation + rep-offset preference
   - levels 7-9: near-optimal parse (bounded dynamic programming window)
2. Replace single-candidate lookup with bounded chain traversal.
3. Add lazy-match decision path (lookahead to prefer better next match).
4. Add cross-block history matching (window-aware matching across blocks).
5. Explicitly model and score repeated offsets during parsing.

### Refactor Targets

- `packages/zstdify/src/encode/greedySequences.ts`
  - split into strategy modules, e.g. `fastMatcher.ts`, `lazyMatcher.ts`, `optimalParser.ts`
- `packages/zstdify/src/compress.ts`
  - replace branchy `level > 1` gate with strategy selection table

### Exit Criteria

- Ratio improvement is visible on text/document files first.
- No interop regressions.
- Encode throughput does not collapse (>20% regression should block merge unless ratio gains are exceptional and intentional).

---

## Phase 2 - Adaptive Sequence Entropy Coding (major ratio + some speed gains)

### Why second

Current predefined-only sequence mode leaves significant ratio on the table.

### Work Items

1. Build LL/OF/ML histograms per block.
2. Emit compressed FSE tables when profitable; use repeat-mode when previous tables remain good.
3. Keep predefined mode as a fallback.
4. Add block-local cost model:
   - estimated bits for predefined vs compressed vs repeat
   - include table header overhead in decision
5. Cache/reuse normalized distributions where possible to reduce CPU overhead.

### Refactor Targets

- `packages/zstdify/src/encode/compressedBlock.ts`
  - separate responsibilities:
    - sequence symbolization
    - entropy table decision/costing
    - bitstream emission
- Add new encoder-side entropy helpers parallel to decoder-side FSE primitives.

### Exit Criteria

- Meaningful ratio gains across corpus categories (especially long text and archives).
- Encoder remains deterministic and spec-correct.

---

## Phase 3 - Literal Compression Modernization (ratio-focused)

### Why third

Literal handling currently has constraints that prevent robust compression on realistic blocks.

### Work Items

1. Remove artificial small-block ceiling for compressed literals.
2. Support full literal symbol range (0-255) in dynamic path.
3. Build Huffman weights from real frequency counts (not synthetic split heuristics).
4. Add decision model among raw/RLE/compressed/treeless (when table reuse is legal/profitable).
5. Prefer 4-stream mode when beneficial and valid for block size.

### Refactor Targets

- `packages/zstdify/src/encode/compressedBlock.ts` (literals section)
  - split into dedicated module(s), e.g. `literalsEncoder.ts`
- Reuse or mirror utility patterns from `decode/literals.ts` where practical.

### Exit Criteria

- Ratio gap narrows further on mixed-symbol and high-entropy-with-structure workloads.
- No mismatch in decoder behavior for emitted literals modes.

---

## Phase 4 - Encode Throughput Refactor (efficiency-focused)

### Why fourth

After algorithmic improvements, optimize bottlenecks so gains are practical.

### Work Items

1. Replace bit-by-bit reverse bit writing with word-buffered writer.
2. Reduce state-path construction overhead:
   - prune unnecessary path work
   - lower temporary allocation churn
3. Preallocate/reuse scratch buffers for per-block encoding.
4. Reduce repeated bounds checks/optional chaining in hot loops.
5. Introduce tiny, focused performance tests for encoder internals.

### Refactor Targets

- `packages/zstdify/src/encode/compressedBlock.ts`
- potential new utility: `packages/zstdify/src/bitstream/reverseBitWriter.ts`

### Exit Criteria

- Encode MB/s improvement relative to post-Phase-3 baseline.
- No ratio regressions from low-level changes.

---

## Phase 5 - Decode Throughput Refactor (efficiency + parity ergonomics)

### Why fifth

Decode speed is materially behind Node zstd and `zstddec` on compressible payloads.

### Work Items

1. Add fast-paths in reverse bit reader for common bit-width/alignment cases.
2. Consolidate duplicate bit-reading logic in literals decode path.
3. Optimize sequence execution loops:
   - reduce branch density
   - tune copy thresholds
   - preserve correctness for overlap/history edge cases
4. Improve buffer reuse via `reuseContext`.
5. Validate with decode-only benchmarks for both zstdify-encoded and Node-encoded inputs.

### Refactor Targets

- `packages/zstdify/src/bitstream/bitReaderReverse.ts`
- `packages/zstdify/src/decode/literals.ts`
- `packages/zstdify/src/decode/sequences.ts`
- `packages/zstdify/src/decode/reconstruct.ts`

### Exit Criteria

- Consistent decode throughput gains on text/document workloads.
- No correctness regressions in corruption/interop tests.

---

## Phase 6 - Polishing and Long-Term Maintainability

### Work Items

- Document level strategy behavior in README/API docs.
- Add architecture notes for compression pipeline and entropy decisions.
- Add regression tests for:
  - ratio-sensitive corpus fixtures
  - strategy-specific edge cases (rep offsets, tiny blocks, high-symbol literals)
- Introduce optional feature flags for experimental strategies if needed.

## Areas to Refactor for Efficiency (Summary)

- Monolithic encoder module decomposition:
  - split `compressedBlock.ts` into literals, sequences, entropy decisions, bit emission.
- Strategy-based compressor architecture:
  - replace one-path greedy logic with pluggable strategy modules.
- Shared performance primitives:
  - centralized bit readers/writers with tested fast paths.
- Allocation discipline:
  - explicit scratch arenas per block/frame for hot encode/decode loops.
- Benchmark-driven development:
  - enforce benchmark deltas in PR workflow for key corpora.

## Validation and Rollout Policy

- Re-run full benchmark + interop suite at end of each phase.
- Merge ratio-focused phases behind guards if needed, then turn on by default when stable.
- Treat ratio and speed as coupled objectives:
  - ratio wins that catastrophically reduce speed are rejected.
  - speed wins that meaningfully hurt ratio are rejected.

## Suggested Order of Implementation

1. Phase 1 (strategy ladder + better match finder)
2. Phase 2 (adaptive sequence entropy)
3. Phase 3 (dynamic literals)
4. Phase 4 (encode hotpath refactor)
5. Phase 5 (decode hotpath refactor)
6. Phase 6 (docs/cleanup/regression hardening)

This order maximizes early ratio gains while keeping room for subsequent speed recovery and maintainable architecture.
