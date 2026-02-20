import { describe, expect, it } from 'vitest';
import { ZstdError } from './errors.js';

describe('ZstdError', () => {
  it('has correct name, message, and code', () => {
    const e = new ZstdError('test message', 'corruption_detected');
    expect(e.name).toBe('ZstdError');
    expect(e.message).toBe('test message');
    expect(e.code).toBe('corruption_detected');
  });

  it('is instanceof Error and ZstdError', () => {
    const e = new ZstdError('x', 'parameter_unsupported');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ZstdError);
  });
});
