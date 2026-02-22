# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-22T02:29:17.744Z | Node: v24.12.0

## Throughput (MB/s)

| Payload     | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
|-------------|----------|-------|------------------|---------------|-------------------|------------------|---------------------|
| war-and-peace-txt | text     | 6 | 3.11 | 160.21 | 160.31 | 887.31 | 259.15 | 930.36 |
| shakespeare-complete-txt | text     | 6 | 2.32 | 136.51 | 127.49 | 711.41 | 230.97 | 770.05 |
| enwik8      | text     | 6 | 2.56 | 120.13 | 146.31 | 1115.21 | 248.84 | 1014.34 |
| linux-kernel-tar | archive  | 6 | 4.15 | 181.87 | 237.53 | 1743.03 | 339.65 | 1530.44 |
| apollo17-flightplan-pdf | document | 6 | 7.29 | 277.22 | 499.54 | 3113.49 | 506.26 | 2370.65 |

## Compression ratio (compressed/original)

| Payload     | Category | Level | zstdify | Node |
|-------------|----------|-------|---------|------|
| war-and-peace-txt | text     | 6 | 0.3875 | 0.3418 |
| shakespeare-complete-txt | text     | 6 | 0.4758 | 0.4189 |
| enwik8      | text     | 6 | 0.3724 | 0.3248 |
| linux-kernel-tar | archive  | 6 | 0.2259 | 0.1995 |
| apollo17-flightplan-pdf | document | 6 | 0.1315 | 0.1176 |
