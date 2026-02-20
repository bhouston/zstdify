# Test Fixtures

All binary fixtures in this folder are generated with the official `zstd` CLI.

## Corpus fixtures (decodecorpus-style)

The `corpus/` subdirectory holds a batch of `.zst` files plus `manifest.json` (sha256 of original content) for decoder conformance. Regenerate from repo root (requires zstd CLI):

```bash
pnpm --filter zstdify-tests run generate:corpus
```

Tests in `conformance/corpus-manifest.test.ts` decompress each corpus file and verify the hash matches the manifest.

## Legacy fixtures (root of fixtures/)

Regenerate from this directory with:

```bash
# Without checksum (for decoder conformance)
echo -n "hello" | zstd -f -c --no-check > hello-no-check.zst

# Compressed block fixtures across levels
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -f -c --no-check -1 > level1.zst
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -f -c --check -1 > level1-check.zst
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -f -c --no-check -3 > level3.zst
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -f -c --no-check -9 > level9.zst

# Tiny payload variants
echo -n "tiny-payload" | zstd -f -c --no-check -3 > tiny-level3-no-check.zst
echo -n "tiny-payload" | zstd -f -c --check -3 > tiny-level3-check.zst

# Large payload variants (36-byte chunk repeated 8192 times)
python3 -c "import sys;chunk=('abcdefghijklmnopqrstuvwxyz0123456789'*1024).encode();[sys.stdout.buffer.write(chunk) for _ in range(8)]" | zstd -f -c --no-check -3 > large-level3-no-check.zst
python3 -c "import sys;chunk=('abcdefghijklmnopqrstuvwxyz0123456789'*1024).encode();[sys.stdout.buffer.write(chunk) for _ in range(8)]" | zstd -f -c --check -3 > large-level3-check.zst
```
