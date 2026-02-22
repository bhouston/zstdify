/**
 * Decode sequences section from compressed block.
 * Decodes LL, ML, Offset FSE streams and produces Sequence tuples.
 */

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
import { ensurePackedSequencesCapacity, type PackedSequences } from './reconstruct.js';

const LL_BASELINE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048,
  4096, 8192, 16384, 32768, 65536,
];
const LL_NUMBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

const ML_BASELINE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539,
];
const ML_NUMBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3,
  3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

const DEFAULT_LL_TABLE = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
const DEFAULT_OF_TABLE = buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG);
const DEFAULT_ML_TABLE = buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG);
const DEFAULT_SEQUENCE_TABLES: SequenceTables = {
  llTable: DEFAULT_LL_TABLE,
  llTableLog: LITERALS_LENGTH_TABLE_LOG,
  ofTable: DEFAULT_OF_TABLE,
  ofTableLog: OFFSET_CODE_TABLE_LOG,
  mlTable: DEFAULT_ML_TABLE,
  mlTableLog: MATCH_LENGTH_TABLE_LOG,
};

export type CompressionMode = 0 | 1 | 2 | 3;

export interface SequenceTables {
  llTable: FSEDecodeTable;
  llTableLog: number;
  ofTable: FSEDecodeTable;
  ofTableLog: number;
  mlTable: FSEDecodeTable;
  mlTableLog: number;
}

export interface DecodeSequencesResult {
  sequences: PackedSequences;
  tables: SequenceTables;
  bytesRead: number;
  metadata: SequenceSectionMetadata;
}

export interface SequenceSectionMetadata {
  numSequences: number;
  llMode: CompressionMode;
  ofMode: CompressionMode;
  mlMode: CompressionMode;
  llTableLog: number;
  ofTableLog: number;
  mlTableLog: number;
  totalMatchLength: number;
  repeatOffsetCandidateCount: number;
}

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

const RLE_TABLE_CACHE_5: Array<FSEDecodeTable | undefined> = new Array(256);
const RLE_TABLE_CACHE_6: Array<FSEDecodeTable | undefined> = new Array(256);

