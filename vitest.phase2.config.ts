import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/tests/integration/setup-phase1.ts'],
    fileParallelism: false,
    include: [
      'src/tests/integration/funding-api.real-db.test.ts',
      'src/tests/integration/funding-schema.real-db.test.ts',
    ],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
