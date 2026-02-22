import { type GreedyEncodeResult, planSequences } from './sequencePlanner.js';

export interface OptimalParserOptions {
  history?: Uint8Array;
  repOffsets?: [number, number, number];
}

export function buildOptimalParserSequences(input: Uint8Array, options?: OptimalParserOptions): GreedyEncodeResult {
  return planSequences(input, {
    history: options?.history,
    repOffsets: options?.repOffsets,
    chainLimit: 40,
    repScoreBonus: [80, 40, 20],
    lazyDepth: 0,
    searchWindow: 16,
  });
}
