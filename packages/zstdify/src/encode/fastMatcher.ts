import { type GreedyEncodeResult, type SequencePlannerState, planSequences } from './sequencePlanner.js';

export interface FastMatcherOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
  plannerState?: SequencePlannerState;
}

export function buildFastMatcherSequences(input: Uint8Array, options?: FastMatcherOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    repOffsets: options?.repOffsets,
    plannerState: options?.plannerState,
    chainLimit: 8,
    repScoreBonus: [48, 24, 12],
    lazyDepth: 0,
    searchWindow: 1,
  });
}
