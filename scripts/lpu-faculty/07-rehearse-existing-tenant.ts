/**
 * Step 7 — rehearse the roster import against a tenant that already has members.
 *
 * The real LPU tenant already has users who joined by ATI token, so the question
 * that matters is not "does the import work" but "can the import disturb people
 * who are already there". This builds a throwaway tenant with four ATI-token
 * members — deliberately including the two collision cases that could do damage
 * — snapshots them, runs the real import, and diffs.
 *
 * Planted cases:
 *   1. OWNER    no collision (control)
 *   2. ADMIN    no collision (control)
 *   3. MANAGER  email collides with a roster row  <- could be demoted / overwritten
 *   4. ANALYST  employee ID collides with a different roster row
 *
 * MANAGER is the sharp edge: it is NOT in PROTECTED_ROLES, so it is the one
 * existing role a roster could legitimately overwrite.
 *
 *   npx tsx scripts/lpu-faculty/07-rehearse-existing-tenant.ts
 *   npx tsx scripts/lpu-faculty/07-rehearse-existing-tenant.ts --keep
 */

import fs from 'fs'
import path from 'path'
import { prisma } from '../../src/lib/prisma'
import { importFacultyRoster } from '../../src/lib/services/facultyImportService'

const ROSTER_PATH = path.join(__dirname, 'out', 'lpu-faculty-roster-final.csv')
const KEEP = process.argv.includes('--keep')
const STAMP = Date.now()
const ATI_ID = 'LPU-REHEARSE-' + STAMP

/** Roster rows the planted members are made to collide with. */
// Both MUST be UIDs present in the final roster. Picking a UID that the roster
// excluded (e.g. StaffStatus=Left) makes the collision silently never fire.
const EMAIL_COLLISION_UID = '30095' // Dr. Swarup Roy, 60 papers, Active
const EMPLOYEE_ID_COLLISION_UID = '17014' // Dr. Vishal Thakur, 57 papers, Active

type Snapshot = {
  email: string
  roles: string[]
  name: string | null
  status: string
  passwordHash: boolean
  employeeId: string | null
  school: string | null
  department: string | null
  researchAreas: string[]
  summary: string | null
}

async function snapshot(tenantId: string, emails: string[]): Promise<Record<string, Snapshot>> {
  const users = await prisma.user.findMany({
    where: { tenantId, email: { in: emails } },
    select: {
      email: true, roles: true, name: true, status: true, passwordHash: true,
      researcher_profile: {
        select: {
          employee_id: true, school: true, department: true,
          research_areas: true, research_summary: true,
        },
      },
    },
  })
  const out: Record<string, Snapshot> = {}
  for (const u of users) {
    out[u.email] = {
      email: u.email,
      roles: [...u.roles].sort(),
      name: u.name,
      status: String(u.status),
      passwordHash: Boolean(u.passwordHash),
      employeeId: u.researcher_profile?.employee_id ?? null,
      school: u.researcher_profile?.school ?? null,
      department: u.researcher_profile?.department ?? null,
      researchAreas: u.researcher_profile?.research_areas ?? [],
      summary: u.researcher_profile?.research_summary ?? null,
    }
  }
  return out
}

function diff(before: Snapshot, after: Snapshot | undefined) {
  if (!after) return ['DISAPPEARED']
  const changes: string[] = []
  const compare = (field: keyof Snapshot) => {
    const a = JSON.stringify(before[field])
    const b = JSON.stringify(after[field])
    if (a !== b) changes.push(field + ': ' + a + ' -> ' + b)
  }
  ;(['roles', 'name', 'status', 'passwordHash', 'employeeId', 'school', 'department', 'researchAreas', 'summary'] as const)
    .forEach(compare)
  return changes
}

/** unitsCreated is a string[] of every unit; print the count, not the list. */
function report(summary: any) {
  console.log('  totalRows=' + summary.totalRows + ' created=' + summary.created +
    ' updated=' + summary.updated + ' errors=' + summary.errors)
  console.log('  unitsCreated=' + (summary.unitsCreated || []).length +
    ' headsCreated=' + summary.headsCreated +
    ' pendingActivation=' + summary.pendingActivation +
    ' activationBlocked=' + summary.activationBlocked)
  const failures = (summary.results || []).filter((r: any) => r.outcome === 'error')
  if (failures.length) {
    console.log('  FAILED ROWS (' + failures.length + '):')
    failures.slice(0, 10).forEach((r: any) =>
      console.log('    row ' + r.rowNumber + '  ' + r.email + '  [' + r.employeeId + ']  ' + r.message))
  }
}

