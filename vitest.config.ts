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
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
      // Enforce 100% coverage - tests fail if coverage drops
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
