import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    isolate: false,
    include: ['src/**/*.test.ts'],
  },
});
