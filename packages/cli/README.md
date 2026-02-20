# zstdify-cli

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

Command-line tool for compressing and decompressing files with zstd. Built on the [zstdify](https://www.npmjs.com/package/zstdify) package (pure TypeScript, no native dependencies).

## Installation

```sh
pnpm add -g zstdify-cli
```

## Commands

| Command | Description |
| ------- | ----------- |
| `zstdify compress <input> <output>` | Compress a file with zstd |
| `zstdify extract <input> <output>` | Decompress a zstd-compressed file |

Aliases: `compress` / `c`, `extract` / `x`.

### Options (compress)

- `--level`, `-l` — Compression level (0=raw, 1+=RLE, 2+=compressed blocks)
- `--checksum` — Add content checksum to the frame

## Examples

```bash
zstdify compress input.txt output.zst
zstdify compress input.txt output.zst --level 2
zstdify extract output.zst restored.txt
```

# License

MIT

## Author

[Ben Houston](https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/zstdify-cli
[npm-url]: https://www.npmjs.com/package/zstdify-cli
[npm-downloads]: https://img.shields.io/npm/dw/zstdify-cli
[npmtrends-url]: https://www.npmtrends.com/zstdify-cli
[tests-badge]: https://github.com/bhouston/zstdify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/zstdify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/zstdify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/zstdify
