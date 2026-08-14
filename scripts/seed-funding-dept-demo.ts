/**
 * Seeds a throwaway tenant exercising the Funding Department end to end, so the
 * module can be verified without touching real data.
 *
 * Creates: a tenant, 3 schools, 3 faculty, 2 department members (one head), a
 * coverage split, and one assignment per member. Everything is namespaced with
 * a run marker so `--cleanup` can remove exactly what it made.
 *
 * Usage:
 *   node ./node_modules/tsx/dist/cli.cjs scripts/seed-funding-dept-demo.ts
 *   node ./node_modules/tsx/dist/cli.cjs scripts/seed-funding-dept-demo.ts --cleanup
 */
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

function readEnvFile(envPath: string) {
  const buffer = fs.readFileSync(envPath)
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le')
  }
  return buffer.toString('utf8')
}

for (const filename of ['.env', '.env.local']) {
  const envPath = path.join(process.cwd(), filename)
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(readEnvFile(envPath))
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value
    }
  }
}

const MARKER = 'fdept-demo'
const ATI_ID = 'FDEPT-DEMO-ATI'
const PASSWORD = 'FundingDept!2026'

async function main() {
  const { default: prisma } = await import('../src/lib/prisma')
  const bcrypt = (await import('bcryptjs')).default

  if (process.argv.includes('--cleanup')) {
    const tenant = await prisma.tenant.findUnique({ where: { atiId: ATI_ID } })
    if (!tenant) {
      console.log('Nothing to clean up.')
      await prisma.$disconnect()
      return
    }
    // Cascades take the org units, profiles, members, coverage, assignments
    // and follow-ups with it.
    await prisma.fundingCall.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
    console.log(`Removed demo tenant ${tenant.id}.`)
    await prisma.$disconnect()
    return
  }

  const tenant = await prisma.tenant.upsert({
    where: { atiId: ATI_ID },
    create: { name: 'Funding Dept Demo University', atiId: ATI_ID, type: 'ENTERPRISE' },
    update: {},
  })
  console.log(`Tenant: ${tenant.id}`)

  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  async function ensureUser(local: string, name: string, roles: any[]) {
    const email = `${local}.${MARKER}@example.edu`
    return prisma.user.upsert({
      where: { email },
      create: { email, name, tenantId: tenant.id, roles, passwordHash, emailVerified: true },
      update: { tenantId: tenant.id, roles, passwordHash },
    })
  }

  async function ensureSchool(name: string) {
    const existing = await prisma.tenantOrgUnit.findFirst({
      where: { tenant_id: tenant.id, name, parent_id: null },
    })
    if (existing) return existing
    return prisma.tenantOrgUnit.create({
      data: { tenant_id: tenant.id, name, kind: 'SCHOOL', depth: 0 },
    })
  }

  const admin = await ensureUser('admin', 'Dept Demo Admin', ['OWNER'])
  const head = await ensureUser('dsr.head', 'Priya Menon', ['MEMBER'])
  const member = await ensureUser('dsr.officer', 'Arun Rao', ['MEMBER'])

  const engineering = await ensureSchool('School of Engineering')
  const sciences = await ensureSchool('School of Sciences')
  const management = await ensureSchool('School of Management')

  const faculty = []
  for (const [index, spec] of [
    { local: 'faculty.one', name: 'Dr Neha Sharma', school: engineering, areas: ['photonics', 'optical sensors'] },
    { local: 'faculty.two', name: 'Dr Vikram Iyer', school: sciences, areas: ['catalysis', 'green chemistry'] },
    { local: 'faculty.three', name: 'Dr Meera Nair', school: management, areas: ['innovation policy'] },
  ].entries()) {
    const user = await ensureUser(spec.local, spec.name, ['ANALYST'])
    await prisma.researcherProfile.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        display_name: spec.name,
        employee_id: `EMP-${1000 + index}`,
        org_unit_id: spec.school.id,
        school: spec.school.name,
        research_areas: spec.areas,
        keywords: spec.areas,
      },
      update: { org_unit_id: spec.school.id, school: spec.school.name, research_areas: spec.areas },
    })
    faculty.push({ user, school: spec.school })
  }

  const headMember = await prisma.fundingDeptMember.upsert({
    where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: head.id } },
    create: {
      tenant_id: tenant.id,
      user_id: head.id,
      is_head: true,
      title: 'Director (Sponsored Research)',
      added_by_user_id: admin.id,
    },
    update: { is_head: true, is_active: true },
  })
  const officerMember = await prisma.fundingDeptMember.upsert({
    where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: member.id } },
    create: {
      tenant_id: tenant.id,
      user_id: member.id,
      title: 'Research Development Officer',
      added_by_user_id: admin.id,
    },
    update: { is_active: true },
  })

  // Head covers Engineering; the officer covers Sciences. Management is left
  // deliberately uncovered so the "nobody assigned" warning has something to say.
  await prisma.fundingDeptSchoolAssignment.deleteMany({ where: { tenant_id: tenant.id } })
  await prisma.fundingDeptSchoolAssignment.createMany({
    data: [
      { tenant_id: tenant.id, member_id: headMember.id, org_unit_id: engineering.id, assigned_by_user_id: admin.id },
      { tenant_id: tenant.id, member_id: officerMember.id, org_unit_id: sciences.id, assigned_by_user_id: admin.id },
    ],
  })

  const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const call = await prisma.fundingCall.upsert({
    where: { id: `${MARKER}-call-1` },
    create: {
      id: `${MARKER}-call-1`,
      tenantId: tenant.id,
      title: 'Demo: Advanced Photonics Research Grant',
      scheme_title: 'Demo: Advanced Photonics Research Grant',
      agency_name: 'Demo Science Foundation',
      agencyName: 'Demo Science Foundation',
      visibility: 'TENANT_PRIVATE',
      status: 'PUBLISHED',
      catalog_status: 'PUBLISHED',
      close_date: inTwoWeeks,
      sourceType: 'MANUAL',
      createdByUserId: admin.id,
      updatedByUserId: admin.id,
    },
    update: { close_date: inTwoWeeks },
  })

  const assignment = await prisma.callAssignment.upsert({
    where: {
      funding_call_id_assignee_user_id: {
        funding_call_id: call.id,
        assignee_user_id: faculty[0].user.id,
      },
    },
    create: {
      tenant_id: tenant.id,
      funding_call_id: call.id,
      assignee_user_id: faculty[0].user.id,
      assigned_by_user_id: head.id,
      assignee_org_unit_id: faculty[0].school.id,
      message: 'This looks like a strong fit for your optical sensing work.',
      deadline_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {},
  })

  await prisma.assignmentFollowUp.deleteMany({ where: { assignment_id: assignment.id } })
  await prisma.assignmentFollowUp.createMany({
    data: [
      {
        tenant_id: tenant.id,
        assignment_id: assignment.id,
        created_by_user_id: head.id,
        kind: 'CALL',
        note: 'Called — she is checking whether the co-PI is available.',
      },
      {
        tenant_id: tenant.id,
        assignment_id: assignment.id,
        created_by_user_id: head.id,
        kind: 'REMINDER',
        note: 'Chase for a decision before the internal deadline.',
        // Already due, so the sweep has something to fire immediately.
        remind_at: new Date(Date.now() - 60 * 1000),
        remind_faculty: true,
      },
    ],
  })

  console.log('\nSeeded. Sign in at /login with password:', PASSWORD)
  console.log(`  admin  : ${admin.email}      (OWNER — staffs the department)`)
  console.log(`  head   : ${head.email}   (department head, covers Engineering)`)
  console.log(`  officer: ${member.email} (member, covers Sciences)`)
  console.log(`  faculty: ${faculty[0].user.email} (has the assignment to accept/decline)`)
  console.log('\nSchool of Management is deliberately uncovered.')
  console.log(`Head user id (for --scope): ${head.id}`)

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
