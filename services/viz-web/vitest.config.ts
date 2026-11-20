import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// unit tests only: the UI tests in e2e/ run with Playwright
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', 'server/**'],
  },
});
