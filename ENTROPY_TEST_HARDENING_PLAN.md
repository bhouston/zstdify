# Entropy Test Hardening Plan

## Goal

Increase confidence that entropy code is correct under both normal and adversarial inputs, and reduce the chance that weak assertions allow regressions to pass.

Primary targets:

- `packages/zstdify/src/entropy/fse.ts`
- `packages/zstdify/src/entropy/huffman.ts`
- `packages/zstdify/src/entropy/weights.ts`

## Principles

- Prefer deterministic fixtures first, then fuzz/property tests.
- Assert exact behavior (symbol, state transitions, bytes consumed), not just "no throw" or "type is number".
- Validate both happy paths and corruption paths.
- Keep tests close to the module under test (`*.test.ts`) and use small helper utilities only where needed.

## Work Items (Prioritized)

1. **Strengthen FSE decode-table invariants**
   - File: `packages/zstdify/src/entropy/fse.test.ts`
   - Add tests that verify for a known normalized distribution:
     - `table.length === 1 << tableLog`
     - Every state has a defined symbol/numBits/baseline triple
     - `numBits` are within `[0, tableLog]`
     - State transition `baseline + bits` always lands in `[0, table.length)`
   - Add at least one test with `-1` counts to ensure low-probability symbol placement behavior remains stable.

2. **Replace weak `decodeFSESymbol` assertion with exact transition checks**
   - File: `packages/zstdify/src/entropy/fse.test.ts`
   - Replace the current "updates state" style test with:
     - Controlled reader input
     - Expected first N decoded symbols
     - Expected state after each decode
   - Add an invalid-initial-state test to assert `corruption_detected`-style failure behavior.

3. **Add `readNCount` round-trip and edge-case coverage**
   - File: `packages/zstdify/src/entropy/fse.test.ts`
   - Expand `writeNCount -> readNCount` tests across several distributions:
     - Two-symbol balanced
     - Sparse multi-symbol
     - Skewed realistic distribution
   - Add corruption-path tests:
     - Truncated input
     - Impossible probability sum
     - Invalid zero-repeat encoding
   - Ensure assertions include `tableLog`, `maxSymbolValue`, `bytesRead`, and exact normalized counters for active symbols.

4. **Add positive-path tests for `readWeightsFSE`**
   - File: `packages/zstdify/src/entropy/weights.test.ts`
   - Today coverage is mostly exception paths; add at least one valid FSE-compressed weights sample.
   - Assert:
     - `weights.length >= 2`
     - Weights are in valid symbol range (`0..11`)
     - `bytesRead === compressedSize`
   - If creating a hand-crafted stream is too fragile, generate a fixed fixture using a local helper and lock the fixture bytes in test.

5. **Huffman decode exactness tests**
   - File: `packages/zstdify/src/entropy/huffman.test.ts`
   - Add tests for canonical mapping correctness on several compact trees.
   - Add decode sequence test that verifies:
     - exact symbol stream output
     - reader position/consumption consistency
   - Add negative tests for invalid tree construction (e.g., incomplete/overfull distributions).

6. **Cross-check entropy primitives against decode paths that use them**
   - Files:
     - `packages/zstdify/src/decode/literals.test.ts`
     - `packages/zstdify/src/decode/sequences*.test.ts` (or create if missing)
   - Add regression tests where entropy tables drive real decode outputs, so primitive-level regressions also fail integration-level tests.

7. **Property-based tests (bounded) for parser robustness**
   - Suggested file: `packages/zstdify/src/entropy/fse.property.test.ts`
   - Use fast-check with tight bounds and deterministic seed in CI.
   - Focus properties:
     - `readNCount` never returns out-of-range counters/tableLog for accepted inputs
     - malformed inputs either throw or produce bounded valid outputs (never infinite loops / huge allocations)
   - Keep runtime controlled (small sizes, limited runs) to avoid CI flakiness.

8. **Mutation-style "assertion quality" sanity check**
   - Optional but valuable.
   - For 1-2 critical tests, temporarily invert expected symbol/state and confirm tests fail (local validation, not committed).
   - Purpose: ensure tests are actually sensitive to logic regressions.

## Suggested Delivery Phases

### Phase 1 (High value, low risk)

- Items 1, 2, and 4.
- Expected outcome: closes the largest confidence gap quickly.

### Phase 2 (Broader correctness envelope)

- Items 3 and 5.
- Expected outcome: stronger parser/decoder correctness guarantees.

### Phase 3 (Long-term resilience)

- Items 6, 7, and optional 8.
- Expected outcome: regression detection improves across refactors and performance work.

## Acceptance Criteria

- No entropy test should rely on "type-only" assertions for core decode behavior.
- Critical decoder tests assert exact outputs/transitions, not just successful execution.
- At least one valid `readWeightsFSE` decode path is exercised.
- Corruption-path tests cover truncated and structurally invalid headers for both weights and NCount parsing.
- Test runtime remains stable and practical for CI.

## Risks and Mitigations

- **Risk:** Hand-crafted bitstreams are brittle.
  - **Mitigation:** Keep fixtures minimal, annotate fixture intent, and prefer helper-generated fixtures when possible.
- **Risk:** Property tests add flakiness/time.
  - **Mitigation:** Tight size bounds, deterministic seeds, and capped run counts.
- **Risk:** Overfitting tests to current implementation quirks.
  - **Mitigation:** Favor spec-level expectations and integration cross-checks.

## Quick Start (Recommended Next PR)

1. Harden `fse.test.ts` with exact symbol/state assertions (replace weak decode test).
2. Add one valid `readWeightsFSE` happy-path fixture test.
3. Add one invalid-invariant `buildFSEDecodeTable` test and one `readNCount` corruption test.

This gives immediate confidence gains while keeping change scope manageable.
