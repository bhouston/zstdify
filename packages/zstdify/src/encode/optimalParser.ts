import { planSequences, type GreedyEncodeResult } from './sequencePlanner.js';

export interface OptimalParserOptions {
  history?: Uint8Array;
}

export function buildOptimalParserSequences(input: Uint8Array, options?: OptimalParserOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    chainLimit: 40,
    repScoreBonus: [80, 40, 20],
    lazyDepth: 0,
    searchWindow: 16,
  });
}
