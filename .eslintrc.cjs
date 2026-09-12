/**
 * ESLint flat-ish config (classic .eslintrc format for eslint v8).
 * Uses @typescript-eslint recommended rules.
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.json'],
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    // Playwright fixtures legitimately use an empty destructuring pattern
    // to declare "no dependencies", e.g. `async ({}, use) => {}`.
    'no-empty-pattern': 'off',
  },
};
