import type { PackedSequences } from './reconstruct.js';
import { executeSequencesIntoFast, type HistoryWindow } from './reconstruct.js';
import { decodeSequences, type DecodeSequencesResult, type SequenceTables } from './sequences.js';

export interface FusedDecodeExecuteResult {
  written: number;
  seqResult: DecodeSequencesResult;
}

export function shouldUseFusedSequencePath(
  seqSize: number,
  literalsLength: number,
  windowSize: number,
  updateHistory: boolean,
): boolean {
  if (seqSize < 4) {
    return false;
  }
  if (literalsLength === 0) {
    return false;
  }
  // For very large windows with history tracking enabled, the non-fused route can be more stable.
  if (updateHistory && windowSize > 8 * 1024 * 1024) {
    return false;
  }
  return true;
}

export function decodeAndExecuteSequencesInto(
  blockContent: Uint8Array,
  seqOffset: number,
  seqSize: number,
  prevSeqTables: SequenceTables | null,
  sequenceReuse: PackedSequences | undefined,
  literals: Uint8Array,
  windowSize: number,
  ensureOutputCapacity: (additional: number) => void,
  getOutputBuffer: () => Uint8Array,
  outputStart: number,
  repOffsets: [number, number, number],
  history: HistoryWindow,
  updateHistory: boolean,
): FusedDecodeExecuteResult {
  const seqResult = decodeSequences(blockContent, seqOffset, seqSize, prevSeqTables, sequenceReuse);
  if (seqResult.sequences.length === 0) {
    return { written: 0, seqResult };
  }
  ensureOutputCapacity(literals.length + seqResult.metadata.totalMatchLength);
  const output = getOutputBuffer();
  const written = executeSequencesIntoFast(
    literals,
    seqResult.sequences,
    windowSize,
    output,
    outputStart,
    repOffsets,
    history,
    updateHistory,
  );
  return { written, seqResult };
}
