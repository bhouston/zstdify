import { buildFastMatcherSequences } from './fastMatcher.js';
import { buildLazyMatcherSequences } from './lazyMatcher.js';
import { buildOptimalParserSequences } from './optimalParser.js';
import type { GreedyEncodeResult, SequencePlannerState } from './sequencePlanner.js';

export type SequenceCompressionStrategy = 'fast' | 'lazy' | 'optimal';

export interface BuildSequenceOptions {
  strategy?: SequenceCompressionStrategy;
  history?: Uint8Array;
  repOffsets?: [number, number, number];
  plannerState?: SequencePlannerState;
}

export type { GreedyEncodeResult } from './sequencePlanner.js';

export function buildGreedySequences(input: Uint8Array, options?: BuildSequenceOptions): GreedyEncodeResult {
  const strategy = options?.strategy ?? 'fast';
  if (strategy === 'lazy') {
    return buildLazyMatcherSequences(input, {
      history: options?.history,
      repOffsets: options?.repOffsets,
      plannerState: options?.plannerState,
    });
  }
  if (strategy === 'optimal') {
    return buildOptimalParserSequences(input, {
      history: options?.history,
      repOffsets: options?.repOffsets,
      plannerState: options?.plannerState,
    });
  }
  return buildFastMatcherSequences(input, {
    history: options?.history,
    repOffsets: options?.repOffsets,
    plannerState: options?.plannerState,
  });
}
