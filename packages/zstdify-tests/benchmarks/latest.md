# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T00:55:23.525Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.41 | 156.22 | 101.35 | 850.03 | 248.54 | 886.22 |
| shakespeare-complete-txt | text     | 6 | 1.93 | 130.50 | 78.61 | 704.51 | 223.73 | 708.62 |
| enwik8      | text     | 6 | 1.87 | 113.59 | 83.08 | 1083.50 | 238.63 | 911.36 |
| linux-kernel-tar | archive  | 6 | 3.27 | 169.11 | 133.53 | 1686.94 | 325.71 | 1405.52 |
| apollo17-flightplan-pdf | document | 6 | 6.13 | 247.15 | 266.31 | 2888.42 | 491.33 | 2219.12 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
