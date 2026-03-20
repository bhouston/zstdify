import { Writable, type WritableOptions } from 'node:stream';

export default class BufferWritable extends Writable {
  #buf: Array<Buffer>;

  constructor(options: WritableOptions) {
    super(options);
    this.#buf = [];
  }

  override _write(chunk: Buffer, encoding: string, callback: () => void = () => null) {
    this.#buf.push(chunk);
    callback();
  }

  override _writev(chunks: Array<{ chunk: Buffer; encoding: string }>, callback: () => void = () => null) {
    for (const { chunk } of chunks) {
      this.#buf.push(chunk);
    }
    callback();
  }

  override _final(callback: () => void = () => null) {
    callback();
  }

  getBuffer(): Buffer {
    return Buffer.concat(this.#buf) || Buffer.alloc(0);
  }
}
