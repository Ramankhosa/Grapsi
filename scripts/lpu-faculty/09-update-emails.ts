/**
 * Step 9 — replace the placeholder addresses with real ones from HR.
 *
 * The seed used <employeeID>@lpu.co.in placeholders because the authorship
 * export carried no addresses. This swaps them for the real ones IN PLACE.
 *
 * It must be an update, not a re-import: facultyImportService identifies people
 * by email, so re-uploading a roster with new addresses would create a second
 * set of 768 accounts rather than updating the existing ones.
 *
 * Matching is on ResearcherProfile.employee_id within the tenant — the same key
 * the whole pipeline uses. Email is what changes, so it cannot also be the key.
 *
 * Input: any CSV/XLSX with an Employee ID column and an Email column. Extra
 * columns are ignored, so an HR export can be passed through unedited.
 *
 *   npx tsx scripts/lpu-faculty/09-update-emails.ts --ati=DSRLPU --file=<hr file>
 *   npx tsx scripts/lpu-faculty/09-update-emails.ts --ati=DSRLPU --file=<hr file> --apply
 */

import fs from 'fs'
import path from 'path'
import { prisma } from '../../src/lib/prisma'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const TENANT_ID = flag('tenant-id')
const ATI = flag('ati')
const FILE = flag('file')
const APPLY = args.includes('--apply')
/**
 * By default only accounts that have never been activated are touched. Someone
 * who already set a password signs in with their current address, so changing it
 * silently would lock them out of a working login.
 */
const INCLUDE_ACTIVATED = args.includes('--include-activated')

async function main() {
  if ((!TENANT_ID && !ATI) || !FILE) {
    console.error('Usage: --ati=<atiId> (or --tenant-id=<id>) --file=<csv|xlsx> [--apply] [--include-activated]')
    process.exit(1)
  }
  if (!fs.existsSync(FILE)) {
    console.error('File not found: ' + FILE)
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
  console.log('Tenant: ' + tenant.name + ' (' + tenant.atiId + ')')
  if (!APPLY) console.log('DRY RUN — nothing will be written.\n')

  // --- read the HR file ------------------------------------------------------
  const sheet = parseTabularUpload(fs.readFileSync(FILE), path.basename(FILE))
  console.log('Columns found: ' + sheet.headers.join(' | '))

  const wanted = new Map<string, string>()
  const fileProblems: string[] = []
  const seenEmail = new Map<string, string>()

  for (const row of sheet.rows) {
    const employeeId = (row.employeeid || row.uid || '').trim()
    const email = (row.email || row.emailaddress || row.officialemail || row.emailid || '').trim().toLowerCase()
    if (!employeeId && !email) continue
    if (!employeeId) {
      fileProblems.push('row with email ' + email + ' has no Employee ID')
      continue
    }
    if (!email) {
      fileProblems.push(employeeId + ': no email supplied — skipped')
      continue
    }
    if (!EMAIL_PATTERN.test(email)) {
      fileProblems.push(employeeId + ': malformed email "' + email + '"')
      continue
    }
    if (seenEmail.has(email)) {
      fileProblems.push(employeeId + ': email ' + email + ' also used by ' + seenEmail.get(email) + ' in this file')
      continue
    }
    seenEmail.set(email, employeeId)
    wanted.set(employeeId, email)
  }

  console.log('Usable rows: ' + wanted.size + ' | unusable: ' + fileProblems.length)
  fileProblems.slice(0, 10).forEach((p) => console.log('   - ' + p))

  // --- match against the tenant ---------------------------------------------
  const profiles = await prisma.researcherProfile.findMany({
    where: { employee_id: { in: [...wanted.keys()] }, user: { tenantId: tenant.id } },
    select: {
      employee_id: true,
      user: { select: { id: true, email: true, passwordHash: true, name: true } },
    },
  })
  console.log('\nMatched in tenant: ' + profiles.length + ' of ' + wanted.size)

  // Email is globally unique, so a target already in use anywhere must be refused.
  const targets = [...wanted.values()]
  const takenRows = await prisma.user.findMany({
    where: { email: { in: targets } },
    select: { id: true, email: true, tenantId: true },
  })
  const takenBy = new Map<string, { id: string; email: string; tenantId: string | null }>(
    takenRows.map((u) => [u.email.toLowerCase(), u])
  )

  const planned: Array<{ userId: string; from: string; to: string; name: string | null }> = []
  const skipped: string[] = []

  for (const profile of profiles) {
    const employeeId = String(profile.employee_id)
    const target = wanted.get(employeeId)!
    const current = profile.user.email.toLowerCase()

    if (current === target) {
      skipped.push(employeeId + ': already ' + target)
      continue
    }
    if (profile.user.passwordHash && !INCLUDE_ACTIVATED) {
      skipped.push(employeeId + ': already activated — pass --include-activated to change it anyway')
      continue
    }
    const holder = takenBy.get(target)
    if (holder && holder.id !== profile.user.id) {
      skipped.push(employeeId + ': target ' + target + ' already belongs to another account')
      continue
    }
    planned.push({ userId: profile.user.id, from: profile.user.email, to: target, name: profile.user.name })
  }

  const notInTenant = [...wanted.keys()].filter((id) => !profiles.some((p) => String(p.employee_id) === id))

  console.log('\nTo update : ' + planned.length)
  console.log('Skipped   : ' + skipped.length)
  skipped.slice(0, 10).forEach((s) => console.log('   - ' + s))
  console.log('Not in tenant: ' + notInTenant.length + (notInTenant.length ? ' (' + notInTenant.slice(0, 5).join(', ') + '...)' : ''))

  console.log('\nSample of what would change:')
  planned.slice(0, 8).forEach((p) => console.log('   ' + p.from.padEnd(30) + ' -> ' + p.to))

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  // One transaction: either every address changes or none does, so the roster
  // can never end up half-migrated.
  await prisma.$transaction(
    planned.map((p) =>
      prisma.user.update({ where: { id: p.userId }, data: { email: p.to } })
    )
  )
  console.log('\nUpdated ' + planned.length + ' email address(es).')
  console.log('Those users now activate at /set-password with the NEW address + their Employee ID.')
}

main()
  .catch((error) => {
    console.error('Update failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
