/**
 * Decode sequences section from compressed block.
 * Decodes LL, ML, Offset FSE streams and produces Sequence tuples.
 */

import { BitReaderReverse } from '../bitstream/bitReaderReverse.js';
import { ZstdError } from '../errors.js';
import {
  buildFSEDecodeTable,
  type FSEDecodeRow,
  readNCount,
} from '../entropy/fse.js';
import {
  LITERALS_LENGTH_DEFAULT_DISTRIBUTION,
  LITERALS_LENGTH_TABLE_LOG,
  MATCH_LENGTH_DEFAULT_DISTRIBUTION,
  MATCH_LENGTH_TABLE_LOG,
  OFFSET_CODE_DEFAULT_DISTRIBUTION,
  OFFSET_CODE_TABLE_LOG,
} from '../entropy/predefined.js';
import type { Sequence } from './reconstruct.js';

const LL_BASELINE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096,
  8192, 16384, 32768, 65536,
];
const LL_NUMBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12,
  13, 14, 15, 16,
];

const ML_BASELINE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
  35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051,
  4099, 8195, 16387, 32771, 65539,
];
const ML_NUMBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16,
];

export type CompressionMode = 0 | 1 | 2 | 3;

export interface SequenceTables {
  llTable: FSEDecodeRow[];
  llTableLog: number;
  ofTable: FSEDecodeRow[];
  ofTableLog: number;
  mlTable: FSEDecodeRow[];
  mlTableLog: number;
}

export interface DecodeSequencesResult {
  sequences: Sequence[];
  tables: SequenceTables;
  bytesRead: number;
}

function getStateRow(table: readonly FSEDecodeRow[], stateValue: number): FSEDecodeRow {
  const row = table[stateValue];
  if (!row) {
    throw new ZstdError('FSE invalid state', 'corruption_detected');
  }
  return row;
}

function buildRLETable(symbol: number, tableLog: number): FSEDecodeRow[] {
  const tableSize = 1 << tableLog;
  const table: FSEDecodeRow[] = new Array(tableSize);
  for (let i = 0; i < tableSize; i++) {
    table[i] = { symbol, numBits: tableLog, baseline: 0 };
  }
  return table;
}

