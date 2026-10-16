import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.bench.ts', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Routes are covered by integration tests with a mocked builder; the
      // real chain (providers, builder, M3UEPGAddon) is covered by tests/e2e.
      exclude: [
        'src/types/**',
        'dist/**',
        'src/routes/**',
        'src/middleware/rateLimiter.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
