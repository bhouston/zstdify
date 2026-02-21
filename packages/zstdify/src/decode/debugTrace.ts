export interface DecodeTraceLiteralsInfo {
  blockType: 0 | 1 | 2 | 3;
  regeneratedSize: number;
  compressedSize?: number;
  numStreams: 1 | 4;
  headerSize: number;
}

export interface DecodeTraceSequencesInfo {
  numSequences: number;
  llMode: 0 | 1 | 2 | 3;
  ofMode: 0 | 1 | 2 | 3;
  mlMode: 0 | 1 | 2 | 3;
  llTableLog: number;
  ofTableLog: number;
  mlTableLog: number;
  repeatOffsetCandidateCount: number;
}

export interface DecodeTraceBlockInfo {
  blockIndex: number;
  blockType: 0 | 1 | 2;
  blockSize: number;
  lastBlock: boolean;
  inputOffset: number;
  outputStart: number;
  outputEnd: number;
  literals?: DecodeTraceLiteralsInfo;
  sequences?: DecodeTraceSequencesInfo;
}

export interface DecodeTrace {
  onBlockDecoded?(info: DecodeTraceBlockInfo): void;
}
