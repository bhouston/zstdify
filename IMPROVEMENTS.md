# Improvements Roadmap

This document tracks high-level compatibility improvements needed for `zstdify`.

## Current Compatibility Gaps

- `zstdify` encoder output appears interoperable with `zstd` on broad randomized coverage (no corruption detected so far).
- `zstdify` decoder still rejects some valid streams produced by official `zstd`.
- Dictionary-compressed streams are explicitly unsupported by `zstdify` today.

## Failing Tests To Drive Fixes

These tests are intentionally marked with `it.fails` and should pass once the corresponding features/fixes are implemented:

- `packages/zstdify-tests/src/differential/known-failures.test.ts`
  - `fails to decode a valid zstd stream at level -1`
  - `fails to decode a valid zstd stream at level -9`
  - `fails to decode dictionary-compressed zstd stream (unsupported)`

## High-Level Improvements Needed

- Harden compressed-literals decoding
  - Improve handling of Huffman weight streams (both direct and FSE-compressed forms).
  - Validate stream-length accounting and table reconstruction against RFC 8878/reference behavior.

- Harden sequence-table decoding
  - Improve FSE `NCount` parsing robustness for valid edge-case distributions emitted by `zstd`.
  - Ensure all legal table-log/symbol distribution combinations are accepted.

- Add dictionary support in the decoder
  - Parse Dictionary ID from frame headers and resolve dictionary bytes via API.
  - Support at least raw-content dictionaries first, then full entropy/repeat-offset dictionary modes.
  - Add explicit API shape for dictionaries, e.g. `decompress(input, { dictionary })`.

- Expand differential test coverage
  - Add seeded large-payload corpora for multiple compression levels and options.
  - Keep each discovered interop bug as a locked regression test.

## Suggested Delivery Order

1. Fix non-dictionary valid stream decode failures (`-1`, `-9` known-failures cases).
2. Add minimal dictionary-aware decode path.
3. Extend conformance fixtures and differential corpus to prevent regressions.
