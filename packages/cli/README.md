# zstdify-cli

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

![Zstdify Logo](https://raw.githubusercontent.com/bhouston/zstdify/main/logo.webp)

Command-line tool for compressing and decompressing files with zstd. Built on the [zstdify](https://www.npmjs.com/package/zstdify) package (pure TypeScript, no native dependencies).

## Features

- **Pure JS/TS zstd CLI**: No native addon dependency, portable across Node.js environments.
- **Compression + extraction workflows**: Simple file-to-file commands with level/checksum controls.
- **Interop-focused**: Files produced by `zstdify` are decoded by the official `zstd` CLI, and `zstd` output is decoded by `zstdify`.
- **Robust command UX**: Clear subcommands, aliases, and actionable error messages.
- **Optional dictionary support**: Train dictionaries from samples and use them with `compress`/`extract` when needed.

## Installation

```sh
pnpm add -g zstdify-cli
```

## Commands

| Command                                         | Description                                      |
| ----------------------------------------------- | ------------------------------------------------ |
| `zstdify compress <input> <output>`             | Compress a file with zstd                        |
| `zstdify extract <input> <output>`              | Decompress a zstd-compressed file                |
| `zstdify dict train <output> --input <path>...` | Train a dictionary from sample files/directories |

Aliases: `compress` / `c`, `extract` / `x`.

### Options (compress)

- `--level`, `-l` — Compression level (0=raw, 1+=RLE, 2+=compressed blocks)
- `--checksum` — Add content checksum to the frame
- `--dict` — Dictionary file path to use for compression
- `--dictID` — Dictionary ID to store in the frame header
- `--noDictId` — Do not write dictID in frame header

### Options (extract)

- `--dict` — Dictionary file path for dictionary-compressed input
- `--dictID` — Expected dictionary ID for validation

### Options (dict train)

- `--recursive` — Recursively collect files from input directories
- `--maxSamples` — Maximum number of sample files to load
- `--algorithm` — `fastcover`, `cover`, or `legacy`
- `--maxdict` — Maximum dictionary size in bytes
- `--dictID` — Optional dictionary ID metadata setting
- Advanced tuning knobs: `--k`, `--d`, `--steps`, `--split`, `--f`, `--accel`, `--selectivity`, `--shrink`

## Examples

```bash
zstdify compress input.txt output.zst
zstdify compress input.txt output.zst --level 2
zstdify extract output.zst restored.txt
zstdify dict train my.dict --input samples/ --recursive --maxdict 2048
zstdify compress input.txt output.zst --dict my.dict --dictID 42
zstdify extract output.zst restored.txt --dict my.dict --dictID 42
```

## How we validate

CLI behavior is covered by automated tests (`pnpm vitest`, including `packages/cli-tests`):

- **CLI round-trip**: `zstdify compress` -> `zstdify extract` restores original file bytes.
- **Core flags and aliases**: Compression levels, checksums, and command aliases are exercised.
- **Differential interop with official zstd CLI**:
  - `zstd` output is extracted by `zstdify-cli`.
  - `zstdify-cli` output is decompressed by `zstd`.
  - These checks run across standard (non-dictionary) workflows.
- **Dictionary interop coverage**:
  - `zstd -D dict` compressed streams are extracted by `zstdify-cli --dict`.
  - `zstdify-cli --dict` compressed streams are decompressed by `zstd -D dict`.
  - Coverage includes both zstd-trained and zstdify-trained dictionaries.
- **Error paths**: Missing files and invalid inputs produce non-zero exits and actionable messages.

## Acknowledgements

This project is made possible by the original [zstd](https://github.com/facebook/zstd) project by Meta and its contributors.
The monorepo, project, and CLI structure were bootstrapped from [hdrify](https://github.com/bhouston/hdrify), which made this project much easier to build.

# License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/zstdify-cli
[npm-url]: https://www.npmjs.com/package/zstdify-cli
[npm-downloads]: https://img.shields.io/npm/dw/zstdify-cli
[npmtrends-url]: https://www.npmtrends.com/zstdify-cli
[tests-badge]: https://github.com/bhouston/zstdify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/zstdify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/zstdify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/zstdify
