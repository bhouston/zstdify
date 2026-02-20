import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/zstdify/src/**/*.test.ts',
      'packages/zstdify-tests/src/**/*.test.ts',
    ],
    environment: 'node',
    watch: false,
    isolate: false,
    coverage: {
      provider: 'v8',
      include: ['packages/zstdify/src/**/*.ts'],
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        '**/node_modules',
        '**/coverage',
        '**/dist',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/vitest.config.ts',
      ],
    },
  },
});
