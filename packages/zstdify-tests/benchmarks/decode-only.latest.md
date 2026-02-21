# Decode-only benchmark

Generated: 2026-02-21T18:27:59.635Z | Node: v24.12.0

## Throughput (MB/s)

| Payload | Category | Level | zstdify <- zstdify | zstdify <- node | node <- node | zstddec <- zstdify |
|---|---|---:|---:|---:|---:|---:|
| war-and-peace-txt | text | 3 | 75.47 | 103.33 | 1108.79 | 664.05 |
| war-and-peace-txt | text | 5 | 75.12 | 89.28 | 970.02 | 661.65 |
| war-and-peace-txt | text | 9 | 75.33 | 96.08 | 1113.87 | 661.05 |
| shakespeare-complete-txt | text | 3 | 57.90 | 78.26 | 880.87 | 515.55 |
| shakespeare-complete-txt | text | 5 | 58.06 | 71.16 | 789.25 | 516.65 |
| shakespeare-complete-txt | text | 9 | 57.79 | 76.00 | 854.03 | 516.29 |
| enwik8-zip | archive | 3 | 14483.68 | 18821.90 | 8506.77 | 11391.59 |
| enwik8-zip | archive | 5 | 14603.87 | 18563.46 | 9839.27 | 10985.20 |
| enwik8-zip | archive | 9 | 15015.26 | 18556.36 | 8111.76 | 11158.48 |
| linux-kernel-tar-xz | archive | 3 | 15837.94 | 19311.94 | 8745.08 | 11347.92 |
| linux-kernel-tar-xz | archive | 5 | 15971.16 | 19523.29 | 8875.21 | 11093.44 |
| linux-kernel-tar-xz | archive | 9 | 15816.98 | 18661.88 | 8754.18 | 11586.82 |
| fronalpstock-jpg | media | 3 | 9935.06 | 15365.14 | 10039.25 | 11400.43 |
| fronalpstock-jpg | media | 5 | 9757.58 | 16326.40 | 10622.87 | 11508.80 |
| fronalpstock-jpg | media | 9 | 9930.17 | 16416.93 | 10182.88 | 11493.41 |
| apollo17-flightplan-pdf | document | 3 | 194.55 | 234.87 | 2652.55 | 1684.70 |
| apollo17-flightplan-pdf | document | 5 | 193.82 | 262.26 | 3035.21 | 1683.67 |
| apollo17-flightplan-pdf | document | 9 | 195.61 | 260.90 | 2941.98 | 1686.23 |
