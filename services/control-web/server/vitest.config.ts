import { defineConfig } from 'vitest/config';

// Server tests only: they run on Node, never in a browser environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
