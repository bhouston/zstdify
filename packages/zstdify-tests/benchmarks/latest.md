# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T02:05:18.061Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.91 | 160.53 | 156.79 | 896.03 | 253.03 | 912.87 |
| shakespeare-complete-txt | text     | 6 | 2.23 | 131.71 | 125.33 | 717.70 | 226.44 | 755.69 |
| enwik8      | text     | 6 | 2.43 | 116.30 | 141.48 | 1085.58 | 243.38 | 987.51 |
| linux-kernel-tar | archive  | 6 | 3.98 | 169.25 | 231.23 | 1697.12 | 328.43 | 1482.26 |
| apollo17-flightplan-pdf | document | 6 | 7.07 | 273.99 | 462.91 | 2968.68 | 498.58 | 2303.78 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
