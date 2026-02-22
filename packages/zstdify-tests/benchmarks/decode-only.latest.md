# Decode-only benchmark

Generated: 2026-02-22T00:44:06.718Z | Node: v24.12.0

## Throughput (MB/s)

| Payload | Category | Level | zstdify <- zstdify | zstdify <- node | node <- node | fzstd <- node | zstddec <- zstdify |
|---|---|---:|---:|---:|---:|---:|---:|
| war-and-peace-txt | text | 6 | 101.60 | 90.71 | 883.00 | 250.16 | 899.35 |
| shakespeare-complete-txt | text | 6 | 77.68 | 70.81 | 757.23 | 223.12 | 718.41 |
| enwik8 | text | 6 | 79.97 | 79.93 | 1079.75 | 236.09 | 930.69 |
| linux-kernel-tar | archive | 6 | 131.44 | 124.88 | 1657.61 | 315.44 | 1400.98 |
| apollo17-flightplan-pdf | document | 6 | 251.82 | 245.63 | 2732.13 | 476.59 | 2099.96 |
