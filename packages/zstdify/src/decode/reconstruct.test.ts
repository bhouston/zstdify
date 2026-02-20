import { describe, expect, it } from 'vitest';
import { executeSequences, type Sequence } from './reconstruct.js';

describe('executeSequences', () => {
  it('does not over-allocate output when sequences consume literals', () => {
    const literals = new TextEncoder().encode('abcd');
    const sequences: Sequence[] = [
      {
        literalsLength: 4, // "abcd"
        offset: 4, // copy "ab" from start
        matchLength: 2,
      },
    ];

    const output = executeSequences(literals, sequences, 128 * 1024);
    expect(new TextDecoder().decode(output)).toBe('abcdab');
    expect(output.length).toBe(6);
  });
});
