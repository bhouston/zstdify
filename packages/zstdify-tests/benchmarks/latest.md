# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-23T19:04:07.475Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 1.52 | 102.17 | 143.40 | 977.25 | 258.95 | 833.52 |
| shakespeare-complete-txt | text     | 6 | 1.37 | 97.57 | 136.44 | 1059.15 | 222.36 | 766.06 |
| enwik8      | text     | 6 | 1.71 | 120.23 | 153.78 | 1112.38 | 248.77 | 889.86 |
| linux-kernel-tar | archive  | 6 | 2.74 | 169.17 | 236.04 | 1733.54 | 338.46 | 1393.30 |
| apollo17-flightplan-pdf | document | 6 | 5.27 | 271.79 | 449.31 | 2948.19 | 482.70 | 2293.30 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.4002 | 0.3280 |
| shakespeare-complete-txt | text     | 6 | 0.4171 | 0.3480 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
