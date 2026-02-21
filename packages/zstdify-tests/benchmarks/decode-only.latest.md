# Decode-only benchmark

Generated: 2026-02-21T20:08:45.590Z | Node: v24.12.0

## Throughput (MB/s)

| Payload | Category | Level | zstdify <- zstdify | zstdify <- node | node <- node | zstddec <- zstdify |
|---|---|---:|---:|---:|---:|---:|
| war-and-peace-txt | text | 6 | 103.23 | 93.73 | 937.54 | 964.84 |
| shakespeare-complete-txt | text | 6 | 82.55 | 73.38 | 796.14 | 785.84 |
| enwik8 | text | 6 | 77.59 | 80.87 | 1077.81 | 910.30 |
| linux-kernel-tar | archive | 6 | 129.11 | 130.04 | 1681.14 | 1422.48 |
| apollo17-flightplan-pdf | document | 6 | 258.11 | 256.08 | 2915.72 | 2292.39 |
