# Lessons from `fzstd` for `zstdify`

This document captures what we learned by comparing `fzstd` against `zstdify`, focusing on decompression performance and practical improvements we can apply in this monorepo.

## Scope and benchmark context

- Target compared: `../fzstd` (pure JS zstd decompressor) vs current `zstdify` decode path.
- Bench harness: `packages/zstdify-tests` benchmark scripts updated to include `fzstd`.
- Local benchmark snapshot (`latest.json` generated during this analysis):
  - Average decompression throughput:
    - `zstdify`: ~130 MB/s
    - `fzstd`: ~305 MB/s
    - `Node zstd`: ~1452 MB/s
    - `zstddec`: ~1253 MB/s
  - `fzstd` / `zstdify` decompression speedup: ~2.34x average (range ~1.83x to ~2.88x across payloads).

## Why `fzstd` is faster (key causes)

## 1) Data layout is more JIT-friendly

- `fzstd` keeps hot decode tables in typed arrays (`Uint8Array`, `Uint16Array`, etc.) and often in shared `ArrayBuffer` allocations.
- `zstdify` currently stores many table rows as object arrays (`{ symbol, numBits, baseline }`), which increases property access overhead and GC pressure in tight loops.

**Lesson:** Move hot entropy structures (Huffman/FSE decode rows and related state) toward packed typed-array layouts.

## 2) Hot decode path is fused

- `fzstd` does block parse + literals + sequence decode + match execution in one dense path with local variables.
- `zstdify` uses cleaner modular stages (`literals` -> `sequences` -> `reconstruct`), which is easier to reason about but adds function and data handoff overhead.

**Lesson:** Keep modular correctness path, but introduce a specialized fused fast path for common compressed blocks.

## 3) Bitstream operations are aggressively inlined

- `fzstd` inlines many bit operations directly inside hot loops.
- `zstdify` uses robust reader abstractions (`BitReaderReverse`) with additional checks/indirection.

**Lesson:** Preserve safe generic readers, but add optional internal fast helpers for hot decode loops where bounds are already validated.

## 4) Fewer temporary allocations during decode

- `fzstd` reuses state and tends to allocate less transient intermediate data in hot sections.
- `zstdify` currently allocates per-block intermediates in literals/sequences paths more often.

**Lesson:** Reuse temporary buffers/table memory across blocks and frames where legal.

## 5) Copy/match execution is tuned for contiguous operations

- `fzstd` leans on contiguous operations and tightly coupled local state for literals/match copies.
- `zstdify` reconstruct path is correct and clear, but still pays overhead from genericity and multiple helper boundaries.

**Lesson:** Add targeted fast branches for frequent copy patterns (small offsets, common match lengths, no history wrap case).

## Practical recommendations for `zstdify`

## Decompressor (highest ROI first)

1. **Typed-array table refactor**
   - Replace object-row Huffman/FSE tables with packed arrays for `symbol`, `numBits`, and `baseline`.
2. **Fast-path sequence loop**
   - Create a low-overhead sequence decode+execute path that avoids extra object/array churn.
3. **Bitreader micro-optimization**
   - Add internal fast read helpers for validated paths, leaving safe path intact for edge/corruption handling.
4. **Allocation minimization**
   - Reuse literals and sequence scratch buffers across blocks/frames in decoder context.
5. **Hot-path microbench gates**
   - Track sequence loop, huffman stream decode, FSE state transition, and history copy microbench metrics in CI.

## Compressor lessons we can still apply

Even though `fzstd` is decode-focused, its performance style suggests useful encode-side principles:

1. **Prefer packed state in entropy coding hot loops**
   - Table/state objects in frequent loops should become typed arrays where practical.
2. **Reuse encoder scratch memory**
   - Keep block-local scratch buffers/table workspaces and recycle them.
3. **Separate correctness vs speed paths**
   - Keep strict/reference path; add fast path for common parameter sets.
4. **Reduce polymorphism in inner loops**
   - Avoid shape changes and mixed-type objects in symbol-scanning and match-finding loops.

## Suggested implementation strategy

- Phase 1: Add decode microbench assertions and capture baseline profiles.
- Phase 2: Refactor FSE/Huffman table representation to typed arrays.
- Phase 3: Add fused fast path for compressed block decode/reconstruct.
- Phase 4: Apply similar data-layout and scratch-reuse tactics to encode hot paths.
- Phase 5: Re-run corpus benchmarks and keep regressions visible in benchmark artifacts.

## Notes and caveats

- Current benchmark updates were performed in `packages/zstdify-tests` and include `fzstd` as a decode comparator.
- Existing unrelated repository changes and an existing TypeScript build issue in current working tree were intentionally not modified by this lessons write-up.
