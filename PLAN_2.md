# PLAN_2: Next Implementation Steps (Post-Review)

This plan is based on the current codebase and test behavior as of Feb 2026.

## Current State (validated)

- Most core scaffolding is in place: frame parsing, raw/RLE paths, partial compressed-block decode, and raw-block encode.
- Test suite is mostly healthy (`32/33` tests passing), but one conformance test fails on a real compressed zstd fixture (`level1.zst`).
- The failing path is in compressed block sequence decoding (`decodeSequences` + FSE reverse bitstream handling).

## Key Findings from Review

1. **Primary failing cause: sequence bitstream/state initialization mismatch**
   - Current sequence decode reads initial FSE states from a forward reader, then attempts reverse decoding from a shifted substream.
   - Zstd sequence FSE decoding is reverse-oriented; this mismatch can desynchronize state/bit alignment and trigger `BitReaderReverse: buffer underflow`.
2. **Likely secondary correctness issue in sequence reconstruction sizing**
   - `executeSequences()` output allocation appears to double-count sequence literals, which can produce oversized output buffers.
3. **Interoperability confidence is still narrow**
   - Current conformance coverage is minimal (two fixtures, one of which fails).
4. **Encoder remains raw-block only**
   - Roundtrip tests pass mainly because decode is robust for raw blocks written by the current encoder.

## Phase 1 - Fix the Current Failing Test (highest priority)

1. Rework sequence section bitstream init to match zstd reverse decoding semantics:
   - Parse sequence headers/tables.
   - Initialize FSE states from the reverse stream at the proper point.
   - Decode sequences in correct order and maintain state transitions exactly.
2. Add targeted tests for sequence decoding internals:
   - Single-sequence compressed block fixture.
   - Multi-sequence fixture with non-trivial offsets and extra bits.
3. Fix `executeSequences()` output sizing and add assertions/tests:
   - Ensure final output length equals consumed literals + match expansions (no trailing zero slack).
4. Re-run full suite and confirm `level1.zst` conformance test passes.

## Phase 2 - Harden Decoder Correctness

1. Expand fixture-based conformance tests:
   - Multiple official zstd fixtures across levels (`-1`, `-3`, `-9`), tiny/medium/large payloads.
   - Include checksum and no-check variants.
2. Add corruption/negative tests:
   - Truncated sequence bitstream.
   - Invalid FSE tables/states.
   - Invalid offsets and malformed literals headers.
3. Differential testing harness:
   - `zstd compress -> zstdify decompress` corpus checks in CI/local script.

## Phase 3 - Close Decoder Feature Gaps

1. Validate and complete edge behaviors:
   - Repeat table mode across blocks.
   - Repeat offset edge cases (including `rep1 - 1` behavior).
   - Multi-block compressed frames with evolving tables.
2. Add decoder performance sanity checks:
   - Guardrails for pathological inputs (time/memory).
3. Improve error taxonomy/messages for easier debugging.

## Phase 4 - Encoder Roadmap (after decoder stability)

1. Keep raw mode stable as baseline.
2. Introduce first compressed encoder path:
   - Literal/match finder (simple greedy strategy).
   - Sequence generation.
   - Huffman + FSE table emission.
3. Add interoperability tests:
   - `zstdify compress -> zstd decompress`
   - `zstd compress -> zstdify decompress`
4. Add level surface incrementally (start with a very small subset).

## Concrete Near-Term Milestones

- **M1 (1-2 days):** Fix sequence reverse-bitstream/FSE state init; pass existing `level1.zst` fixture.
- **M2 (2-4 days):** Add 5-10 compressed-block conformance fixtures and corruption tests.
- **M3 (1 week):** Stabilize decoder edge semantics (repeat modes/offsets/multi-block tables) and keep CI green.
- **M4 (later):** Begin compressed encoder implementation behind focused interoperability tests.

## Definition of Done for This Plan's First Goal

- `pnpm vitest` passes with no failing conformance tests.
- At least one additional compressed fixture family added and passing.
- Sequence decode + reconstruction behavior is covered by focused tests (not only top-level integration tests).
