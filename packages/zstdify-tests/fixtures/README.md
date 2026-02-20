# Test Fixtures

Create fixtures with official zstd:

```bash
# Without checksum (for decoder conformance)
echo -n "hello" | zstd -c --no-check > hello-no-check.zst

# Compressed block fixtures across levels
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -c --no-check -1 > level1.zst
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -c --no-check -3 > level3.zst
echo -n "hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world " | zstd -c --no-check -9 > level9.zst
```
