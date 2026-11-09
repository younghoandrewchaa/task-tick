import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: 'list',
  outputDir: 'test-results',
});
