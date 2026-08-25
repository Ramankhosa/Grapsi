/**
 * Step 4 — seed each researcher's influential publications.
 *
 * The faculty importer handles the roster (users, org placement, research areas,
 * keywords, summaries) but has no publication column, so the shortlists are
 * loaded here, after the roster import has created the accounts.
 *
 * Researchers are matched on ResearcherProfile.employee_id scoped to the target
 * tenant — the same key the roster is joined on. Email is deliberately not used:
 * the authorship export never had one, so employee_id is the only identifier
 * that survives the whole pipeline.
 *
 * Every row is tagged 'my-publication' (what the funding matcher reads) AND
 * 'synthetic-abstract', because the abstract text is an inference from the title
 * and venue, not the published abstract.
 *
 *   npx tsx scripts/lpu-faculty/04-seed-publications.ts --tenant-id=<id> --dry-run
 *   npx tsx scripts/lpu-faculty/04-seed-publications.ts --tenant-id=<id>
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../../src/lib/prisma'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'

const IN_PATH = path.join(__dirname, 'out', 'lpu-influential-publications.json')
/**
 * The roster supplies the email each employee ID is supposed to belong to.
 * Employee ID alone is NOT a safe match key: if someone already in the tenant
 * happens to hold a roster researcher's employee ID, matching on it alone
 * attaches that researcher's publications to the wrong person. The roster import
 * rejects such a row outright; this must refuse it too.
 */
const ROSTER_PATH = path.join(__dirname, 'out', 'lpu-faculty-roster-final.csv')
/** Mirrors MAX_FUNDING_PUBLICATIONS in src/lib/researcherProfile/funding-publications.ts. */
const MAX_FUNDING_PUBLICATIONS = 5
const FUNDING_PUBLICATION_TAG = 'my-publication'
const SYNTHETIC_TAG = 'synthetic-abstract'

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const TENANT_ID = flag('tenant-id')
const ATI = flag('ati')
const DRY_RUN = args.includes('--dry-run')

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Must stay byte-identical to buildFundingPublicationMatchText() in
 * src/lib/researcherProfile/funding-publications.ts — a divergence here would
 * make every seeded row look permanently stale to the embedding backfill.
 */
function buildFundingPublicationMatchText(input: {
  title: string
  abstract?: string | null
  year?: number | null
  venue?: string | null
  doi?: string | null
  authors?: string[] | null
}) {
  return normalizeWhitespace(
    [
      input.title ? 'title: ' + input.title : '',
      input.abstract ? 'abstract: ' + input.abstract : '',
      input.venue ? 'venue: ' + input.venue : '',
      input.year ? 'year: ' + input.year : '',
      input.authors?.length ? 'authors: ' + input.authors.join(', ') : '',
      input.doi ? 'doi: ' + input.doi : '',
    ]
      .filter(Boolean)
      .join(' | ')
  )
}

function titleKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function main() {
  if (!TENANT_ID && !ATI) {
    console.error('Pass --tenant-id=<id> or --ati=<atiId>.')
    process.exit(1)
  }

  const tenant = await prisma.tenant.findFirst({
    where: TENANT_ID ? { id: TENANT_ID } : { atiId: ATI! },
    select: { id: true, name: true, atiId: true },
  })
  if (!tenant) {
    console.error('Tenant not found.')
    process.exit(1)
  }
  console.log('Tenant: ' + tenant.name + ' (' + tenant.atiId + ') ' + tenant.id)
  if (DRY_RUN) console.log('DRY RUN — nothing will be written.\n')

  const payload = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'))
  const researchers: any[] = payload.researchers

  // One query for the whole roster; researcher_profiles carries no tenant_id, so
  // the tenant scope has to come from the joined user.
  if (!fs.existsSync(ROSTER_PATH)) {
    console.error('No roster at ' + ROSTER_PATH + ' — needed to verify identity. Run 05-hr-merge.ts first.')
    process.exit(1)
  }
  const roster = parseTabularUpload(fs.readFileSync(ROSTER_PATH), 'lpu-faculty-roster-final.csv')
  const expectedEmail = new Map<string, string>()
  for (const row of roster.rows) {
    const uid = (row.employeeid || '').trim()
    const email = (row.email || '').trim().toLowerCase()
    if (uid && email) expectedEmail.set(uid, email)
  }

  const profiles = await prisma.researcherProfile.findMany({
    where: { employee_id: { in: researchers.map((r) => r.employeeId) }, user: { tenantId: tenant.id } },
    select: { employee_id: true, user_id: true, display_name: true, user: { select: { email: true } } },
  })

  const userByEmployeeId = new Map<string, (typeof profiles)[number]>()
  const identityMismatch: string[] = []
  for (const profile of profiles) {
    const employeeId = String(profile.employee_id)
    const expected = expectedEmail.get(employeeId)
    const actual = profile.user.email.toLowerCase()
    if (expected && expected !== actual) {
      identityMismatch.push(employeeId + ' is held by ' + actual + ' but the roster assigns it to ' + expected)
      continue
    }
    userByEmployeeId.set(employeeId, profile)
  }

  console.log('Matched ' + userByEmployeeId.size + ' of ' + researchers.length + ' researchers in this tenant.')
  if (identityMismatch.length) {
    console.log('REFUSED ' + identityMismatch.length + ' employee-ID match(es) — wrong person holds the ID:')
    identityMismatch.slice(0, 10).forEach((m) => console.log('  - ' + m))
  }

  const unmatched: string[] = []
  let created = 0
  let skippedExisting = 0
  let skippedCap = 0

  for (const researcher of researchers) {
    const profile = userByEmployeeId.get(String(researcher.employeeId))
    if (!profile) {
      unmatched.push(researcher.employeeId + ' ' + researcher.name)
      continue
    }

    const existing = await prisma.referenceLibrary.findMany({
      where: { userId: profile.user_id, isActive: true, tags: { has: FUNDING_PUBLICATION_TAG } },
      select: { id: true, title: true },
    })
    const existingTitles = new Set(existing.map((e) => titleKey(e.title)))
    let slotsLeft = MAX_FUNDING_PUBLICATIONS - existing.length

    for (const pub of researcher.publications) {
      if (existingTitles.has(titleKey(pub.title))) {
        skippedExisting += 1
        continue
      }
      if (slotsLeft <= 0) {
        skippedCap += 1
        continue
      }

      const matchText = buildFundingPublicationMatchText({
        title: pub.title,
        abstract: pub.abstract,
        venue: pub.venue,
        year: pub.year,
        authors: [researcher.name],
      })

      if (!DRY_RUN) {
        await prisma.referenceLibrary.create({
          data: {
            userId: profile.user_id,
            title: pub.title,
            authors: [researcher.name],
            venue: pub.venue,
            year: pub.year, // null — the authorship export carries no publication dates
            abstract: pub.abstract,
            sourceType: 'JOURNAL_ARTICLE',
            importSource: 'MANUAL',
            tags: [FUNDING_PUBLICATION_TAG, SYNTHETIC_TAG],
            notes: pub.notes,
            // Populated so the embedding backfill treats these as pending, not stale.
            fundingMatchText: matchText,
            fundingMatchHash: crypto.createHash('sha256').update(matchText).digest('hex'),
            isActive: true,
            isRead: false,
            isFavorite: false,
          },
        })
      }
      existingTitles.add(titleKey(pub.title))
      slotsLeft -= 1
      created += 1
    }
  }

  console.log('\nPublications ' + (DRY_RUN ? 'that would be created' : 'created') + ': ' + created)
  console.log('Skipped (already present):    ' + skippedExisting)
  console.log('Skipped (5-publication cap):  ' + skippedCap)
  console.log('Researchers not in tenant:    ' + unmatched.length)
  unmatched.slice(0, 10).forEach((u) => console.log('  - ' + u))
  if (unmatched.length > 10) console.log('  ...and ' + (unmatched.length - 10) + ' more')

  if (!DRY_RUN && created > 0) {
    console.log('\nNext: generate embeddings so these feed funding matching —')
    console.log('  POST /api/admin/funding/embeddings/backfill {"target":"all","limit":100}')
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
