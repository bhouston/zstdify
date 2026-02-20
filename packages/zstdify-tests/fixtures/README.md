# Test Fixtures

Create fixtures with official zstd:

```bash
# Without checksum (for decoder conformance)
echo -n "hello" | zstd -c --no-check > hello-no-check.zst
```
