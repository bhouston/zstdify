# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-23T01:43:57.176Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.22 | 102.53 | 143.61 | 1141.39 | 257.89 | 944.02 |
| shakespeare-complete-txt | text     | 6 | 1.93 | 97.22 | 137.26 | 1049.72 | 243.59 | 898.39 |
| enwik8      | text     | 6 | 2.58 | 120.21 | 148.35 | 1116.50 | 249.35 | 982.12 |
| linux-kernel-tar | archive  | 6 | 4.17 | 181.40 | 224.37 | 1731.75 | 337.53 | 1495.56 |
| apollo17-flightplan-pdf | document | 6 | 7.31 | 273.58 | 425.53 | 3043.49 | 505.86 | 2460.95 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.4002 | 0.3280 |
| shakespeare-complete-txt | text     | 6 | 0.4171 | 0.3480 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
