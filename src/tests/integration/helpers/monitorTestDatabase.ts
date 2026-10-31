/**
 * Where the Source Watch integration suites are allowed to write.
 *
 * `src/lib/prisma.ts` overwrites DATABASE_URL from the repo's .env files on
 * import, so a test cannot redirect the shared client with an environment
 * variable alone — it would silently land on the dev database. The suites
 * instead build their own PrismaClient from this URL and inject it with
 * `vi.mock('@/lib/prisma')`, and this guard makes a non-test database
 * impossible to reach that way.
 */
export function resolveMonitorTestDatabaseUrl(devUrl: string): { url: string; name: string } {
  const explicit = process.env.MONITOR_TEST_DATABASE_URL?.trim()
  const name = process.env.MONITOR_TEST_DATABASE_NAME?.trim() || 'grapsi_monitor_test'

  let url: URL
  try {
    url = new URL(explicit || devUrl)
  } catch {
    throw new Error('Cannot parse the database URL for the monitor test database')
  }
  const devName = safeDatabaseName(devUrl)
  if (!explicit) url.pathname = `/${name}`
  const testName = decodeURIComponent(url.pathname.replace(/^\//, ''))

  if (!testName.endsWith('_test')) {
    throw new Error(`Refusing to use "${testName}" as the monitor test database: its name must end in _test`)
  }
  if (devName && testName === devName) {
    throw new Error(`Refusing to use "${testName}": it is the database DATABASE_URL names`)
  }
  return { url: url.toString(), name: testName }
}

function safeDatabaseName(raw: string): string | null {
  try {
    return decodeURIComponent(new URL(raw).pathname.replace(/^\//, '')) || null
  } catch {
    return null
  }
}
