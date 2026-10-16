/**
 * Refuses a migration that could rewrite or remove existing data.
 *
 * The external catalogue import ships to a production database that already
 * holds real calls, assignments and proposals, so its migrations must be
 * strictly additive: new tables, new nullable columns, new indexes, new enum
 * values. This script fails (exit 1) if any listed migration contains a
 * statement that drops, renames, retypes, tightens or bulk-edits anything.
 *
 * It is a backstop for review, not a replacement: `prisma migrate diff` on the
 * dev database also emits unrelated drift (DROP TABLE of raw-SQL tables, index
 * renames) that must never be copied into a migration file.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/check-additive-migration.ts \
 *     20261015120000_external_catalog_import_tables 20261015120100_funding_call_status_staged
 *
 * With no arguments it checks the five catalogue-import migrations.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_MIGRATIONS = [
  '20261015120000_external_catalog_import_tables',
  '20261015120100_funding_call_status_staged',
  '20261015120200_funding_call_catalog_facts',
  '20261015120300_funding_visibility_global_catalog',
  '20261015120400_funding_visibility_catalog_check',
  '20261016090000_external_source_checked_at',
]

const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'DROP (table, column, index, constraint, type, extension)', pattern: /\bDROP\b/i },
  { label: 'RENAME', pattern: /\bRENAME\b/i },
  { label: 'ALTER COLUMN (type, default or nullability change)', pattern: /\bALTER\s+COLUMN\b/i },
  { label: 'SET NOT NULL', pattern: /\bSET\s+NOT\s+NULL\b/i },
  { label: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
  { label: 'DELETE', pattern: /^\s*DELETE\b/im },
  { label: 'UPDATE of existing rows', pattern: /^\s*UPDATE\b/im },
  { label: 'ADD COLUMN ... NOT NULL without being a new table', pattern: /ADD\s+COLUMN[^,;]*\bNOT\s+NULL\b/i },
  { label: 'CREATE EXTENSION (needs elevated privileges on production)', pattern: /\bCREATE\s+EXTENSION\b/i },
]

/** Strips SQL comments so prose in a header cannot trip the checks. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * The one allowed shape that contains DROP: replacing a CHECK constraint with
 * a wider one in a single statement under the SAME name
 *   ALTER TABLE t DROP CONSTRAINT "c", ADD CONSTRAINT "c" CHECK (...)
 * The table is never without its check, and no row is rewritten. Whether the
 * new check really is wider is for review; this only proves the shape.
 */
const CHECK_REPLACEMENT = /ALTER\s+TABLE\s+("?[\w.]+"?)\s+DROP\s+CONSTRAINT\s+("[^"]+"|\w+)\s*,\s*ADD\s+CONSTRAINT\s+("[^"]+"|\w+)\s+CHECK\s*\(/gi

function withoutCheckReplacements(body: string): string {
  return body.replace(CHECK_REPLACEMENT, (match, _table, dropped: string, added: string) =>
    dropped.replace(/"/g, '') === added.replace(/"/g, '') ? 'ALTER TABLE __replaced_check__ ADD CONSTRAINT __same_name__ CHECK (' : match
  )
}

export function findForbiddenStatements(sql: string): string[] {
  const body = withoutCheckReplacements(stripComments(sql))
  return FORBIDDEN.filter(({ pattern }) => pattern.test(body)).map(({ label }) => label)
}

function main() {
  const names = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const migrations = names.length > 0 ? names : DEFAULT_MIGRATIONS
  let failed = false
  for (const name of migrations) {
    const file = path.resolve('prisma/migrations', name, 'migration.sql')
    const problems = findForbiddenStatements(readFileSync(file, 'utf8'))
    if (problems.length > 0) {
      failed = true
      console.error(`NOT ADDITIVE  ${name}\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    } else {
      console.log(`additive      ${name}`)
    }
  }
  if (failed) {
    console.error('\nRefusing: at least one migration could rewrite or remove existing data.')
    process.exit(1)
  }
}

if (require.main === module) main()
