# Next Steps: Restore Correct Encoder Functionality

This document outlines the plan to remove temporary safety workarounds and correctly restore full encoder functionality.

## Current Temporary Mitigations (To Remove)

1. **Decode-in-encoder guard for compressed literals**
   - In `packages/zstdify/src/encode/literalsEncoder.ts`, compressed literals candidates (`blockType=2`) are validated by decoding immediately and comparing bytes.
   - If mismatch occurs, candidate is rejected and encoder falls back.
   - This is a correctness stopgap, but it is not acceptable long-term due to extra encode-time work and architectural layering concerns.

2. **Compressed sequence table mode disabled by default**
   - In `packages/zstdify/src/encode/compressedBlock.ts`, compressed sequence tables (`mode=2`) are only enabled when:
   - `ZSTDIFY_ENABLE_COMPRESSED_SEQUENCE_TABLES=1`
   - Default behavior currently avoids this path.

3. **Treeless literals reuse path currently not selected**
   - Treeless literals mode (`blockType=3`) is not currently chosen in `encodeLiteralsSection()`.
   - This reduces functionality and may hurt compression ratio/throughput behavior across consecutive blocks.

## What Must Be True Before Reverting Mitigations

- Encoder output must be **spec-correct** and decode correctly in:
  - `zstdify` decoder
  - Node `node:zlib` zstd decoder
  - (ideally) official `zstd` CLI for sampled cases
- No decode simulation in encode hot paths.
- No hidden env flags required for correctness.
- Regression tests explicitly cover both previous failure families:
  - `json-event-like-text`
  - `code-token-like-text`

## Phase 1: Pinpoint Root Causes

### 1A) Compressed sequence tables (`mode=2`)

Investigate:
- `normalizeCountsForTable()` / `writeNCount()` / `readNCount()` compatibility for encoder-generated headers.
- FSE table construction assumptions and state path mapping.
- Bitstream ordering for sequence state updates and extra bits under compressed tables.

Add/expand tests:
- Round-trip: `plan.sequences -> buildSequenceSection -> decodeSequences` for multiple synthetic and corpus-like distributions.
- Assert exact equality of `(literalsLength, offset, matchLength)` tuples for every sequence.
- Include mixed distributions that force modes `{0,2,3}` across LL/OF/ML streams.

### 1B) Compressed literals / treeless literals

Investigate:
- Huffman code assignment and canonical ordering in `literalsEncoder.ts`.
- 1-stream and 4-stream layout correctness (jump table and stream partitioning).
- Treeless reuse compatibility between consecutive blocks.

Add/expand tests:
- Round-trip of literals section only:
  - `encodeLiteralsSection -> parse/decode literals -> exact byte equality`.
- Test both `blockType=2` and `blockType=3` across:
  - small and large literals
  - high-entropy and repetitive inputs
  - consecutive blocks sharing prior table.

## Phase 2: Remove Temporary Decode-in-Encoder

Once literals encoding is proven correct by tests:
- Remove imports of decoder code from encoder:
  - `parseLiteralsSectionHeader`
  - `decodeCompressedLiterals`
- Remove immediate decode validation branch from `makeCompressedSection()`.
- Keep only pure encode-time decision logic.

Validation gate:
- All new literals round-trip tests pass without decode-in-encoder checks.

## Phase 3: Re-enable Compressed Sequence Table Mode by Default

Once sequence compressed-table correctness is proven:
- Remove default-off gate:
  - `process.env.ZSTDIFY_ENABLE_COMPRESSED_SEQUENCE_TABLES`
- Restore normal adaptive mode selection including `mode=2`.
- Keep tests that specifically verify `mode=2` emits valid streams.

Validation gate:
- `node-zstd-dictionary-corpus.test.ts` passes without env overrides.
- Sequence tuple round-trip tests pass with adaptive mode selection.

## Phase 4: Restore Treeless Literals Selection

- Re-enable treeless (`blockType=3`) candidate selection in `encodeLiteralsSection()`.
- Ensure previous-table reuse paths are spec-correct and deterministic.

Validation gate:
- Existing and new treeless-specific tests pass.
- No regressions in interop tests or corruption tests.

## Validation Matrix (Must Pass Before Merge)

- Build/typecheck:
  - `pnpm tsgo`
- Targeted regressions:
  - `pnpm vitest run "packages/zstdify-tests/src/interop/node-zstd-dictionary-corpus.test.ts"`
  - `pnpm vitest run "packages/zstdify/src/encode/compressedBlock.test.ts"`
  - `pnpm vitest run "packages/zstdify/src/encode/greedySequences.test.ts"`
- Broader confidence:
  - `pnpm vitest run "packages/zstdify-tests/src/interop/node-zstd-interop.test.ts"`
  - optionally full `pnpm test`

## Suggested Implementation Order

1. Fix literals compressed/treeless correctness first (smaller surface area, currently tied to decode-in-encoder workaround).
2. Remove decode-in-encoder workaround.
3. Fix compressed sequence table mode correctness.
4. Re-enable mode=2 by default.
5. Re-enable treeless selection and verify ratio/interop behavior.

## Notes

- Keep all temporary gates only long enough to preserve correctness while root causes are fixed.
- Do not keep env toggles as permanent behavior controls for correctness-sensitive paths.
- Prefer adding deterministic unit/regression tests over runtime validation fallbacks in hot encode paths.
