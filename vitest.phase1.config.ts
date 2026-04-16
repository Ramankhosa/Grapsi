import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/tests/integration/setup-phase1.ts'],
    fileParallelism: false,
    include: [
      'src/tests/integration/project-api.real-db.test.ts',
      'src/tests/integration/project-schema.real-db.test.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
