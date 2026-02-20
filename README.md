# zstdify

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

Pure TypeScript zstd compression library. No native dependencies, works in Node.js and browsers.

## Status

- **Decoder**: Raw and RLE blocks supported. Compressed blocks (Huffman/FSE) planned.
- **Encoder**: Raw baseline, RLE blocks for repeated-byte chunks (`level > 0`), plus an initial compressed-block path (`level > 1`) for selected single-sequence blocks with raw fallback.
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

## CLI Tool

The **zstdify-cli** package is a command-line tool for compressing and decompressing files with zstd. Install from npm:

```sh
pnpm add -g zstdify-cli
```

```bash
zstdify compress input.txt output.zst
zstdify extract output.zst restored.txt
```

See [packages/cli/README.md](packages/cli/README.md) for full CLI documentation.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm check
```

## Publishing

Publish the npm packages (library first, then CLI so it gets the correct `zstdify` version):

```bash
pnpm make-release:zstdify
pnpm make-release:cli
```

## Project structure

- `packages/zstdify` - Core library
- `packages/cli` - CLI tool (`zstdify-cli` on npm)
- `packages/zstdify-tests` - Integration tests

# License

MIT

## Author

[Ben Houston](https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/zstdify
[npm-url]: https://www.npmjs.com/package/zstdify
[npm-downloads]: https://img.shields.io/npm/dw/zstdify
[npmtrends-url]: https://www.npmtrends.com/zstdify
[tests-badge]: https://github.com/bhouston/zstdify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/zstdify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/zstdify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/zstdify
