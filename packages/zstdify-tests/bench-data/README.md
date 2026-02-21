# Benchmark Corpus Data

`datasets.manifest.json` defines real-world benchmark inputs.

Run this from the repo root to download all corpus files and generate `index.json`:

```bash
pnpm --filter zstdify-tests run bench:fetch-data
```

Downloaded files are stored in `bench-data/files/` and are intentionally not checked into git.
