/**
 * Predefined FSE distributions from RFC 8878 / zstd spec.
 * Used when Predefined_Mode is selected for a symbol type.
 */

export const LITERALS_LENGTH_DEFAULT_DISTRIBUTION: readonly number[] = [
  4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1,
];

export const MATCH_LENGTH_DEFAULT_DISTRIBUTION: readonly number[] = [
  1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
];

export const OFFSET_CODE_DEFAULT_DISTRIBUTION: readonly number[] = [
  1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1,
];

export const LITERALS_LENGTH_TABLE_LOG = 6;
export const MATCH_LENGTH_TABLE_LOG = 6;
export const OFFSET_CODE_TABLE_LOG = 5;
