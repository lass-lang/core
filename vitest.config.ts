import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Include test files from this package
    include: ['test/**/*.test.ts'],
    // Global test timeout
    testTimeout: 10000,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/types.ts'],
      // Enforce high coverage - tests fail if coverage drops
      thresholds: {
        lines: 100,
        branches: 97, // Some defensive branches are hard to cover
        functions: 100,
        statements: 100,
      },
    },
  },
});
