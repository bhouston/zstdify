import { type GreedyEncodeResult, planSequences, type SequencePlannerState } from './sequencePlanner.js';

export interface OptimalParserOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
  plannerState?: SequencePlannerState;
}

export function buildOptimalParserSequences(input: Uint8Array, options?: OptimalParserOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    repOffsets: options?.repOffsets,
    plannerState: options?.plannerState,
    chainLimit: 40,
    repScoreBonus: [80, 40, 20],
    lazyDepth: 0,
    searchWindow: 16,
  });
}
