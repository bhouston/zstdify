# Decode-only benchmark

Generated: 2026-02-22T02:24:21.190Z | Node: v24.12.0

## Throughput (MB/s)

| Payload | Category | Level | zstdify <- zstdify | zstdify <- node | node <- node | fzstd <- node | zstddec <- zstdify |
|---|---|---:|---:|---:|---:|---:|---:|
| war-and-peace-txt | text | 6 | 129.51 | 115.25 | 726.30 | 224.35 | 776.63 |
| shakespeare-complete-txt | text | 6 | 103.81 | 90.96 | 602.54 | 197.52 | 644.66 |
| enwik8 | text | 6 | 112.36 | 100.96 | 895.58 | 207.49 | 833.36 |
| linux-kernel-tar | archive | 6 | 188.70 | 182.81 | 1373.08 | 271.39 | 1260.69 |
| apollo17-flightplan-pdf | document | 6 | 378.99 | 379.53 | 2266.19 | 435.93 | 1995.13 |
