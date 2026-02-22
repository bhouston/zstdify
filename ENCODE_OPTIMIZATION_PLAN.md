I’ve finished the comparison pass; I’m now synthesizing it into a prioritized optimization plan tied directly to your measured hotspots, with concrete implementation steps, expected payoff, and validation checkpoints.## Hotspot Comparison + Optimization Plan

You’re getting strong signal from the 100-turn profile. The top costs are concentrated enough that we can prioritize very aggressively.

### Hotspot diagnosis (what matches `zstd` / `fzstd` patterns)

- `buildStatePath` dominates (~65% samples). In `zstdify`, this does per-sequence dynamic path solving over bitmasks and state ranges for each candidate table.
```271:339:packages/zstdify/src/encode/compressedBlock.ts
function buildStatePath(
  codes: ArrayLike<number>,
  table: FSEDecodeTable,
): { states: number[]; updateBits: number[] } | null {
  // ...
  for (let i = rowCount - 2; i >= 0; i--) {
    // ...
    const chosenNext = findFirstSetBitInRange(
      masks,
      nextMaskOffset,
      wordCount,
      minNextByState[state]!,
      maxNextByState[state]!,
    );
    // ...
  }
  // ...
}
```
- `pickMatch` / `findBestMatchAt` (~28% combined) repeatedly rescan chains and probe windows.
```175:189:packages/zstdify/src/encode/sequencePlanner.ts
function pickMatch(parse: ParseState, pos: number): MatchCandidate | null {
  const direct = findBestMatchAt(parse, pos, parse.repOffsets);
  if (parse.options.searchWindow <= 1) return direct;
  let best = direct;
  const end = Math.min(parse.input.length - MIN_MATCH, pos + parse.options.searchWindow - 1);
  for (let probePos = pos + 1; probePos <= end; probePos++) {
    const probe = findBestMatchAt(parse, probePos, parse.repOffsets);
    // ...
  }
  return best;
}
```
- `zstd` pattern: table-mode selection is cost-model-first, then build/use one table path, not repeated path solving per candidate.
```156:235:/Users/bhouston/Coding/OpenSource/zstd/lib/compress/zstd_compress_sequences.c
SymbolEncodingType_e
ZSTD_selectEncodingType(...) {
  // compares basic/repeat/compressed costs
  // selects one encoding type
}
```
- `zstd` matchfinder pattern: persistent hash/chain structures are incrementally updated (`ZSTD_updateDUBT`) instead of rebuilt per block.
```27:65:/Users/bhouston/Coding/OpenSource/zstd/lib/compress/zstd_lazy.c
void ZSTD_updateDUBT(...) {
  for ( ; idx < target ; idx++) {
    size_t const h  = ZSTD_hashPtr(base + idx, hashLog, mls);
    U32 const matchIndex = hashTable[h];
    // update hash and chain incrementally
  }
}
```
- `fzstd` style lesson still applies on encode side: packed typed arrays + single-allocation/scratch reuse in hot loops.

---

## Prioritized optimization plan

### P0 — Reduce `buildStatePath` invocations first (highest ROI)

- **Change:** In `chooseStreamMode()`, do cheap histogram/cross-entropy pre-ranking for candidates, and run `buildStatePath()` only for top 1-2 candidates (plus fallback).
- **Why:** Right now you call path search for predefined, repeat, and every normalized candidate.
- **Expected gain:** Large wall-clock win; likely biggest single drop in total encode profile time.
- **Risk:** Low-medium (selection quality/regression risk, not format risk).

### P1 — Add a fast path for common sequence-table cases

- **Change:** For predefined or repeated tables with stable codes, use a deterministic “direct transition” path builder (or cached predecessor map) that avoids full mask DP.
- **Why:** `buildStatePath` currently does range scans + bitsets every block even in common cases.
- **Expected gain:** Significant on text-heavy corpora where symbol patterns repeat.
- **Risk:** Medium (must preserve valid FSE state transitions exactly).

### P2 — Make candidate normalization cheaper

- **Change:** Replace string keying (`Array.from(histogram).join(',')`) with a compact typed-array hash key; avoid realloc for histogram->array conversions.
- **Why:** `getNormalizedTableCandidates()` does extra allocation/serialization in hot entropy path.
- **Expected gain:** Moderate CPU + GC reduction.
- **Risk:** Low.

### P3 — Sequence planner: cut repeated match scans

- **Change:** In `pickMatch()`, stop probing once current best exceeds reachable delayed score bound; also gate probes by quick 3-byte precheck before full `findBestMatchAt()`.
- **Why:** Current probe loop calls `findBestMatchAt()` repeatedly with little pruning.
- **Expected gain:** Moderate-to-high in `pickMatch`+`findBestMatchAt` hotspots.
- **Risk:** Low-medium (ratio/perf trade-off tuning).

### P4 — Incremental chain/hash state across blocks

- **Change:** Move toward persistent match-state updates per block (zstd-like), instead of rebuilding full `chainPrev` each `planSequences()` call.
- **Why:** `buildChainPrev()` is currently full-pass per input.
- **Expected gain:** High for large inputs and multi-block frames.
- **Risk:** Medium-high (state correctness across history/window boundaries).

### P5 — Bitstream writer micro-tuning (lower priority)

- **Change:** Add a specialized path for `n <= 16` and avoid repeated mask recompute in `writeBits()`.
- **Why:** `encodeReverseBitstream` is visible but much smaller hotspot share.
- **Expected gain:** Small.
- **Risk:** Low.

---

## Concrete execution order (recommended)

- Step 1: Implement **P0** only, re-profile (`--turns 1000`).
- Step 2: Implement **P3** pruning, re-profile.
- Step 3: Implement **P2** allocation cleanup, re-profile.
- Step 4: Decide between **P1** (safer medium) vs **P4** (bigger architecture change).

---

## Success criteria per iteration

- `buildStatePath` sample share drops from ~65% to <35% after P0/P1.
- Combined `pickMatch + findBestMatchAt` share drops by at least 25% after P3.
- No interop regressions in `zstdify-tests` encode/decode interoperability tests.
- Compression ratio delta stays within your current tolerance envelope (especially `node-zstd-ratio` tests).

---

If you want, next I can implement **P0** first (the safest high-impact slice) and run the same profile pipeline to quantify before/after hotspot shifts.