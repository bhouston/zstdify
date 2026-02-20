# PLAN 3: Finish Decoder Conformance + Carry Forward Remaining PLAN_2 Work

This plan focuses on closing the remaining `level1.zst` mismatch and includes every unfinished item from `PLAN_2.md`.

## Snapshot of Current Status

- Current suite: `33/34` tests passing.
- Remaining failure: `packages/zstdify-tests/src/conformance/zstd-fixture.test.ts` (`level1.zst`).
- Failure mode has improved:
  - Before: reverse-bitstream underflow in sequence decode.
  - Now: decode completes but output is short by 4 bytes.

## PLAN_2 Progress Rollup

### Completed from PLAN_2

- Partial Phase 1 sequence-decoder rework started.
- `executeSequences()` sizing issue fixed (no literal double-count in output allocation).
- Added a focused reconstruction unit test (`packages/zstdify/src/decode/reconstruct.test.ts`).

### Not Yet Completed from PLAN_2 (carried forward)

- Finalize sequence bitstream/state handling so `level1.zst` fully passes.
- Add targeted sequence fixtures for single/multi-sequence compressed blocks.
- Expand conformance fixture matrix across levels/sizes/checksum variants.
- Add corruption/negative coverage for sequence/FSE/literals failures.
- Add differential harness (`zstd compress -> zstdify decompress`) and CI hook.
- Validate repeat-table/repeat-offset/multi-block compressed behavior.
- Add decoder performance guardrails and error-taxonomy improvements.
- Start compressed encoder roadmap after decoder is stable.

## Phase A (Highest Priority): Close the Last 4-Byte Conformance Gap

1. Implement sequence decoding strictly by spec order and boundaries:
   - Start-state read order: `LL`, `OF`, `ML` from reverse bitstream start.
   - Per-sequence decode order: `Offset`, `MatchLength`, `LiteralsLength`.
   - State update order for non-final sequence: `LL`, `ML`, `OF`.
2. Validate reverse bitreader semantics against spec:
   - Padding skip behavior (skip zeroes + first `1` marker correctly).
   - Bit order within reverse read path and consumption boundaries.
3. Add sequence-trace tests for the failing fixture:
   - Assert decoded sequence tuple values for `level1.zst`.
   - Assert exact bit consumption / end-of-stream conditions.
4. Re-run:
   - `pnpm build`
   - `pnpm vitest`
   - Goal: conformance fixture exact output match.

## Phase B: Complete Remaining PLAN_2 Phase 1 Work

1. Add targeted sequence tests:
   - Single-sequence compressed block fixture.
   - Multi-sequence fixture with extra bits and repeat offsets.
2. Add assertions around sequence reconstruction contracts:
   - Output length equals literals consumed + total match expansions.
   - No trailing zero bytes caused by allocation/copy mistakes.

## Phase C: Carry Forward PLAN_2 Phase 2 (Decoder Hardening)

1. Expand conformance fixtures:
   - Official zstd fixtures for `-1`, `-3`, `-9`.
   - Tiny, medium, large payloads.
   - Checksum and no-check variants.
2. Add negative/corruption tests:
   - Truncated sequence bitstreams.
   - Invalid FSE states/tables.
   - Invalid offsets and malformed literals headers.
3. Differential harness:
   - Automated corpus comparison: `zstd -> zstdify`.
   - Optional CI job that runs when zstd binary is available.

## Phase D: Carry Forward PLAN_2 Phase 3 (Feature Gaps)

1. Repeat-mode table reuse across compressed blocks.
2. Repeat-offset edge behavior including `rep1 - 1` corner case.
3. Multi-block compressed frames with evolving sequence/huffman tables.
4. Decoder perf sanity checks and better corruption diagnostics.

## Phase E: Carry Forward PLAN_2 Phase 4 (Encoder)

1. Keep raw-block encoder stable as baseline.
2. Add first compressed encode path:
   - Match finding (simple greedy).
   - Sequence generation.
   - Huffman + FSE emissions.
3. Interop tests:
   - `zstdify compress -> zstd decompress`
   - `zstd compress -> zstdify decompress`

## Milestones

- **M1 (next):** Fix sequence bitstream semantics; make `level1.zst` pass exactly.
- **M2:** Add sequence internals + corruption tests.
- **M3:** Add wider conformance/differential fixture matrix.
- **M4:** Stabilize repeat behavior across compressed blocks.
- **M5:** Begin compressed encoder MVP.

## Definition of Done for PLAN 3 Near Term

- `pnpm vitest` green with `level1.zst` passing exactly.
- Added fixture-backed sequence-internals tests (not integration-only).
- At least one expanded compressed-fixture set added beyond current pair.
