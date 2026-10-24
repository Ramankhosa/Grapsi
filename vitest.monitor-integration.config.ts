import path from 'path'

import { defineConfig } from 'vitest/config'

/**
 * Source Watch integration suites: real Postgres (the disposable
 * grapsi_monitor_test database — create it with `npm run test:monitor:db`),
 * fixture network transports, and a real Chromium for the browser tier.
 * Files run one at a time because they share that database.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/integration/monitor/**/*.monitor-db.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
})
