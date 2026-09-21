import { defineConfig, devices } from '@playwright/test';
import { env } from './src/core/env.js';

/**
 * Playwright configuration.
 *
 * Projects:
 *  - `setup`  : runs global setup (auth state, redis health check).
 *  - `chromium`: browser UI tests, depends on `setup`.
 *  - `api`    : pure API tests (no browser), depends on `setup`.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',

  /* Global hooks run once per test run. */
  globalSetup: './tests/global.setup.ts',
  globalTeardown: './tests/global.teardown.ts',

  /* Run tests in files in parallel. */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only (or as configured through env). */
  retries: env.retries,

  /* Opt out of parallel tests on CI unless explicitly set. */
  workers: env.workers,

  /* Total test timeout budget. */
  timeout: env.timeoutMs,

  /* Assertion timeout (expect). */
  expect: { timeout: env.expectTimeoutMs },

  /* Shared settings for all projects. */
  use: {
    baseURL: env.baseUrl,
    headless: env.headless,
    launchOptions: { slowMo: env.slowMo },
    actionTimeout: env.expectTimeoutMs,
    navigationTimeout: env.timeoutMs,
    trace: env.trace as 'off' | 'on' | 'retain-on-failure' | 'on-first-retry',
    video: env.video as 'off' | 'on' | 'retain-on-failure' | 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
    testIdAttribute: 'data-testid',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [
        /global\.setup\.ts/,
        /global\.teardown\.ts/,
        /.*\.api\.spec\.ts/,
        /.*\.unit\.spec\.ts/,
      ],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: [
        /global\.setup\.ts/,
        /global\.teardown\.ts/,
        /.*\.api\.spec\.ts/,
        /.*\.unit\.spec\.ts/,
      ],
    },
    {
      name: 'api',
      use: {
        baseURL: env.apiBaseUrl,
        extraHTTPHeaders: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
      testMatch: /.*\.api\.spec\.ts/,
    },
  ],

  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: 'playwright-report',
        open: env.reportOpen as 'always' | 'never' | 'on-failure',
      },
    ],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
});
