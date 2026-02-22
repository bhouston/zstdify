# Decode-only benchmark

Generated: 2026-02-22T00:59:08.541Z | Node: v24.12.0

## Throughput (MB/s)

| Payload | Category | Level | zstdify <- zstdify | zstdify <- node | node <- node | fzstd <- node | zstddec <- zstdify |
|---|---|---:|---:|---:|---:|---:|---:|
| war-and-peace-txt | text | 6 | 107.03 | 96.21 | 936.33 | 249.65 | 903.79 |
| shakespeare-complete-txt | text | 6 | 83.61 | 74.64 | 794.41 | 222.57 | 735.83 |
| enwik8 | text | 6 | 78.85 | 77.77 | 1071.68 | 234.72 | 907.73 |
| linux-kernel-tar | archive | 6 | 129.21 | 123.49 | 1778.13 | 320.67 | 1412.22 |
| apollo17-flightplan-pdf | document | 6 | 258.71 | 251.41 | 2917.26 | 487.96 | 2231.60 |
