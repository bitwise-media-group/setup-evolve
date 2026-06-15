import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    // default for the local/CI console; junit feeds the shared ci-actions
    // workflow's Codecov test-results upload (it reads test-report.junit.xml).
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-report.junit.xml' },
    coverage: {
      provider: 'v8',
      // cobertura is what the shared ci-actions workflow uploads to Codecov;
      // text is for the local/CI console summary.
      reporter: ['text', 'cobertura'],
      // Measure the shipped source only — not tests, configs, or the bundled
      // dist/ artifact.
      include: ['src/**/*.ts'],
    },
  },
})
