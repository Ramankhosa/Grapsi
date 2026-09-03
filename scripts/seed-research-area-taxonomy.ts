import 'dotenv/config'

import fs from 'fs/promises'
import path from 'path'

import prisma from '@/lib/prisma'
import { researchAreaTaxonomyService } from '@/lib/services/researchAreaTaxonomyService'

/**
 * Seeds the default discipline catalog into the research-area taxonomy.
 *
 * The taxonomy tables have existed since the researcher Finder shipped but were
 * never populated, which is why call classification and school mapping had no
 * vocabulary to work with. This loads `Seed/research-areas-default.csv` through
 * the ordinary upload path, so the result is indistinguishable from a CSV a
 * super-admin uploaded at /super-admin/research-areas — and can be replaced the
 * same way.
 *
 * Idempotent: an existing ACTIVE upload is left alone unless --force is passed.
 * That matters because uploading archives whatever is active, and re-running
 * this on a customer who has curated their own catalog would silently replace
 * it.
 */

const SOURCE_NAME = 'Grapsi Default Disciplines'
const CSV_PATH = path.join(process.cwd(), 'Seed', 'research-areas-default.csv')

async function resolveUploader(): Promise<{ id: string; email: string }> {
  // The upload FK is Restrict, so this must be a real user. Prefer a platform
  // super-admin; fall back to the system user the SQL seed creates.
  const admin = await prisma.user.findFirst({
    where: { roles: { has: 'SUPER_ADMIN' } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  if (admin) return admin

  const anyUser = await prisma.user.findFirst({
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  if (anyUser) return anyUser

  throw new Error(
    'No user exists to attribute the taxonomy upload to. Run `npm run create-admin` first.'
  )
}

async function main() {
  const force = process.argv.includes('--force')

  const active = await prisma.$queryRawUnsafe<Array<{ id: string; source_name: string; active_row_count: number }>>(
    `SELECT id, source_name, active_row_count
       FROM research_area_taxonomy_uploads
      WHERE status = 'ACTIVE'
      LIMIT 1`
  )

  if (active.length > 0 && !force) {
    console.log(
      `[seed:research-areas] An ACTIVE taxonomy already exists ("${active[0].source_name}", ` +
        `${active[0].active_row_count} areas). Nothing to do. Pass --force to replace it.`
    )
    return
  }

  const csvText = await fs.readFile(CSV_PATH, 'utf8')
  const uploader = await resolveUploader()

  if (active.length > 0) {
    // Replacing the catalog mints new area ids. Existing mappings still point at
    // the archived ones and are filtered out of every query as soon as this
    // runs, so both sides have to be rebuilt or relevance silently goes blank.
    console.log(
      `[seed:research-areas] --force given: archiving "${active[0].source_name}" and replacing it.`
    )
    console.log(
      '[seed:research-areas] WARNING: this invalidates every existing mapping. Afterwards run'
    )
    console.log(
      '[seed:research-areas]   `npm run ops:classify-calls -- --force` to re-classify calls, and'
    )
    console.log(
      '[seed:research-areas]   re-map each org unit under Organization -> Structure. Until both'
    )
    console.log(
      '[seed:research-areas]   are done, relevance filtering is off and every school sees'
    )
    console.log('[seed:research-areas]   the whole catalog.')
  }

  const result = await researchAreaTaxonomyService.uploadTaxonomyCsv({
    csvText,
    originalFilename: 'research-areas-default.csv',
    sourceName: SOURCE_NAME,
    uploadedBy: uploader.id,
  })

  const groupCount = new Set(result.areas.map((area) => area.level1Code)).size
  console.log(
    `[seed:research-areas] Loaded ${result.areas.length} research areas across ${groupCount} ` +
      `discipline groups (attributed to ${uploader.email}).`
  )
  for (const warning of result.warnings) {
    console.log(`[seed:research-areas] ${warning}`)
  }
}

main()
  .catch((error) => {
    console.error('[seed:research-areas] Failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
