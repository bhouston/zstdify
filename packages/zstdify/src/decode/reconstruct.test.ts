import { describe, expect, it } from 'vitest';
import { executeSequences, type Sequence } from './reconstruct.js';

describe('executeSequences', () => {
  it('does not over-allocate output when sequences consume literals', () => {
    const literals = new TextEncoder().encode('abcd');
    const sequences: Sequence[] = [
      {
        literalsLength: 4, // "abcd"
        offset: 7, // offsetValue 7 => actual offset 4
        matchLength: 2,
      },
    ];

    const output = executeSequences(literals, sequences, 128 * 1024);
    expect(new TextDecoder().decode(output)).toBe('abcdab');
    expect(output.length).toBe(6);
  });

  it('supports match copies from previous block history', () => {
    const history = new TextEncoder().encode('wxyz');
    const literals = new Uint8Array(0);
    const sequences: Sequence[] = [
      {
        literalsLength: 0,
        offset: 7, // Offset_Value 7 => actual offset 4
        matchLength: 4,
      },
    ];

    const output = executeSequences(literals, sequences, 128 * 1024, [1, 4, 8], history);
    expect(new TextDecoder().decode(output)).toBe('wxyz');
  });

  it('rejects rep1-1 when it becomes zero', () => {
    const literals = new Uint8Array(0);
    const sequences: Sequence[] = [
      {
        literalsLength: 0,
        offset: 3,
        matchLength: 1,
      },
    ];

    expect(() => executeSequences(literals, sequences, 128 * 1024, [1, 4, 8])).toThrowError(/repeat1-1/i);
  });
});
