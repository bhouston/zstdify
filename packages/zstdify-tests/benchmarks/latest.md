# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T01:34:55.572Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.48 | 160.03 | 108.52 | 951.00 | 252.50 | 906.06 |
| shakespeare-complete-txt | text     | 6 | 2.02 | 129.95 | 87.45 | 785.84 | 226.66 | 758.03 |
| enwik8      | text     | 6 | 1.89 | 114.64 | 106.66 | 1093.55 | 242.11 | 985.50 |
| linux-kernel-tar | archive  | 6 | 3.36 | 170.67 | 174.86 | 1706.74 | 328.52 | 1485.59 |
| apollo17-flightplan-pdf | document | 6 | 6.22 | 261.92 | 334.26 | 2906.56 | 496.44 | 2299.02 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
