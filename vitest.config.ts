import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // The *.real-db.test.ts suites hard-delete rows from the database in
    // DATABASE_URL (see the guard in src/tests/integration/helpers/
    // phase1-test-helpers.ts) and some make real, paid LLM calls, so they must
    // never run as part of a default `npm run test`. Run them deliberately with
    // an opt-in and a disposable database, e.g.:
    //   ALLOW_REAL_DB_TESTS=true npx vitest run src/tests/integration --config vitest.realdb.config.ts
    // or by pointing --exclude at nothing and setting the env var yourself.
    exclude: [...configDefaults.exclude, '**/*.real-db.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
