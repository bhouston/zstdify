# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T02:54:20.176Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.23 | 96.26 | 131.94 | 969.76 | 253.47 | 950.97 |
| shakespeare-complete-txt | text     | 6 | 2.01 | 97.20 | 129.14 | 940.69 | 243.77 | 866.70 |
| enwik8      | text     | 6 | 2.65 | 119.31 | 144.82 | 1113.93 | 235.75 | 1013.81 |
| linux-kernel-tar | archive  | 6 | 4.33 | 175.21 | 235.04 | 1736.77 | 338.15 | 1529.88 |
| apollo17-flightplan-pdf | document | 6 | 7.53 | 263.49 | 485.18 | 2938.83 | 493.33 | 2361.56 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.4002 | 0.3280 |
| shakespeare-complete-txt | text     | 6 | 0.4171 | 0.3480 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
