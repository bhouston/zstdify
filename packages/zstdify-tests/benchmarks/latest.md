# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-23T19:50:56.832Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 1.55 | 102.54 | 124.14 | 981.10 | 257.52 | 942.80 |
| shakespeare-complete-txt | text     | 6 | 1.38 | 97.75 | 109.82 | 939.96 | 244.32 | 897.68 |
| enwik8      | text     | 6 | 1.74 | 120.52 | 125.79 | 1113.38 | 248.85 | 977.96 |
| linux-kernel-tar | archive  | 6 | 2.77 | 179.66 | 197.16 | 1743.75 | 337.57 | 1483.35 |
| apollo17-flightplan-pdf | document | 6 | 5.26 | 283.49 | 380.52 | 3047.68 | 499.23 | 2435.09 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.4002 | 0.3280 |
| shakespeare-complete-txt | text     | 6 | 0.4171 | 0.3480 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
