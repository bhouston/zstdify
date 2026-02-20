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
});
