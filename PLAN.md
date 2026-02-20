`zstdify` is currently empty, so this is effectively a greenfield build. Based on `../hdrify` as a template (workspace package + dedicated test packages), this is very feasible structurally, but **algorithmically large**.

## Effort Estimate

Assuming **1 experienced TypeScript engineer full-time** and target is a **pure TS runtime** (no Node/browser APIs in library code; `Uint8Array` I/O), realistic ranges are:

- **Decoder-only, RFC8878-compliant, no dictionaries/streaming first**: ~6–10 weeks
- **Encoder + decoder, interoperable with official zstd, core levels only**: ~4–6 months
- **Near-feature parity with reference zstd (advanced strategies, dict training, full streaming, perf tuning)**: ~9–15 months

Why this is large: the reference C implementation is substantial (not just glue)—`lib/decompress` and `lib/compress` together are many thousands of lines with multiple entropy/matchfinding paths and lots of edge-case handling.

## Recommended Scope (practical v1)

For a first release that is still genuinely useful:

- **v1 decoder**: full frame + block decode, literals/sequences, FSE/Huffman decode, checksums, skippable frames, strict error handling
- **v1 encoder**: interoperable framing + block encoder with a **single robust strategy** (e.g. greedy/lazy), limited compression-level surface
- **defer**: dictionary training, multithread, long-distance match, exotic strategy tuning
- **goal**: correctness/interoperability first, speed second

## Implementation Plan

1. **Repo bootstrap (week 1)**
- Mirror `hdrify` style monorepo: `packages/zstdify` + `packages/zstdify-tests`
- Define stable API around `Uint8Array`:
  - `compress(input, options?) => Uint8Array`
  - `decompress(input, options?) => Uint8Array`
  - optional streaming APIs later
- Add strict TS config, lint, vitest, CI

2. **Format + bitstream primitives (week 1–2)**
- Implement bit reader/writer, little-endian helpers, varint, bounds-safe cursor
- Implement frame header/parser + checksum utilities
- Add table builders for FSE/Huffman decode/encode support

3. **Decoder milestone (week 3–6)**
- Decode literals blocks (raw/RLE/compressed)
- Decode sequences (LL/ML/offset streams + repeat-offset rules)
- Execute sequence reconstruction into output buffer with window checks
- Handle block/frame boundaries, concatenated/skippable frames, content size/checksum validation
- Deliverable: decode official zstd-produced corpus vectors reliably

4. **Encoder milestone (week 7–12+)**
- Start with working pipeline:
  - frame writer
  - block splitter
  - match finder (single strategy first)
  - literal + sequence generation
  - entropy coding (Huffman/FSE)
- Keep compression levels narrow initially (e.g. 1–3)
- Optimize only after broad correctness achieved

5. **Streaming + optional features (later phase)**
- Incremental decode/encode contexts
- Dictionary support (read-only dict first, training much later)
- Performance passes + memory profiling

## Test Plan (sufficient correctness bar)

- **Conformance vectors**
  - Pull/add fixtures from `../zstd/tests` (golden frames, malformed streams, edge cases)
- **Differential tests**
  - Round-trip against official `zstd` binary:
    - `ts decompress(zstd compress(x)) == x`
    - `zstd decompress(ts compress(x)) == x`
- **Property/fuzz-style tests**
  - Random byte arrays with seeded reproducibility
  - Mutation tests for truncated/corrupt frames
- **Boundary tests**
  - Empty input, tiny blocks, max window limits, repeated offsets, checksum mismatch, skippable frames
- **Regression harness**
  - Every discovered bug gets a locked fixture test
- **Performance sanity tests**
  - Not for strict benchmark parity, but to detect accidental O(n²)/memory blowups

## Suggested acceptance criteria

- Decoder passes all planned conformance + corruption tests
- Encoder output is accepted by official zstd decompressor across fixture corpus
- Differential corpus pass rate near 100% for scoped features
- Clear unsupported-feature behavior with deterministic errors

---

If you want, I can next turn this into a concrete week-by-week milestone checklist in `hdrify`-style package layout (folders, files, scripts, CI jobs) so you can start implementation immediately.