# zstdify

Pure TypeScript zstd compression library. No native dependencies, works in Node.js and browsers.

## Status

- **Decoder**: Raw and RLE blocks supported. Compressed blocks (Huffman/FSE) planned.
- **Encoder**: Raw blocks baseline plus RLE block emission for repeated-byte chunks at `level > 0`. General compressed blocks are still planned.
- **Format**: RFC 8878 compliant for supported features.

## Usage

```ts
import { compress, decompress } from 'zstdify';

const data = new TextEncoder().encode('hello world');
const compressed = compress(data);
const restored = decompress(compressed);
// restored equals data
```

## API

- `compress(input: Uint8Array, options?: { level?: number }): Uint8Array`
- `decompress(input: Uint8Array, options?: { maxSize?: number }): Uint8Array`

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm check
```

## Project structure

- `packages/zstdify` - Core library
- `packages/zstdify-tests` - Integration tests
