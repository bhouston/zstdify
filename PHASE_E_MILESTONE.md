# Phase E Milestone: Compressed-Block Encoder

This milestone tracks incremental work toward full compressed-block encoding while preserving current interoperability and test stability.

## Scope

- Keep existing raw/RLE encode paths stable and interoperable.
- Build encoder internals required for compressed blocks:
  - match finding,
  - sequence generation,
  - literals/sequence stream planning,
  - entropy emission wiring (Huffman + FSE).

## Implemented in this milestone start

- Added greedy match-finder + sequence planner:
  - `packages/zstdify/src/encode/greedySequences.ts`
- Added unit tests that validate sequence plans by reconstructing bytes with decoder reconstruction logic:
  - `packages/zstdify/src/encode/greedySequences.test.ts`
- Added `compress()` scaffolding for `level > 1` to detect compressible blocks and route through the future compressed emitter path without changing output format yet.

## Next deliverables

1. **Literals encoder**
   - Build Huffman weight derivation and tree description writer.
   - Emit compressed literals section (1- and 4-stream modes).
2. **Sequence encoder**
   - Convert sequence tuples into LL/OF/ML codes and extra bits.
   - Build FSE compression tables and encode sequence bitstream.
   - Emit sequence section headers/tables/stream by spec order.
3. **Compressed block writer**
   - Assemble literals + sequence section into `blockType=2`.
   - Add fallback to raw when compressed payload is not smaller.
4. **Interop and conformance expansion**
   - Keep `zstdify -> zstd` interop passing for compressed blocks.
   - Differential coverage for mixed payloads and multiple levels.

## Definition of done (Phase E MVP)

- `compress(input, { level: 2 })` can emit valid compressed blocks.
- `zstd -d` decodes these frames correctly.
- `zstdify` decodes its own compressed output correctly.
- CI includes required interop + differential checks for compressed output.