async function main() {
  if (!fs.existsSync(ROSTER_PATH)) {
    console.error('Run 05-hr-merge.ts first — no roster at ' + ROSTER_PATH)
    process.exit(1)
  }

  console.log('Creating rehearsal tenant ' + ATI_ID + '\n')
  const tenant = await prisma.tenant.create({
    data: { name: 'LPU Rehearsal ' + STAMP, atiId: ATI_ID, type: 'ENTERPRISE', status: 'ACTIVE' },
    select: { id: true },
  })

  // An ATI token, so the planted members mirror how the real four joined.
  const token = await prisma.aTIToken.create({
    data: {
      tenantId: tenant.id,
      tokenHash: 'rehearse-' + STAMP,
      fingerprint: 'rehearse-' + STAMP,
      status: 'ISSUED',
      maxUses: 10,
      usageCount: 4,
    },
    select: { id: true },
  })

  const planted = [
    { email: 'owner.' + STAMP + '@lpu.co.in', role: 'OWNER', name: 'Existing Owner', employeeId: 'EXIST-OWNER', label: 'control' },
    { email: 'admin.' + STAMP + '@lpu.co.in', role: 'ADMIN', name: 'Existing Admin', employeeId: 'EXIST-ADMIN', label: 'control' },
    { email: EMAIL_COLLISION_UID + '@lpu.co.in', role: 'MANAGER', name: 'Existing Manager', employeeId: 'EXIST-MGR', label: 'EMAIL collides with roster row ' + EMAIL_COLLISION_UID },
    { email: 'analyst.' + STAMP + '@lpu.co.in', role: 'ANALYST', name: 'Existing Analyst', employeeId: EMPLOYEE_ID_COLLISION_UID, label: 'EMPLOYEE ID collides with roster row ' + EMPLOYEE_ID_COLLISION_UID },
  ]

  for (const p of planted) {
    const user = await prisma.user.create({
      data: {
        email: p.email,
        name: p.name,
        tenantId: tenant.id,
        roles: [p.role as any],
        status: 'ACTIVE',
        passwordHash: 'pre-existing-hash',
        emailVerified: true,
        signupAtiTokenId: token.id,
      },
      select: { id: true },
    })
    await prisma.researcherProfile.create({
      data: {
        user_id: user.id,
        employee_id: p.employeeId,
        display_name: p.name,
        school: 'PRE-EXISTING SCHOOL',
        department: 'PRE-EXISTING DEPARTMENT',
        research_areas: ['Pre-existing Area A', 'Pre-existing Area B'],
        research_summary: 'Set before the roster import. Must survive untouched.',
      },
    })
    console.log('  planted ' + p.role.padEnd(8) + ' ' + p.email.padEnd(34) + ' (' + p.label + ')')
  }

  const emails = planted.map((p) => p.email)
  const before = await snapshot(tenant.id, emails)
  const owner = await prisma.user.findFirst({ where: { tenantId: tenant.id, roles: { has: 'OWNER' } }, select: { id: true } })

  const buffer = fs.readFileSync(ROSTER_PATH)
  const baseOptions = {
    tenantId: tenant.id,
    uploadedByUserId: owner!.id,
    filename: 'lpu-faculty-roster-final.csv',
    buffer,
    autoCreateUnits: true,
  }

  console.log('\n--- DRY RUN ---')
  const dry = await importFacultyRoster({ ...baseOptions, dryRun: true })
  report(dry)

  console.log('\n--- REAL IMPORT ---')
  const real = await importFacultyRoster({ ...baseOptions, dryRun: false })
  report(real)

  console.log('\n--- EXISTING MEMBERS AFTER IMPORT ---')
  const after = await snapshot(tenant.id, emails)
  let disturbed = 0
  for (const p of planted) {
    const changes = diff(before[p.email], after[p.email])
    if (changes.length === 0) {
      console.log('  UNTOUCHED  ' + p.role.padEnd(8) + ' ' + p.email)
    } else {
      disturbed += 1
      console.log('  CHANGED    ' + p.role.padEnd(8) + ' ' + p.email + '  (' + p.label + ')')
      changes.forEach((c) => console.log('               ' + c))
    }
  }

  const totalUsers = await prisma.user.count({ where: { tenantId: tenant.id } })
  const units = await prisma.tenantOrgUnit.count({ where: { tenant_id: tenant.id } })
  console.log('\nTenant now holds ' + totalUsers + ' users across ' + units + ' org units.')
  console.log(disturbed === 0
    ? 'RESULT: no pre-existing member was modified.'
    : 'RESULT: ' + disturbed + ' pre-existing member(s) were modified — see above.')

  if (KEEP) {
    console.log('\n--keep: tenant retained. id=' + tenant.id + ' atiId=' + ATI_ID)
    console.log('Seed publications with:')
    console.log('  npx tsx scripts/lpu-faculty/04-seed-publications.ts --tenant-id=' + tenant.id)
  } else {
    await prisma.tenant.delete({ where: { id: tenant.id } })
    console.log('\nRehearsal tenant deleted.')
  }
}

main()
  .catch((error) => {
    console.error('Rehearsal failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
