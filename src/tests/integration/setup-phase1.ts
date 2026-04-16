const testDatabaseUrl = process.env.TEST_DATABASE_URL
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for Phase 1 real DB integration tests')
}

if (appDatabaseUrl && testDatabaseUrl === appDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must not match DATABASE_URL for Phase 1 real DB integration tests')
}

const writableEnv = process.env as Record<string, string | undefined>
writableEnv.NODE_ENV = 'test'
writableEnv.JWT_SECRET = writableEnv.JWT_SECRET || 'phase1-test-jwt-secret-12345678901234567890'
writableEnv.REFRESH_TOKEN_SECRET = writableEnv.REFRESH_TOKEN_SECRET || 'phase1-test-refresh-secret-12345678901234567890'
writableEnv.DATABASE_URL = testDatabaseUrl