export function decodeSequences(
  data: Uint8Array,
  offset: number,
  size: number,
  prevTables: SequenceTables | null,
  sequenceReuse?: PackedSequences,
): DecodeSequencesResult {
  if (size < 2) {
    throw new ZstdError('Sequences section too short', 'corruption_detected');
  }

  let pos = offset;

  let numSequences = data[pos]!;
  pos++;
  if (numSequences >= 128) {
    if (numSequences === 255) {
      if (pos + 2 > offset + size) {
        throw new ZstdError('Sequences section truncated', 'corruption_detected');
      }
      numSequences = data[pos]! + (data[pos + 1]! << 8) + 0x7f00;
      pos += 2;
    } else {
      if (pos >= offset + size) {
        throw new ZstdError('Sequences section truncated', 'corruption_detected');
      }
      numSequences = ((numSequences - 0x80) << 8) + data[pos]!;
      pos++;
    }
  }

  if (numSequences === 0) {
    const sequences = ensurePackedSequencesCapacity(sequenceReuse, 0);
    sequences.length = 0;
    return {
      sequences,
      tables: prevTables ?? DEFAULT_SEQUENCE_TABLES,
      bytesRead: pos - offset,
      metadata: {
        numSequences: 0,
        llMode: 0,
        ofMode: 0,
        mlMode: 0,
        llTableLog: (prevTables ?? DEFAULT_SEQUENCE_TABLES).llTableLog,
        ofTableLog: (prevTables ?? DEFAULT_SEQUENCE_TABLES).ofTableLog,
        mlTableLog: (prevTables ?? DEFAULT_SEQUENCE_TABLES).mlTableLog,
        totalMatchLength: 0,
        repeatOffsetCandidateCount: 0,
      },
    };
  }

  if (pos >= offset + size) {
    throw new ZstdError('Sequences section truncated', 'corruption_detected');
  }

  const modesByte = data[pos]!;
  pos++;
  const llMode = (modesByte >> 6) & 3;
  const ofMode = (modesByte >> 4) & 3;
  const mlMode = (modesByte >> 2) & 3;
  if ((modesByte & 3) !== 0) {
    throw new ZstdError('Reserved bits set in sequences modes', 'corruption_detected');
  }

  let llTable = DEFAULT_LL_TABLE;
  let llTableLog = LITERALS_LENGTH_TABLE_LOG;
  let ofTable = DEFAULT_OF_TABLE;
  let ofTableLog = OFFSET_CODE_TABLE_LOG;
  let mlTable = DEFAULT_ML_TABLE;
  let mlTableLog = MATCH_LENGTH_TABLE_LOG;

  if (llMode === 0) {
    llTable = DEFAULT_LL_TABLE;
    llTableLog = LITERALS_LENGTH_TABLE_LOG;
  } else if (llMode === 1) {
    if (pos >= offset + size) throw new ZstdError('Sequences section truncated', 'corruption_detected');
    const sym = data[pos]!;
    pos++;
    llTable = buildRLETable(sym, 6);
    llTableLog = 6;
  } else if (llMode === 2) {
    const result = readNCount(data, pos, 35, 9);
    pos += result.bytesRead;
    llTable = buildFSEDecodeTable(result.normalizedCounter, result.tableLog);
    llTableLog = result.tableLog;
  } else {
    if (!prevTables) throw new ZstdError('Repeat_Mode without previous table', 'corruption_detected');
    llTable = prevTables.llTable;
    llTableLog = prevTables.llTableLog;
  }

  if (ofMode === 0) {
    ofTable = DEFAULT_OF_TABLE;
    ofTableLog = OFFSET_CODE_TABLE_LOG;
  } else if (ofMode === 1) {
    if (pos >= offset + size) throw new ZstdError('Sequences section truncated', 'corruption_detected');
    const sym = data[pos]!;
    pos++;
    ofTable = buildRLETable(sym, 5);
    ofTableLog = 5;
  } else if (ofMode === 2) {
    const result = readNCount(data, pos, 31, 8);
    pos += result.bytesRead;
    ofTable = buildFSEDecodeTable(result.normalizedCounter, result.tableLog);
    ofTableLog = result.tableLog;
  } else {
    if (!prevTables) throw new ZstdError('Repeat_Mode without previous table', 'corruption_detected');
    ofTable = prevTables.ofTable;
    ofTableLog = prevTables.ofTableLog;
  }

  if (mlMode === 0) {
    mlTable = DEFAULT_ML_TABLE;
    mlTableLog = MATCH_LENGTH_TABLE_LOG;
  } else if (mlMode === 1) {
    if (pos >= offset + size) throw new ZstdError('Sequences section truncated', 'corruption_detected');
    const sym = data[pos]!;
    pos++;
    mlTable = buildRLETable(sym, 6);
    mlTableLog = 6;
  } else if (mlMode === 2) {
    const result = readNCount(data, pos, 52, 9);
    pos += result.bytesRead;
    mlTable = buildFSEDecodeTable(result.normalizedCounter, result.tableLog);
    mlTableLog = result.tableLog;
  } else {
    if (!prevTables) throw new ZstdError('Repeat_Mode without previous table', 'corruption_detected');
    mlTable = prevTables.mlTable;
    mlTableLog = prevTables.mlTableLog;
  }

  const bitstreamStart = pos;
  const bitstreamSize = offset + size - pos;
  if (bitstreamSize < 1) {
    throw new ZstdError('Sequences bitstream empty', 'corruption_detected');
  }
  const bitstream = data.subarray(bitstreamStart, bitstreamStart + bitstreamSize);

  const totalStateBits = llTableLog + ofTableLog + mlTableLog;
  if (bitstreamSize * 8 < totalStateBits) {
    throw new ZstdError('Sequences bitstream too short for initial states', 'corruption_detected');
  }
  const reader = new BitReaderReverse(bitstream, 0, bitstreamSize);
  reader.skipPadding();
  // Initial states are read in LL, OF, ML order.
  let stateLL = llTableLog > 0 ? reader.readBits(llTableLog) : 0;
  let stateOF = ofTableLog > 0 ? reader.readBits(ofTableLog) : 0;
  let stateML = mlTableLog > 0 ? reader.readBits(mlTableLog) : 0;
  const llTableLength = llTable.length;
  const ofTableLength = ofTable.length;
  const mlTableLength = mlTable.length;
  const hasInvalidState = (ll: number, of: number, ml: number): boolean =>
    (of >>> 0) >= ofTableLength || (ml >>> 0) >= mlTableLength || (ll >>> 0) >= llTableLength;
  if (hasInvalidState(stateLL, stateOF, stateML)) {
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

  const sequences = ensurePackedSequencesCapacity(sequenceReuse, numSequences);
  const sequenceLiteralsLength = sequences.literalsLength;
  const sequenceOffsets = sequences.offset;
  const sequenceMatchLengths = sequences.matchLength;
  let totalMatchLength = 0;
  let repeatOffsetCandidateCount = 0;
  const lastSequenceIndex = numSequences - 1;
  for (let i = 0; i < lastSequenceIndex; i++) {
    // Per spec, sequence tuple decode order is OF, ML, LL.
    const offsetCode = ofSymbolByState[stateOF]!;
    const mlCode = mlSymbolByState[stateML]!;
    const llCode = llSymbolByState[stateLL]!;

    const offsetValue = (1 << offsetCode) + (offsetCode > 0 ? reader.readBitsFast(offsetCode) : 0);

    if (mlCode >= ML_BASELINE.length) {
      throw new ZstdError('Invalid match length code', 'corruption_detected');
    }
    const mlNumBits = ML_NUMBITS[mlCode]!;
    const mlBase = ML_BASELINE[mlCode]!;
    const matchLength = mlBase + (mlNumBits > 0 ? reader.readBitsFast(mlNumBits) : 0);

    if (llCode >= LL_BASELINE.length) {
      throw new ZstdError('Invalid literals length code', 'corruption_detected');
    }
    const llNumBits = LL_NUMBITS[llCode]!;
    const llBase = LL_BASELINE[llCode]!;
    const literalsLength = llCode <= 15 ? llCode : llBase + (llNumBits > 0 ? reader.readBitsFast(llNumBits) : 0);
    sequenceLiteralsLength[i] = literalsLength;
    sequenceOffsets[i] = offsetValue;
    sequenceMatchLengths[i] = matchLength;
    totalMatchLength += matchLength;
    if (offsetValue <= 2 || (offsetValue === 3 && literalsLength > 0)) {
      repeatOffsetCandidateCount++;
    }

    // State updates for next sequence are LL, ML, OF.
    const llBits = llNumBitsByState[stateLL]!;
    const mlBits = mlNumBitsByState[stateML]!;
    const ofBits = ofNumBitsByState[stateOF]!;
    stateLL = llBaselineByState[stateLL]! + (llBits > 0 ? reader.readBitsFast(llBits) : 0);
    stateML = mlBaselineByState[stateML]! + (mlBits > 0 ? reader.readBitsFast(mlBits) : 0);
    stateOF = ofBaselineByState[stateOF]! + (ofBits > 0 ? reader.readBitsFast(ofBits) : 0);
    if (hasInvalidState(stateLL, stateOF, stateML)) {
      throw new ZstdError('FSE invalid state', 'corruption_detected');
    }
  }
  const offsetCode = ofSymbolByState[stateOF]!;
  const mlCode = mlSymbolByState[stateML]!;
  const llCode = llSymbolByState[stateLL]!;
  const offsetValue = (1 << offsetCode) + (offsetCode > 0 ? reader.readBitsFast(offsetCode) : 0);
  if (mlCode >= ML_BASELINE.length) {
    throw new ZstdError('Invalid match length code', 'corruption_detected');
  }
  const mlNumBits = ML_NUMBITS[mlCode]!;
  const mlBase = ML_BASELINE[mlCode]!;
  const matchLength = mlBase + (mlNumBits > 0 ? reader.readBitsFast(mlNumBits) : 0);
  if (llCode >= LL_BASELINE.length) {
    throw new ZstdError('Invalid literals length code', 'corruption_detected');
  }
  const llNumBits = LL_NUMBITS[llCode]!;
  const llBase = LL_BASELINE[llCode]!;
  const literalsLength = llCode <= 15 ? llCode : llBase + (llNumBits > 0 ? reader.readBitsFast(llNumBits) : 0);
  sequenceLiteralsLength[lastSequenceIndex] = literalsLength;
  sequenceOffsets[lastSequenceIndex] = offsetValue;
  sequenceMatchLengths[lastSequenceIndex] = matchLength;
  totalMatchLength += matchLength;
  if (offsetValue <= 2 || (offsetValue === 3 && literalsLength > 0)) {
    repeatOffsetCandidateCount++;
  }

  sequences.length = numSequences;
  return {
    sequences,
    tables: { llTable, llTableLog, ofTable, ofTableLog, mlTable, mlTableLog },
    bytesRead: size,
    metadata: {
      numSequences,
      llMode: llMode as CompressionMode,
      ofMode: ofMode as CompressionMode,
      mlMode: mlMode as CompressionMode,
      llTableLog,
      ofTableLog,
      mlTableLog,
      totalMatchLength,
      repeatOffsetCandidateCount,
    },
  };
}
