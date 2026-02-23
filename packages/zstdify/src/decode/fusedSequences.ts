import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { buildFSEDecodeTable, type FSEDecodeTable, readNCount } from '../entropy/fse.js';
import {
  LITERALS_LENGTH_DEFAULT_DISTRIBUTION,
  LITERALS_LENGTH_TABLE_LOG,
  MATCH_LENGTH_DEFAULT_DISTRIBUTION,
  MATCH_LENGTH_TABLE_LOG,
  OFFSET_CODE_DEFAULT_DISTRIBUTION,
  OFFSET_CODE_TABLE_LOG,
} from '../entropy/predefined.js';
import { ZstdError } from '../errors.js';
import { appendRangeToHistoryWindow, type HistoryWindow } from './reconstruct.js';
import type { CompressionMode, SequenceSectionMetadata, SequenceTables } from './sequences.js';

export interface FusedDecodeExecuteResult {
  written: number;
  tables: SequenceTables;
  metadata: SequenceSectionMetadata;
}

const LL_BASELINE = new Int32Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048,
  4096, 8192, 16384, 32768, 65536,
]);
const LL_NUMBITS = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

const ML_BASELINE = new Int32Array([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539,
]);
const ML_NUMBITS = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3,
  3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

const DEFAULT_LL_TABLE = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
const DEFAULT_OF_TABLE = buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG);
const DEFAULT_ML_TABLE = buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG);
const RLE_TABLE_CACHE_5: Array<FSEDecodeTable | undefined> = new Array(256);
const RLE_TABLE_CACHE_6: Array<FSEDecodeTable | undefined> = new Array(256);

const FAST_LITERAL_COPY_LOOP_THRESHOLD = 8;
const FAST_SMALL_OFFSET_LOOP_THRESHOLD = 16;
const FAST_HISTORY_COPY_LOOP_THRESHOLD = 16;

function buildRLETable(symbol: number, tableLog: number): FSEDecodeTable {
  const cache = tableLog === 5 ? RLE_TABLE_CACHE_5 : tableLog === 6 ? RLE_TABLE_CACHE_6 : null;
  if (cache) {
    const cached = cache[symbol];
    if (cached) {
      return cached;
    }
  }
  const tableSize = 1 << tableLog;
  const symbolByState = new Uint16Array(tableSize);
  const bitsByState = new Uint8Array(tableSize);
  const baselineByState = new Int32Array(tableSize);
  for (let i = 0; i < tableSize; i++) {
    symbolByState[i] = symbol;
    bitsByState[i] = tableLog;
  }
  const table: FSEDecodeTable = {
    symbol: symbolByState,
    numBits: bitsByState,
    baseline: baselineByState,
    tableLog,
    length: tableSize,
  };
  if (cache) {
    cache[symbol] = table;
  }
  return table;
}

