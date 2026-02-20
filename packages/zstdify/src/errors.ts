/**
 * Deterministic error type for zstd operations.
 */
export class ZstdError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ZstdError';
    Object.setPrototypeOf(this, ZstdError.prototype);
  }
}
