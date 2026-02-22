# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T01:15:09.061Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.50 | 159.65 | 114.14 | 900.44 | 252.33 | 912.87 |
| shakespeare-complete-txt | text     | 6 | 2.01 | 135.99 | 89.92 | 718.41 | 226.37 | 757.25 |
| enwik8      | text     | 6 | 1.87 | 115.00 | 86.32 | 1088.20 | 243.75 | 981.81 |
| linux-kernel-tar | archive  | 6 | 3.34 | 169.56 | 139.51 | 1699.13 | 327.96 | 1466.45 |
| apollo17-flightplan-pdf | document | 6 | 6.19 | 263.27 | 285.05 | 2989.46 | 496.07 | 2304.74 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
