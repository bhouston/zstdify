import { planSequences, type GreedyEncodeResult } from './sequencePlanner.js';

export interface FastMatcherOptions {
  history?: Uint8Array;
}

export function buildFastMatcherSequences(input: Uint8Array, options?: FastMatcherOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    chainLimit: 8,
    repScoreBonus: [48, 24, 12],
    lazyDepth: 0,
    searchWindow: 1,
  });
}