export function decodeSequences(
  data: Uint8Array,
  offset: number,
  size: number,
  prevTables: SequenceTables | null,
): DecodeSequencesResult {
  if (size < 2) {
    throw new ZstdError('Sequences section too short', 'corruption_detected');
  }

  let pos = offset;

  let numSequences = data[pos] ?? 0;
  pos++;
  if (numSequences >= 128) {
    if (numSequences === 255) {
      if (pos + 2 > offset + size) {
        throw new ZstdError('Sequences section truncated', 'corruption_detected');
      }
      numSequences = (data[pos] ?? 0) + ((data[pos + 1] ?? 0) << 8) + 0x7f00;
      pos += 2;
    } else {
      if (pos >= offset + size) {
        throw new ZstdError('Sequences section truncated', 'corruption_detected');
      }
      numSequences = ((numSequences - 0x80) << 8) + (data[pos] ?? 0);
      pos++;
    }
  }

  if (numSequences === 0) {
    return {
      sequences: [],
      tables: prevTables ?? {
        llTable: buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG),
        llTableLog: LITERALS_LENGTH_TABLE_LOG,
        ofTable: buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG),
        ofTableLog: OFFSET_CODE_TABLE_LOG,
        mlTable: buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG),
        mlTableLog: MATCH_LENGTH_TABLE_LOG,
      },
      bytesRead: pos - offset,
    };
  }

  if (pos >= offset + size) {
    throw new ZstdError('Sequences section truncated', 'corruption_detected');
  }

  const modesByte = data[pos] ?? 0;
  pos++;
  const llMode = (modesByte >> 6) & 3;
  const ofMode = (modesByte >> 4) & 3;
  const mlMode = (modesByte >> 2) & 3;
  if ((modesByte & 3) !== 0) {
    throw new ZstdError('Reserved bits set in sequences modes', 'corruption_detected');
  }

  let llTable = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
  let llTableLog = LITERALS_LENGTH_TABLE_LOG;
  let ofTable = buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG);
  let ofTableLog = OFFSET_CODE_TABLE_LOG;
  let mlTable = buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG);
  let mlTableLog = MATCH_LENGTH_TABLE_LOG;

  const getLLTable = () => {
    if (llMode === 0) {
      llTable = buildFSEDecodeTable(LITERALS_LENGTH_DEFAULT_DISTRIBUTION, LITERALS_LENGTH_TABLE_LOG);
      llTableLog = LITERALS_LENGTH_TABLE_LOG;
    } else if (llMode === 1) {
      if (pos >= offset + size) throw new ZstdError('Sequences section truncated', 'corruption_detected');
      const sym = data[pos] ?? 0;
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
  };

  const getOFTable = () => {
    if (ofMode === 0) {
      ofTable = buildFSEDecodeTable(OFFSET_CODE_DEFAULT_DISTRIBUTION, OFFSET_CODE_TABLE_LOG);
      ofTableLog = OFFSET_CODE_TABLE_LOG;
    } else if (ofMode === 1) {
      if (pos >= offset + size) throw new ZstdError('Sequences section truncated', 'corruption_detected');
      const sym = data[pos] ?? 0;
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
  };

  const getMLTable = () => {
    if (mlMode === 0) {
      mlTable = buildFSEDecodeTable(MATCH_LENGTH_DEFAULT_DISTRIBUTION, MATCH_LENGTH_TABLE_LOG);
      mlTableLog = MATCH_LENGTH_TABLE_LOG;
    } else if (mlMode === 1) {
      if (pos >= offset + size) throw new ZstdError('Sequences section truncated', 'corruption_detected');
      const sym = data[pos] ?? 0;
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
  };

  getLLTable();
  getOFTable();
  getMLTable();

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
  const readBitsSafe = (numBits: number): number => {
    if (numBits <= 0) return 0;
    try {
      return reader.readBits(numBits);
    } catch {
      // zstd decoders treat over-read tail bits as zeroes on final states.
      return 0;
    }
  };
  // Initial states are read in LL, OF, ML order.
  const stateLL = { value: readBitsSafe(llTableLog) };
  const stateOF = { value: readBitsSafe(ofTableLog) };
  const stateML = { value: readBitsSafe(mlTableLog) };

  const sequences: Sequence[] = [];

  for (let i = 0; i < numSequences; i++) {
    const isLast = i === numSequences - 1;
    // Per spec, sequence tuple decode order is OF, ML, LL.
    const ofRow = getStateRow(ofTable, stateOF.value);
    const mlRow = getStateRow(mlTable, stateML.value);
    const llRow = getStateRow(llTable, stateLL.value);
    const offsetCode = ofRow.symbol;
    const mlCode = mlRow.symbol;
    const llCode = llRow.symbol;

    const offsetValue = (1 << offsetCode) + (offsetCode > 0 ? readBitsSafe(offsetCode) : 0);

    const matchLength = mlCode <= 31
      ? mlCode + 3
      : (ML_BASELINE[mlCode] ?? 0) + readBitsSafe(ML_NUMBITS[mlCode] ?? 0);

    const literalsLength = llCode <= 15
      ? llCode
      : (LL_BASELINE[llCode] ?? 0) + readBitsSafe(LL_NUMBITS[llCode] ?? 0);

    sequences.push({
      literalsLength,
      offset: offsetValue,
      matchLength,
    });

    if (!isLast) {
      // State updates for next sequence are LL, ML, OF.
      stateLL.value = llRow.baseline + (llRow.numBits > 0 ? readBitsSafe(llRow.numBits) : 0);
      stateML.value = mlRow.baseline + (mlRow.numBits > 0 ? readBitsSafe(mlRow.numBits) : 0);
      stateOF.value = ofRow.baseline + (ofRow.numBits > 0 ? readBitsSafe(ofRow.numBits) : 0);
    }
  }

  return {
    sequences,
    tables: { llTable, llTableLog, ofTable, ofTableLog, mlTable, mlTableLog },
    bytesRead: size,
  };
}
