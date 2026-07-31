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
    server: {
      deps: {
        // pdf-parse-fork ships a prebuilt webpack bundle of pdf.js that Vite's
        // transform cannot parse ("Illegal character"), so it must be loaded by
        // Node directly. It works fine at runtime; only the transform breaks.
        external: ['pdf-parse-fork'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` is a Next.js build-time marker that throws on import
      // outside a Server Component. Under vitest everything is "server", so it
      // is resolved to the package's own empty build to keep server modules
      // (and the pure helpers they re-export) importable from tests.
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
})
