/**
 * Step 8 — pre-flight collision check. Read-only; writes nothing.
 *
 * Run this against the REAL tenant before importing. The rehearsal in step 7
 * proved two things about a tenant that already has members:
 *
 *   EMAIL collision      -> the import UPDATES that user in place. Their name,
 *                           employee ID, school, department, research areas and
 *                           research summary are all OVERWRITTEN with the roster
 *                           row's values. Roles and password survive (the roster
 *                           deliberately ships no Role column), so the account
 *                           still works — but the person's profile is replaced
 *                           by somebody else's, silently, with no error.
 *
 *   EMPLOYEE ID collision -> the row is REJECTED with a clear message and
 *                           nothing is written. Safe, but that researcher is
 *                           missing from the seed until it is resolved.
 *
 * Neither shows up as a failure you would notice in the summary counts, which is
 * why this runs first.
 *
 *   npx tsx scripts/lpu-faculty/08-preflight.ts --tenant-id=<id>
 *   npx tsx scripts/lpu-faculty/08-preflight.ts --ati=<atiId>
 */

import fs from 'fs'
import path from 'path'
import { prisma } from '../../src/lib/prisma'
import { parseTabularUpload } from '../../src/lib/spreadsheet/parseTabularUpload'

const ROSTER_PATH = path.join(__dirname, 'out', 'lpu-faculty-roster-final.csv')

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const TENANT_ID = flag('tenant-id')
const ATI = flag('ati')

async function main() {
  if (!TENANT_ID && !ATI) {
    console.error('Pass --tenant-id=<id> or --ati=<atiId>.')
    process.exit(1)
  }
  if (!fs.existsSync(ROSTER_PATH)) {
    console.error('No roster at ' + ROSTER_PATH + ' — run 05-hr-merge.ts first.')
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

  const roster = parseTabularUpload(fs.readFileSync(ROSTER_PATH), 'lpu-faculty-roster-final.csv')
  const byEmail = new Map<string, { name: string; employeeId: string }>()
  const byEmployeeId = new Map<string, { name: string; email: string }>()
  for (const row of roster.rows) {
    const email = (row.email || '').trim().toLowerCase()
    const employeeId = (row.employeeid || '').trim()
    const name = (row.name || '').trim()
    if (email) byEmail.set(email, { name, employeeId })
    if (employeeId) byEmployeeId.set(employeeId, { name, email })
  }

  console.log('Tenant:  ' + tenant.name + ' (' + tenant.atiId + ')')
  console.log('Roster:  ' + roster.rows.length + ' rows\n')

  const existingUsers = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    select: {
      email: true, name: true, roles: true, passwordHash: true,
      researcher_profile: { select: { employee_id: true, school: true, department: true } },
    },
  })
  console.log('Tenant currently holds ' + existingUsers.length + ' user(s):')
  existingUsers.slice(0, 20).forEach((u) =>
    console.log('  ' + u.email.padEnd(38) + ' ' + JSON.stringify(u.roles) +
      ' empId=' + (u.researcher_profile?.employee_id ?? '-') +
      ' activated=' + Boolean(u.passwordHash))
  )
  if (existingUsers.length > 20) console.log('  ...and ' + (existingUsers.length - 20) + ' more')

  // An email hit is only dangerous when it is a DIFFERENT person. On a re-import
  // every seeded user matches its own row; that is a harmless in-place refresh,
  // not a profile being handed to someone else. Employee ID is what separates
  // the two: same ID = same person, different (or missing) ID = different person.
  const emailMatches = existingUsers.filter((u) => byEmail.has(u.email.toLowerCase()))
  const emailHits = emailMatches.filter((u) => {
    const row = byEmail.get(u.email.toLowerCase())!
    return (u.researcher_profile?.employee_id ?? '') !== row.employeeId
  })
  const benignRefreshes = emailMatches.length - emailHits.length
  const employeeIdHits = existingUsers.filter((u) => {
    const id = u.researcher_profile?.employee_id
    if (!id) return false
    const rosterRow = byEmployeeId.get(id)
    // Same person arriving on the same row is not a collision.
    return Boolean(rosterRow) && rosterRow!.email.toLowerCase() !== u.email.toLowerCase()
  })

  console.log('\n--- EMAIL COLLISIONS (profile would be OVERWRITTEN) ---')
  if (!emailHits.length) console.log('  none')
  emailHits.forEach((u) => {
    const row = byEmail.get(u.email.toLowerCase())!
    console.log('  ' + u.email)
    console.log('     existing: ' + u.name + '  roles=' + JSON.stringify(u.roles) +
      '  empId=' + (u.researcher_profile?.employee_id ?? '-') +
      '  ' + (u.researcher_profile?.school ?? '-') + ' / ' + (u.researcher_profile?.department ?? '-'))
    console.log('     roster:   ' + row.name + '  empId=' + row.employeeId + '   <-- would replace the above')
  })

  console.log('\n--- EMPLOYEE ID COLLISIONS (roster row would be REJECTED) ---')
  if (!employeeIdHits.length) console.log('  none')
  employeeIdHits.forEach((u) => {
    const id = u.researcher_profile!.employee_id!
    const row = byEmployeeId.get(id)!
    console.log('  employee ID ' + id + ' held by ' + u.email + ' (' + u.name + ')')
    console.log('     roster row ' + row.email + ' (' + row.name + ') would fail and be skipped')
  })

  if (benignRefreshes) {
    console.log('\n' + benignRefreshes + ' row(s) match an existing user with the SAME employee ID -')
    console.log('  already seeded; a re-import refreshes them in place. Not a collision.')
  }

  const total = emailHits.length + employeeIdHits.length
  console.log('\n' + (total === 0
    ? 'CLEAR — no collisions. The import cannot disturb any existing member.'
    : total + ' collision(s) found. Resolve these before importing.'))
  process.exitCode = total === 0 ? 0 : 2
}

main()
  .catch((error) => {
    console.error('Pre-flight failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
