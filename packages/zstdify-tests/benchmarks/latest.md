# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-23T01:20:59.302Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 2.22 | 100.17 | 135.55 | 968.39 | 255.13 | 933.59 |
| shakespeare-complete-txt | text     | 6 | 1.92 | 96.62 | 130.91 | 990.49 | 242.65 | 896.67 |
| enwik8      | text     | 6 | 2.56 | 118.44 | 140.50 | 1111.12 | 247.44 | 976.03 |
| linux-kernel-tar | archive  | 6 | 4.15 | 176.01 | 220.57 | 1725.58 | 334.68 | 1485.50 |
| apollo17-flightplan-pdf | document | 6 | 7.32 | 267.75 | 470.83 | 3048.54 | 506.37 | 2452.27 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.4002 | 0.3280 |
| shakespeare-complete-txt | text     | 6 | 0.4171 | 0.3480 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
