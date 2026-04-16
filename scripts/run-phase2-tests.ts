import { spawnSync } from 'child_process'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const appDatabaseUrl = process.env.DATABASE_URL

if (!testDatabaseUrl) {
  console.error('TEST_DATABASE_URL is required to run Phase 2 tests')
  process.exit(1)
}

if (appDatabaseUrl && testDatabaseUrl === appDatabaseUrl) {
  console.error('TEST_DATABASE_URL must not match DATABASE_URL when running Phase 2 tests')
  process.exit(1)
}

const sharedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  APP_DATABASE_URL: process.env.DATABASE_URL || '',
  DATABASE_URL: testDatabaseUrl,
  NODE_ENV: 'test',
  JWT_SECRET: process.env.JWT_SECRET || 'phase2-test-jwt-secret-12345678901234567890',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'phase2-test-refresh-secret-12345678901234567890',
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: sharedEnv,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('npx', ['prisma', 'generate'])
run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'])
run('npx', ['vitest', 'run', '--config', 'vitest.phase2.config.ts'])
