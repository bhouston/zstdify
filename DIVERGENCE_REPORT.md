# Divergence Debug Report

## Scope

This report documents:

- the fine-grained Node->zstdify interop debug tooling added for this investigation
- findings for the known failing case in `node-zstd-interop.test.ts`
- analysis and likely fault domain for a follow-up fixing agent

Target failing case:

- `corpus-linux-kernel-tar` on Node compress -> zstdify decode
- level `5` fails
- level `9` fails
- level `3` passes

That pass/fail split strongly indicates a mode/path issue triggered more often by higher compression levels, not generic frame parsing.

## Added Debug Tooling

## 1) Test-integrated fine-grained debugger

File: `packages/zstdify-tests/src/interop/node-zstd-interop.test.ts`

Debug mode is gated by env vars so normal test behavior is unchanged:

- `ZSTDIFY_INTEROP_DEBUG=1`
- `ZSTDIFY_INTEROP_DEBUG_PAYLOAD` (default: `corpus-linux-kernel-tar`)
- `ZSTDIFY_INTEROP_DEBUG_PASS_LEVEL` (default: `3`)
- `ZSTDIFY_INTEROP_DEBUG_FAIL_LEVELS` (default: `5,9`)

When enabled, failing level runs emit:

- first mismatch offset
- chunk hash divergence
- local hex context around first mismatch
- decoded block mapping near mismatch
- suspect-path classification

## 2) Reusable helper and CLI

Helper:

- `packages/zstdify-tests/src/helpers/divergenceDebug.ts`

CLI:

- `packages/zstdify-tests/scripts/debug-node-zstd-divergence.ts`
- script entry: `packages/zstdify-tests/package.json`
  - `debug:node-zstd-divergence`

Example usage:

```bash
pnpm --filter zstdify-tests run debug:node-zstd-divergence -- --payload-id corpus-linux-kernel-tar --pass-level 3 --fail-level 5
pnpm --filter zstdify-tests run debug:node-zstd-divergence -- --payload-id corpus-linux-kernel-tar --pass-level 3 --fail-level 9
```

## 3) Optional internal decode tracing

Added opt-in instrumentation hooks in decode internals to map output offsets back to decoded block metadata:

- `packages/zstdify/src/decode/debugTrace.ts`
- `packages/zstdify/src/decompress.ts` (`debugTrace` option)
- `packages/zstdify/src/decode/decompressFrame.ts` (block-level callbacks)
- `packages/zstdify/src/decode/sequences.ts` (mode/table metadata)

This provides per-block context such as:

- block type/size, output span
- literals mode and stream count
- sequence count and LL/OF/ML modes
- table logs
- repeat-offset candidate count

## Reproduction

Baseline failure remains:

```bash
pnpm vitest node-zstd-interop.test.ts
```

Expected failing tests:

- `corpus-linux-kernel-tar (archive) level 5`
- `corpus-linux-kernel-tar (archive) level 9`

Expected passing comparison:

- same corpus at level `3`

## Findings: `corpus-linux-kernel-tar` (3 -> 5)

From debug output:

- compressed size: pass `223872`, fail `214950`
- first mismatch offset: `917685`
- first mismatch chunk index: `14`
- decoded lengths (sampled test payload): both `1048576`

Context bytes near first mismatch:

- pass (level 3): `... 74 68 65 20 43 4d 42 ...` (ASCII `CMB`)
- fail (level 5): `... 74 68 65 20 70 2e 42 ...` (ASCII `p.B`)

Block mapping at mismatch:

- pass block: `index=8`, compressed block, literals compressed (4 streams), sequences all `compressed/compressed/compressed`
- fail block: `index=13`, compressed block, literals **treeless** (1 stream), sequences all `compressed/compressed/compressed`

Fail-side local block window around mismatch:

- includes consecutive treeless blocks immediately before and at mismatch
- key mismatch block has:
  - treeless literals
  - single literals stream
  - high sequence activity

Suspect classifier output:

- treeless literals path (depends on previous Huffman table state)
- FSE-compressed sequence tables path
- repeat-offset execution path

## Findings: `corpus-linux-kernel-tar` (3 -> 9)

From debug output:

- compressed size: pass `223872`, fail `205887`
- first mismatch offset: `917685` (same as level 5)
- first mismatch chunk index: `14`
- decoded lengths (sampled test payload): both `1048576`

Context bytes near first mismatch:

- pass (level 3): `... 74 68 65 20 43 4d 42 ...` (ASCII `CMB`)
- fail (level 9): `... 74 68 65 20 73 6e 42 ...` (ASCII `snB`)

Block mapping at mismatch:

- pass block: same pass block profile as above
- fail block: `index=11`, compressed block, literals compressed (1 stream), sequences modes include **repeat**:
  - `compressed/repeat/repeat`

Fail-side local block window around mismatch:

- neighboring blocks show mode transitions including repeat usage
- mismatch block is small and mode-shifted into repeat table reuse

Suspect classifier output:

- sequence repeat-mode table reuse path
- FSE-compressed sequence tables path
- repeat-offset execution path

## Cross-case observations

Key convergences:

1. **Same first output divergence offset (`917685`) for both failing levels**
   - strongly suggests a deterministic decode-path issue triggered by specific block-mode combinations.

2. **The failure appears in higher-level mode regimes**
   - level 3 pass vs 5/9 fail aligns with entropy/mode differences (treeless/repeat/FSE patterns) rather than basic block/frame parsing.

3. **Mismatch appears mid-output with equal output length**
   - this is corruption/substitution, not truncation/early termination.

4. **Both failing scenarios involve compressed blocks with advanced entropy behavior**
   - level 5 highlights treeless literals context
   - level 9 highlights sequence repeat-mode table reuse
   - both include FSE-compressed sequence usage and repeat-offset candidates

## Likely Fault Domain (for follow-up agent)

Highest-probability areas:

1. **Treeless literals decode state continuity**
   - file: `packages/zstdify/src/decode/literals.ts`
   - file: `packages/zstdify/src/decode/decompressFrame.ts`
   - validate previous Huffman table reuse across compressed-block boundaries and mode transitions.

2. **Sequence repeat-mode table reuse**
   - file: `packages/zstdify/src/decode/sequences.ts`
   - verify repeat-mode table provenance and state transitions for LL/OF/ML in mixed compressed/repeat sections.

3. **Repeat-offset execution semantics**
   - file: `packages/zstdify/src/decode/reconstruct.ts`
   - inspect repeat-offset handling under specific `ll=0/non-zero` and small-offset edge cases that are common at higher levels.

4. **Interaction effect (not single subsystem)**
   - corruption may originate from correctly parsed tables but incorrect sequence execution over literals derived from treeless/compressed transitions.

## Suggested next debugging step

Use the existing debug tool output to add one more temporary probe around the first failing block (at the known mismatch offset) to compare:

- decoded literal bytes produced for that block
- first N decoded sequences (LL/OF/ML tuples)
- reconstructed bytes written for the first divergence range

Then compare level 3 vs failing level at that exact output window to isolate whether the first wrong byte is introduced in:

- literals decode,
- sequence decode,
- or sequence execution/copy mechanics.

## Status

- Fine-grained debugger implemented and validated
- reusable CLI implemented and validated
- baseline failure reproduced unchanged
- findings captured for handoff
