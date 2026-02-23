import { describe, expect, it } from 'vitest';
import { executeSequences } from '../decode/reconstruct.js';
import { buildGreedySequences } from './greedySequences.js';

describe('buildGreedySequences', () => {
  it('reconstructs repetitive text via generated sequences', () => {
    const input = new TextEncoder().encode('hello world hello world hello world hello world hello world ');
    const plan = buildGreedySequences(input);
    const output = executeSequences(plan.literals, plan.sequences, 128 * 1024);
    expect(output).toEqual(input);
    expect(plan.sequences.length).toBeGreaterThan(0);
  });

  it('reconstructs binary payload via generated sequences', () => {
    const input = new Uint8Array(4096);
    for (let i = 0; i < input.length; i++) {
      input[i] = i & 0xff;
    }
    const doubled = new Uint8Array(input.length * 2);
    doubled.set(input, 0);
    doubled.set(input, input.length);
    const plan = buildGreedySequences(doubled);
    const output = executeSequences(plan.literals, plan.sequences, 128 * 1024);
    expect(output).toEqual(doubled);
    expect(plan.sequences.length).toBeGreaterThan(0);
  });

  it('returns literals-only result when no matches exist', () => {
    const input = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz');
    const plan = buildGreedySequences(input);
    expect(plan.sequences).toEqual([]);
    expect(plan.literals).toEqual(input);
    expect(plan.trailingLiterals).toBe(input.length);
  });

  it('supports lazy and optimal strategy modes', () => {
    const input = new TextEncoder().encode('phase-one strategy strategy strategy phase-one strategy strategy');
    const lazyPlan = buildGreedySequences(input, { strategy: 'lazy' });
    const optimalPlan = buildGreedySequences(input, { strategy: 'optimal' });
    expect(executeSequences(lazyPlan.literals, lazyPlan.sequences, 128 * 1024)).toEqual(input);
    expect(executeSequences(optimalPlan.literals, optimalPlan.sequences, 128 * 1024)).toEqual(input);
    expect(lazyPlan.sequences.length).toBeGreaterThan(0);
    expect(optimalPlan.sequences.length).toBeGreaterThan(0);
  });

  it('matches from provided history prefix', () => {
    const history = new TextEncoder().encode('history-prefix-used-for-matching-');
    const input = new TextEncoder().encode('history-prefix-used-for-matching-and-then-more');
    const plan = buildGreedySequences(input, { strategy: 'fast', history });
    const output = executeSequences(plan.literals, plan.sequences, 128 * 1024, [1, 4, 8], history);
    expect(output).toEqual(input);
    expect(plan.sequences.length).toBeGreaterThan(0);
  });

  it('reconstructs json-event-like corpus payload in fast mode', () => {
    const input = new TextEncoder().encode(
      Array.from(
        { length: 240 },
        (_, i) =>
          `{"event":"view","screen":"home","user":"u-${100 + (i % 30)}","platform":"ios","version":"1.2.0","exp":"A"}`,
      ).join('\n'),
    );
    const plan = buildGreedySequences(input, { strategy: 'fast' });
    const output = executeSequences(plan.literals, plan.sequences, 128 * 1024);
    expect(output).toEqual(input);
  });
});
