import { type GreedyEncodeResult, planSequences } from './sequencePlanner.js';

export interface LazyMatcherOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
}

export function buildLazyMatcherSequences(input: Uint8Array, options?: LazyMatcherOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    repOffsets: options?.repOffsets,
    chainLimit: 20,
    repScoreBonus: [64, 32, 16],
    lazyDepth: 2,
    searchWindow: 4,
  });
}
