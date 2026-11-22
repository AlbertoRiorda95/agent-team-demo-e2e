// Vitest runs the tests of test/ against the built package (dist/, through the
// "exports" of package.json): `npm test` builds first.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
