# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T01:08:15.001Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.44 | 161.81 | 111.58 | 874.52 | 251.20 | 890.56 |
| shakespeare-complete-txt | text     | 6 | 1.94 | 134.80 | 87.69 | 704.51 | 226.45 | 743.33 |
| enwik8      | text     | 6 | 1.86 | 113.74 | 83.76 | 1083.38 | 239.12 | 924.36 |
| linux-kernel-tar | archive  | 6 | 3.23 | 160.29 | 135.38 | 1693.24 | 326.78 | 1442.00 |
| apollo17-flightplan-pdf | document | 6 | 6.10 | 260.07 | 268.91 | 2882.42 | 488.20 | 2259.75 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