export function decodeAndExecuteSequencesInto(
  blockContent: Uint8Array,
  seqOffset: number,
  seqSize: number,
  prevSeqTables: SequenceTables | null,
  literals: Uint8Array,
  windowSize: number,
  output: Uint8Array,
  outputStart: number,
  repOffsets: [number, number, number],
  history: HistoryWindow,
  updateHistory: boolean,
): FusedDecodeExecuteResult {
  if (seqSize < 2) {
    throw new ZstdError('Sequences section too short', 'corruption_detected');
  }
  const sectionStart = seqOffset;
  let pos = sectionStart;

  let numSequences = blockContent[pos]!;
  pos++;
  if (numSequences >= 128) {
    if (numSequences === 255) {
      if (pos + 2 > sectionStart + seqSize) {
        throw new ZstdError('Sequences section truncated', 'corruption_detected');
      }
      numSequences = blockContent[pos]! + (blockContent[pos + 1]! << 8) + 0x7f00;
      pos += 2;
    } else {
      if (pos >= sectionStart + seqSize) {
        throw new ZstdError('Sequences section truncated', 'corruption_detected');
      }
      numSequences = ((numSequences - 0x80) << 8) + blockContent[pos]!;
      pos++;
    }
  }

  let llMode: CompressionMode = 0;
  let ofMode: CompressionMode = 0;
  let mlMode: CompressionMode = 0;

  let llTable = DEFAULT_LL_TABLE;
  let llTableLog = LITERALS_LENGTH_TABLE_LOG;
  let ofTable = DEFAULT_OF_TABLE;
  let ofTableLog = OFFSET_CODE_TABLE_LOG;
  let mlTable = DEFAULT_ML_TABLE;
  let mlTableLog = MATCH_LENGTH_TABLE_LOG;

  if (numSequences > 0) {
    if (pos >= sectionStart + seqSize) {
      throw new ZstdError('Sequences section truncated', 'corruption_detected');
    }
    const modesByte = blockContent[pos]!;
    pos++;
    llMode = ((modesByte >> 6) & 3) as CompressionMode;
    ofMode = ((modesByte >> 4) & 3) as CompressionMode;
    mlMode = ((modesByte >> 2) & 3) as CompressionMode;
    if ((modesByte & 3) !== 0) {
      throw new ZstdError('Reserved bits set in sequences modes', 'corruption_detected');
    }

    if (llMode === 1) {
      if (pos >= sectionStart + seqSize) throw new ZstdError('Sequences section truncated', 'corruption_detected');
      llTable = buildRLETable(blockContent[pos]!, 6);
      llTableLog = 6;
      pos++;
    } else if (llMode === 2) {
      const result = readNCount(blockContent, pos, 35, 9);
      pos += result.bytesRead;
      llTable = buildFSEDecodeTable(result.normalizedCounter, result.tableLog);
      llTableLog = result.tableLog;
    } else if (llMode === 3) {
      if (!prevSeqTables) throw new ZstdError('Repeat_Mode without previous table', 'corruption_detected');
      llTable = prevSeqTables.llTable;
      llTableLog = prevSeqTables.llTableLog;
    }

    if (ofMode === 1) {
      if (pos >= sectionStart + seqSize) throw new ZstdError('Sequences section truncated', 'corruption_detected');
      ofTable = buildRLETable(blockContent[pos]!, 5);
      ofTableLog = 5;
      pos++;
    } else if (ofMode === 2) {
      const result = readNCount(blockContent, pos, 31, 8);
      pos += result.bytesRead;
      ofTable = buildFSEDecodeTable(result.normalizedCounter, result.tableLog);
      ofTableLog = result.tableLog;
    } else if (ofMode === 3) {
      if (!prevSeqTables) throw new ZstdError('Repeat_Mode without previous table', 'corruption_detected');
      ofTable = prevSeqTables.ofTable;
      ofTableLog = prevSeqTables.ofTableLog;
    }

    if (mlMode === 1) {
      if (pos >= sectionStart + seqSize) throw new ZstdError('Sequences section truncated', 'corruption_detected');
      mlTable = buildRLETable(blockContent[pos]!, 6);
      mlTableLog = 6;
      pos++;
    } else if (mlMode === 2) {
      const result = readNCount(blockContent, pos, 52, 9);
      pos += result.bytesRead;
      mlTable = buildFSEDecodeTable(result.normalizedCounter, result.tableLog);
      mlTableLog = result.tableLog;
    } else if (mlMode === 3) {
      if (!prevSeqTables) throw new ZstdError('Repeat_Mode without previous table', 'corruption_detected');
      mlTable = prevSeqTables.mlTable;
      mlTableLog = prevSeqTables.mlTableLog;
    }
  }

  let outPos = outputStart;
  let litPos = 0;
  let totalMatchLength = 0;
  let repeatOffsetCandidateCount = 0;
  let rep0 = repOffsets[0];
  let rep1 = repOffsets[1];
  let rep2 = repOffsets[2];

  const historyLength = history.length;
  const historyCap = history.buffer.length;
  const historyOldestPos = historyCap > 0 ? (history.writePos - historyLength + historyCap) % historyCap : 0;
  const historyBuffer = history.buffer;

  if (numSequences > 0) {
    const bitstreamSize = sectionStart + seqSize - pos;
    if (bitstreamSize < 1) {
      throw new ZstdError('Sequences bitstream empty', 'corruption_detected');
    }
    const reader = new BitReaderReverse(blockContent, pos, bitstreamSize);
    reader.skipPadding();

    let stateLL = llTableLog > 0 ? reader.readBits(llTableLog) : 0;
    let stateOF = ofTableLog > 0 ? reader.readBits(ofTableLog) : 0;
    let stateML = mlTableLog > 0 ? reader.readBits(mlTableLog) : 0;

    const llTableLength = llTable.length;
    const ofTableLength = ofTable.length;
    const mlTableLength = mlTable.length;
    if (stateOF >>> 0 >= ofTableLength || stateML >>> 0 >= mlTableLength || stateLL >>> 0 >= llTableLength) {
      throw new ZstdError('FSE invalid state', 'corruption_detected');
    }

    const llSymbolByState = llTable.symbol;
    const ofSymbolByState = ofTable.symbol;
    const mlSymbolByState = mlTable.symbol;
    const llNumBitsByState = llTable.numBits;
    const ofNumBitsByState = ofTable.numBits;
    const mlNumBitsByState = mlTable.numBits;
    const llBaselineByState = llTable.baseline;
    const ofBaselineByState = ofTable.baseline;
    const mlBaselineByState = mlTable.baseline;

    const executeOne = (ov: number, ll: number, ml: number): void => {
      if (ov <= 2 || (ov === 3 && ll > 0)) {
        repeatOffsetCandidateCount++;
      }
      totalMatchLength += ml;

      if (ll > 0) {
        const litEnd = litPos + ll;
        if (litEnd > literals.length) {
          throw new ZstdError('Literals overrun while executing sequence', 'corruption_detected');
        }
        if (ll <= FAST_LITERAL_COPY_LOOP_THRESHOLD) {
          for (let i = 0; i < ll; i++) {
            output[outPos + i] = literals[litPos + i]!;
          }
        } else {
          output.set(literals.subarray(litPos, litEnd), outPos);
        }
        outPos += ll;
        litPos = litEnd;
      }

      const ll0 = ll === 0;
      let offset: number;
      let repeatIndex: 0 | 1 | 2 | null = null;
      const isNonRepeat = ov > 3 || (ov === 3 && ll0);
      if (isNonRepeat) {
        if (ov === 3) {
          offset = rep0 - 1;
          if (offset === 0) {
            throw new ZstdError('Invalid match offset: repeat1-1 is 0', 'corruption_detected');
          }
        } else {
          offset = ov - 3;
        }
      } else {
        if (ll0) {
          repeatIndex = ov === 1 ? 1 : 2;
        } else {
          repeatIndex = (ov - 1) as 0 | 1 | 2;
        }
        offset = repeatIndex === 0 ? rep0 : repeatIndex === 1 ? rep1 : rep2;
      }

      const produced = outPos - outputStart;
      const producedPlusHistory = produced + historyLength;
      const maxReachBack = producedPlusHistory < windowSize ? producedPlusHistory : windowSize;
      if (offset <= 0 || offset > maxReachBack) {
        throw new ZstdError(
          `Invalid match offset: offset=${offset} maxReachBack=${maxReachBack} produced=${produced} history=${historyLength} window=${windowSize}`,
          'corruption_detected',
        );
      }

      const historyBytesNeeded = offset > produced ? offset - produced : 0;
      if (ml > 0) {
        if (historyBytesNeeded === 0) {
          const copyStart = outPos - offset;
          if (offset >= ml) {
            output.copyWithin(outPos, copyStart, copyStart + ml);
            outPos += ml;
          } else if (offset <= FAST_SMALL_OFFSET_LOOP_THRESHOLD) {
            for (let i = 0; i < ml; i++) {
              output[outPos + i] = output[outPos - offset + i]!;
            }
            outPos += ml;
          } else {
            let copied = offset;
            output.copyWithin(outPos, copyStart, copyStart + copied);
            outPos += copied;
            while (copied < ml) {
              const toCopy = Math.min(copied, ml - copied);
              output.copyWithin(outPos, outPos - copied, outPos - copied + toCopy);
              outPos += toCopy;
              copied += toCopy;
            }
          }
        } else {
          if (historyCap === 0) {
            throw new ZstdError('Invalid history read', 'corruption_detected');
          }
          const historyCopyLen = Math.min(historyBytesNeeded, ml);
          const historyStart = historyLength - historyBytesNeeded;
          if (historyStart < 0 || historyStart + historyCopyLen > historyLength) {
            throw new ZstdError('Invalid history read', 'corruption_detected');
          }
          let physicalStart = historyOldestPos + historyStart;
          if (physicalStart >= historyCap) {
            physicalStart -= historyCap;
          }
          const firstHistoryChunk = Math.min(historyCopyLen, historyCap - physicalStart);
          const remainingHistoryChunk = historyCopyLen - firstHistoryChunk;
          if (historyCopyLen <= FAST_HISTORY_COPY_LOOP_THRESHOLD) {
            let phys = physicalStart;
            for (let i = 0; i < historyCopyLen; i++) {
              output[outPos + i] = historyBuffer[phys]!;
              phys = phys + 1 === historyCap ? 0 : phys + 1;
            }
            outPos += historyCopyLen;
          } else {
            output.set(historyBuffer.subarray(physicalStart, physicalStart + firstHistoryChunk), outPos);
            outPos += firstHistoryChunk;
            if (remainingHistoryChunk > 0) {
              output.set(historyBuffer.subarray(0, remainingHistoryChunk), outPos);
              outPos += remainingHistoryChunk;
            }
          }

          const matchRemaining = ml - historyCopyLen;
          if (matchRemaining > 0) {
            const copyStart = outPos - offset;
            if (offset >= matchRemaining) {
              output.copyWithin(outPos, copyStart, copyStart + matchRemaining);
              outPos += matchRemaining;
            } else if (offset <= FAST_SMALL_OFFSET_LOOP_THRESHOLD) {
              for (let i = 0; i < matchRemaining; i++) {
                output[outPos + i] = output[outPos - offset + i]!;
              }
              outPos += matchRemaining;
            } else {
              let copied = offset;
              output.copyWithin(outPos, copyStart, copyStart + copied);
              outPos += copied;
              while (copied < matchRemaining) {
                const toCopy = Math.min(copied, matchRemaining - copied);
                output.copyWithin(outPos, outPos - copied, outPos - copied + toCopy);
                outPos += toCopy;
                copied += toCopy;
              }
            }
          }
        }
      }

      if (isNonRepeat) {
        rep2 = rep1;
        rep1 = rep0;
        rep0 = offset;
      } else if (repeatIndex === 1) {
        rep1 = rep0;
        rep0 = offset;
      } else if (repeatIndex === 2) {
        rep2 = rep1;
        rep1 = rep0;
        rep0 = offset;
      }
    };

    const lastSequenceIndex = numSequences - 1;
    for (let i = 0; i < lastSequenceIndex; i++) {
      const offsetCode = ofSymbolByState[stateOF]!;
      const mlCode = mlSymbolByState[stateML]!;
      const llCode = llSymbolByState[stateLL]!;

      const offsetValue = (1 << offsetCode) + reader.readBitsFastOrZero(offsetCode);
      if (mlCode >= ML_BASELINE.length) throw new ZstdError('Invalid match length code', 'corruption_detected');
      if (llCode >= LL_BASELINE.length) throw new ZstdError('Invalid literals length code', 'corruption_detected');

      const mlNumBits = ML_NUMBITS[mlCode]!;
      const mlBase = ML_BASELINE[mlCode]!;
      const matchLength = mlBase + reader.readBitsFastOrZero(mlNumBits);

      const llNumBits = LL_NUMBITS[llCode]!;
      const llBase = LL_BASELINE[llCode]!;
      const literalsLength = llCode <= 15 ? llCode : llBase + reader.readBitsFastOrZero(llNumBits);

      executeOne(offsetValue, literalsLength, matchLength);

      const llBits = llNumBitsByState[stateLL]!;
      const mlBits = mlNumBitsByState[stateML]!;
      const ofBits = ofNumBitsByState[stateOF]!;
      stateLL = llBaselineByState[stateLL]! + reader.readBitsFastOrZero(llBits);
      stateML = mlBaselineByState[stateML]! + reader.readBitsFastOrZero(mlBits);
      stateOF = ofBaselineByState[stateOF]! + reader.readBitsFastOrZero(ofBits);
      if (stateOF >>> 0 >= ofTableLength || stateML >>> 0 >= mlTableLength || stateLL >>> 0 >= llTableLength) {
        throw new ZstdError('FSE invalid state', 'corruption_detected');
      }
    }

    const offsetCode = ofSymbolByState[stateOF]!;
    const mlCode = mlSymbolByState[stateML]!;
    const llCode = llSymbolByState[stateLL]!;
    const offsetValue = (1 << offsetCode) + reader.readBitsFastOrZero(offsetCode);
    if (mlCode >= ML_BASELINE.length) throw new ZstdError('Invalid match length code', 'corruption_detected');
    if (llCode >= LL_BASELINE.length) throw new ZstdError('Invalid literals length code', 'corruption_detected');
    const mlNumBits = ML_NUMBITS[mlCode]!;
    const mlBase = ML_BASELINE[mlCode]!;
    const matchLength = mlBase + reader.readBitsFastOrZero(mlNumBits);
    const llNumBits = LL_NUMBITS[llCode]!;
    const llBase = LL_BASELINE[llCode]!;
    const literalsLength = llCode <= 15 ? llCode : llBase + reader.readBitsFastOrZero(llNumBits);
    executeOne(offsetValue, literalsLength, matchLength);
  }

  if (litPos < literals.length) {
    const remaining = literals.length - litPos;
    if (remaining <= FAST_LITERAL_COPY_LOOP_THRESHOLD) {
      for (let i = 0; i < remaining; i++) {
        output[outPos + i] = literals[litPos + i]!;
      }
    } else {
      output.set(literals.subarray(litPos), outPos);
    }
    outPos += remaining;
  }

  if (updateHistory && outPos > outputStart) {
    appendRangeToHistoryWindow(history, output, outputStart, outPos - outputStart);
  }

  repOffsets[0] = rep0;
  repOffsets[1] = rep1;
  repOffsets[2] = rep2;

  return {
    written: outPos - outputStart,
    tables: { llTable, llTableLog, ofTable, ofTableLog, mlTable, mlTableLog },
    metadata: {
      numSequences,
      llMode,
      ofMode,
      mlMode,
      llTableLog,
      ofTableLog,
      mlTableLog,
      totalMatchLength,
      repeatOffsetCandidateCount,
    },
  };
}
