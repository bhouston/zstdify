# Decode-only benchmark

Generated: 2026-02-22T01:22:13.537Z | Node: v24.12.0

## Throughput (MB/s)

| Payload | Category | Level | zstdify <- zstdify | zstdify <- node | node <- node | fzstd <- node | zstddec <- zstdify |
|---|---|---:|---:|---:|---:|---:|---:|
| war-and-peace-txt | text | 6 | 112.78 | 102.95 | 865.18 | 254.84 | 918.62 |
| shakespeare-complete-txt | text | 6 | 87.26 | 78.81 | 722.69 | 224.91 | 756.46 |
| enwik8 | text | 6 | 84.33 | 82.96 | 1077.17 | 237.66 | 975.50 |
| linux-kernel-tar | archive | 6 | 134.31 | 130.63 | 1784.56 | 324.28 | 1468.29 |
| apollo17-flightplan-pdf | document | 6 | 277.36 | 269.42 | 2886.91 | 495.80 | 2292.39 |
