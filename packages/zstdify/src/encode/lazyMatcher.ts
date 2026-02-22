import { type GreedyEncodeResult, type SequencePlannerState, planSequences } from './sequencePlanner.js';

export interface LazyMatcherOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
  plannerState?: SequencePlannerState;
}

export function buildLazyMatcherSequences(input: Uint8Array, options?: LazyMatcherOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    repOffsets: options?.repOffsets,
    plannerState: options?.plannerState,
    chainLimit: 20,
    repScoreBonus: [64, 32, 16],
    lazyDepth: 2,
    searchWindow: 4,
  });
}
