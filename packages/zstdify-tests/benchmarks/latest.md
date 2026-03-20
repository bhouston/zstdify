# zstdify vs Node built-in zstd vs zstddec

Generated: 2026-02-23T15:39:26.618Z | Node: v24.12.0

## Throughput (MB/s)

| Payload                  | Category | Level | Compress zstdify | Compress Node | Decompress zstdify | Decompress Node | Decompress fzstd | Decompress zstddec |
| ------------------------ | -------- | ----- | ---------------- | ------------- | ------------------ | --------------- | ---------------- | ------------------ |
| war-and-peace-txt        | text     | 6     | 1.52             | 102.63        | 150.75             | 1019.58         | 256.78           | 922.89             |
| shakespeare-complete-txt | text     | 6     | 1.35             | 96.08         | 142.93             | 970.29          | 240.50           | 887.62             |
| enwik8                   | text     | 6     | 1.70             | 120.36        | 149.69             | 1112.28         | 247.97           | 953.65             |
| linux-kernel-tar         | archive  | 6     | 2.72             | 177.01        | 232.84             | 1749.27         | 337.85           | 1448.23            |
| apollo17-flightplan-pdf  | document | 6     | 5.18             | 272.59        | 444.49             | 2968.65         | 497.71           | 2417.05            |

## Compression ratio (compressed/original)

| Payload                  | Category | Level | zstdify | Node   |
| ------------------------ | -------- | ----- | ------- | ------ |
| war-and-peace-txt        | text     | 6     | 0.4002  | 0.3280 |
| shakespeare-complete-txt | text     | 6     | 0.4171  | 0.3480 |
| enwik8                   | text     | 6     | 0.3724  | 0.3248 |
| linux-kernel-tar         | archive  | 6     | 0.2259  | 0.1995 |
| apollo17-flightplan-pdf  | document | 6     | 0.1315  | 0.1176 |
