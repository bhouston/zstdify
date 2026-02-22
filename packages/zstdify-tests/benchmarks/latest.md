# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T02:37:33.193Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 3.11 | 167.23 | 160.81 | 946.05 | 259.70 | 939.95 |
| shakespeare-complete-txt | text     | 6 | 2.30 | 140.86 | 128.66 | 776.63 | 230.89 | 771.69 |
| enwik8      | text     | 6 | 2.54 | 120.59 | 145.00 | 1119.58 | 244.51 | 1012.42 |
| linux-kernel-tar | archive  | 6 | 4.09 | 170.70 | 235.37 | 1746.59 | 338.54 | 1528.30 |
| apollo17-flightplan-pdf | document | 6 | 7.09 | 277.37 | 476.65 | 2940.43 | 500.13 | 2340.68 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
