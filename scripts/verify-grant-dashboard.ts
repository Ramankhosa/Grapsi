/**
 * End-to-end verification for the tenant grant dashboard, reporting and the
 * in-app notification centre.
 *
 * Drives the real HTTP API on a running dev server with a minted access token,
 * inside an isolated throwaway tenant that is purged at the end.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/verify-grant-dashboard.ts [baseUrl] [--keep]
 */

import { prisma } from '../src/lib/prisma'
import { generateJWT } from '../src/lib/auth'

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const BASE_URL = positional[0] || 'http://localhost:3011'
const KEEP = process.argv.includes('--keep')
const STAMP = Date.now()
const MARKER = `e2e-gd-${STAMP}`

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${label}`)
    if (detail !== undefined) {
      console.error('        →', typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

async function api(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  })
  const text = await response.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body, text }
}

function tokenFor(
  user: { id: string; email: string; roles: string[] },
  tenantId: string,
  atiId: string
) {
  return generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: tenantId,
    roles: user.roles,
    ati_id: null,
    tenant_ati_id: atiId,
    scope: 'tenant',
  })
}

function daysFromNow(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

async function purgeTenant(tenantId: string) {
  const userIds = (await prisma.user.findMany({ where: { tenantId }, select: { id: true } })).map(
    (u) => u.id
  )
  await prisma.notification.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.callAssignment.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.facultyImportJob.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.researcherProfile.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.user.deleteMany({ where: { tenantId } })
  await prisma.tenantOrgUnit.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.fundingCall.deleteMany({ where: { tenantId } })
  await prisma.tenant.delete({ where: { id: tenantId } })
}

async function sweepLeftovers() {
  const stale = await prisma.tenant.findMany({
    where: { atiId: { startsWith: 'ATI-e2e-gd-' } },
    select: { id: true },
  })
  for (const { id } of stale) {
    await purgeTenant(id)
  }
  if (stale.length > 0) {
    console.log(`Swept ${stale.length} leftover tenant(s) from a previous run`)
  }
}

async function main() {
  console.log(`Verifying against ${BASE_URL} (marker ${MARKER})`)
  await sweepLeftovers()

  let tenantId: string | null = null

  try {
    // --- Fixtures -----------------------------------------------------------
    const tenant = await prisma.tenant.create({
      data: { name: `E2E Dash ${STAMP}`, atiId: `ATI-${MARKER}`, type: 'ENTERPRISE', status: 'ACTIVE' },
    })
    tenantId = tenant.id

    const admin = await prisma.user.create({
      data: {
        email: `admin-${MARKER}@verify.local`,
        name: 'Dash Admin',
        tenantId: tenant.id,
        roles: ['ADMIN'],
        status: 'ACTIVE',
      },
    })
    const adminToken = tokenFor(admin, tenant.id, tenant.atiId)

    // Org: two schools, one department each.
    const cse = await prisma.tenantOrgUnit.create({
      data: { tenant_id: tenant.id, kind: 'SCHOOL', name: 'School of CS' },
    })
    const ai = await prisma.tenantOrgUnit.create({
      data: { tenant_id: tenant.id, kind: 'DEPARTMENT', name: 'Dept of AI', parent_id: cse.id },
    })
    const life = await prisma.tenantOrgUnit.create({
      data: { tenant_id: tenant.id, kind: 'SCHOOL', name: 'School of Life Sciences' },
    })
    const genomics = await prisma.tenantOrgUnit.create({
      data: { tenant_id: tenant.id, kind: 'DEPARTMENT', name: 'Dept of Genomics', parent_id: life.id },
    })

    async function makeFaculty(name: string, unitId: string, school: string, department: string) {
      const user = await prisma.user.create({
        data: {
          email: `${name.toLowerCase().replace(/\s+/g, '-')}-${MARKER}@verify.local`,
          name,
          tenantId: tenant.id,
          roles: ['ANALYST'],
          status: 'ACTIVE',
        },
      })
      await prisma.researcherProfile.create({
        data: { user_id: user.id, display_name: name, org_unit_id: unitId, school, department },
      })
      return user
    }

    const asha = await makeFaculty('Asha Verma', ai.id, 'School of CS', 'Dept of AI')
    const ravi = await makeFaculty('Ravi Nair', ai.id, 'School of CS', 'Dept of AI')
    const meera = await makeFaculty('Meera Iyer', genomics.id, 'School of Life Sciences', 'Dept of Genomics')

    async function makeCall(title: string, agency: string, closeDate: Date | null) {
      return prisma.fundingCall.create({
        data: {
          tenantId: tenant.id,
          visibility: 'TENANT_PRIVATE',
          status: 'PUBLISHED',
          title,
          agencyName: agency,
          close_date: closeDate,
          createdByUserId: admin.id,
          updatedByUserId: admin.id,
        } as any,
      })
    }

    const callA = await makeCall(`AI Health ${STAMP}`, 'SERB', daysFromNow(60))
    const callB = await makeCall(`Genome Atlas ${STAMP}`, 'DBT', daysFromNow(45))
    const callC = await makeCall(`Quantum ${STAMP}`, 'SERB', daysFromNow(30))
    // Closed long ago and never assigned — the org-level "missed opportunity".
    const lapsed = await makeCall(`Lapsed Grant ${STAMP}`, 'ICMR', daysFromNow(-20))

    // Assignments spanning every bucket.
    const base = {
      tenant_id: tenant.id,
      assigned_by_user_id: admin.id,
    }
    // Active: deadline ahead.
    await prisma.callAssignment.create({
      data: { ...base, funding_call_id: callA.id, assignee_user_id: asha.id, deadline_at: daysFromNow(20), status: 'ASSIGNED' },
    })
    // Missed: open, deadline passed.
    await prisma.callAssignment.create({
      data: { ...base, funding_call_id: callC.id, assignee_user_id: ravi.id, deadline_at: daysFromNow(-5), status: 'IN_PROGRESS' },
    })
    // Submitted + AWARDED.
    const awarded = await prisma.callAssignment.create({
      data: {
        ...base,
        funding_call_id: callB.id,
        assignee_user_id: meera.id,
        deadline_at: daysFromNow(-2),
        status: 'COMPLETED',
        submission_reference: 'DBT/2026/77',
        submitted_at: daysFromNow(-3),
        completed_at: daysFromNow(-3),
        outcome: 'AWARDED',
        award_amount: 2500000,
        award_currency: 'INR',
        decision_at: daysFromNow(-1),
      },
    })
    // Submitted, still pending a decision.
    await prisma.callAssignment.create({
      data: {
        ...base,
        funding_call_id: callA.id,
        assignee_user_id: meera.id,
        deadline_at: daysFromNow(-8),
        status: 'COMPLETED',
        submission_reference: 'SERB/2026/12',
        submitted_at: daysFromNow(-9),
        completed_at: daysFromNow(-9),
      },
    })
    // Cancelled — must not count as missed.
    await prisma.callAssignment.create({
      data: { ...base, funding_call_id: callC.id, assignee_user_id: meera.id, deadline_at: daysFromNow(-30), status: 'CANCELLED' },
    })

    // --- Summary buckets ----------------------------------------------------
    section('Dashboard buckets')
    const dash = await api(adminToken, '/api/tenant-admin/grant-dashboard')
    check('dashboard responds', dash.status === 200, dash.body)
    const s = dash.body?.summary
    check('Active counts only open assignments with a future deadline', s?.active === 1, s)
    check('Submitted counts completed assignments', s?.submitted === 2, s)
    check('Missed counts open assignments past their deadline', s?.missed === 1, s)
    check('Cancelled is tracked separately, not as missed', s?.cancelled === 1, s)
    check('Awarded count and funding total are rolled up', s?.awarded === 1 && s?.awardedAmount === 2500000, s)
    check('success rate is awarded/decided', s?.successRate === 100, s)
    check('unassigned expired calls are surfaced', s?.unassignedExpiredCalls === 1, s)
    check(
      'the lapsed call is the one reported',
      (dash.body?.unassignedExpired || []).some((c: any) => c.id === lapsed.id),
      dash.body?.unassignedExpired
    )
    check('missed panel lists the overdue assignment', (dash.body?.missed || []).length === 1, dash.body?.missed)
    check('upcoming panel lists the active one', (dash.body?.upcoming || []).length === 1, dash.body?.upcoming)

    // --- Allocation + filters ----------------------------------------------
    section('Allocation and school/department filters')
    const alloc = dash.body?.allocation || []
    check('allocation has a row per faculty with assignments', alloc.length === 3, alloc.map((a: any) => a.facultyName))
    check(
      'allocation carries school and department',
      alloc.every((row: any) => row.school && row.department),
      alloc
    )

    const filtered = await api(adminToken, `/api/tenant-admin/grant-dashboard?orgUnitIds=${ai.id}`)
    const filteredNames = (filtered.body?.allocation || []).map((r: any) => r.facultyName).sort()
    check(
      'department filter restricts allocation to that department',
      filteredNames.length === 2 && !filteredNames.includes('Meera Iyer'),
      filteredNames
    )
    check('department filter changes the buckets too', filtered.body?.summary?.submitted === 0, filtered.body?.summary)

    const genomicsOnly = await api(adminToken, `/api/tenant-admin/grant-dashboard?orgUnitIds=${genomics.id}`)
    check(
      'other department sees only its own faculty',
      (genomicsOnly.body?.allocation || []).every((r: any) => r.facultyName === 'Meera Iyer'),
      genomicsOnly.body?.allocation
    )

    const agencyFiltered = await api(adminToken, '/api/tenant-admin/grant-dashboard?agency=DBT')
    check('agency filter narrows results', agencyFiltered.body?.summary?.total === 1, agencyFiltered.body?.summary)

    const futureOnly = await api(
      adminToken,
      `/api/tenant-admin/grant-dashboard?dateFrom=${daysFromNow(5).toISOString()}`
    )
    check('date range excludes older assignments', futureOnly.body?.summary?.total === 0, futureOnly.body?.summary)

    // --- Reporting ----------------------------------------------------------
    section('Reporting')
    const byAgency = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=agency')
    const agencies = (byAgency.body?.rows || []).map((r: any) => r.label).sort()
    check('agency report groups by agency', agencies.includes('SERB') && agencies.includes('DBT'), agencies)

    const byCall = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=call')
    check('call report returns one row per call', (byCall.body?.rows || []).length === 3, byCall.body?.rows?.length)

    const bySchool = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=school')
    check('school report groups by school', (bySchool.body?.rows || []).length === 2, bySchool.body?.rows)

    const byYear = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=year')
    const thisYear = String(new Date().getFullYear())
    check('year report buckets by year', (byYear.body?.rows || []).some((r: any) => r.label === thisYear), byYear.body?.rows)

    const byMonth = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=month')
    check('month report uses YYYY-MM labels', /^\d{4}-\d{2}$/.test(byMonth.body?.rows?.[0]?.label || ''), byMonth.body?.rows)

    const badGroup = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=bogus')
    check('invalid groupBy is rejected', badGroup.status === 400, badGroup.body)

    const csv = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=agency&format=csv')
    check('CSV export returns a header row', (csv.text || '').startsWith('Group (agency),Active,Submitted'), (csv.text || '').slice(0, 80))
    // Only SERB and DBT have assignments at this point; ICMR is assigned later.
    const csvLines = (csv.text || '').trim().split('\n')
    check(
      'CSV export has one row per agency under the header',
      csvLines.length === (byAgency.body?.rows || []).length + 1,
      csvLines
    )
    check(
      'CSV rows carry the agency labels',
      csvLines.some((line) => line.startsWith('SERB,')) && csvLines.some((line) => line.startsWith('DBT,')),
      csvLines
    )

    // --- Notifications ------------------------------------------------------
    section('Notification centre')
    const ashaToken = tokenFor({ id: asha.id, email: asha.email, roles: asha.roles }, tenant.id, tenant.atiId)

    const toOne = await api(adminToken, '/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Direct note', body: 'For Asha only', userIds: [asha.id] }),
    })
    check('admin can notify a single faculty member', toOne.status === 201 && toOne.body?.sent === 1, toOne.body)

    const toDept = await api(adminToken, '/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Dept notice', orgUnitIds: [ai.id] }),
    })
    check('notifying a department reaches both its faculty', toDept.body?.sent === 2, toDept.body)

    const toSchool = await api(adminToken, '/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'School notice', orgUnitIds: [cse.id] }),
    })
    check('notifying a school expands to its departments', toSchool.body?.sent === 2, toSchool.body)

    const inbox = await api(ashaToken, '/api/notifications')
    check('faculty sees their notifications', (inbox.body?.notifications || []).length === 3, inbox.body?.notifications?.length)
    check('unread count is reported', inbox.body?.unreadCount === 3, inbox.body?.unreadCount)

    const first = inbox.body.notifications[0]
    const marked = await api(ashaToken, `/api/notifications/${first.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    check('marking read succeeds', marked.status === 200 && Boolean(marked.body?.notification?.readAt), marked.body)

    const afterRead = await api(ashaToken, '/api/notifications')
    check('unread count drops after marking read', afterRead.body?.unreadCount === 2, afterRead.body?.unreadCount)

    const readAll = await api(ashaToken, '/api/notifications/read-all', { method: 'POST' })
    check('read-all clears the remaining unread', readAll.body?.updated === 2, readAll.body)

    const nonAdminSend = await api(ashaToken, '/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should fail', userIds: [ravi.id] }),
    })
    check('non-admin cannot send notifications', nonAdminSend.status === 403, nonAdminSend.body)

    const noRecipients = await api(adminToken, '/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nobody' }),
    })
    check('sending with no recipient is rejected', noRecipients.status === 400, noRecipients.body)

    // --- Auto notification on assignment -----------------------------------
    section('Automatic assignment notifications')
    const beforeAuto = (await api(ashaToken, '/api/notifications')).body?.notifications?.length || 0
    const assignRes = await api(adminToken, '/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fundingCallId: lapsed.id,
        assigneeUserId: asha.id,
        deadlineAt: daysFromNow(10).toISOString(),
        message: 'Please take this one.',
      }),
    })
    check('assignment created', assignRes.status === 201, assignRes.body)
    const afterAuto = await api(ashaToken, '/api/notifications')
    check(
      'assigning a call auto-notifies the faculty member',
      (afterAuto.body?.notifications?.length || 0) === beforeAuto + 1,
      afterAuto.body?.notifications?.length
    )
    check(
      'the auto notification is categorised as ASSIGNMENT',
      afterAuto.body?.notifications?.[0]?.category === 'ASSIGNMENT',
      afterAuto.body?.notifications?.[0]
    )

    // --- Outcome recording --------------------------------------------------
    section('Outcome recording')
    const meeraToken = tokenFor({ id: meera.id, email: meera.email, roles: meera.roles }, tenant.id, tenant.atiId)

    const facultyOutcome = await api(meeraToken, `/api/assignments/${awarded.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'AWARDED', awardAmount: 999 }),
    })
    check('faculty cannot record the funding decision', facultyOutcome.status === 403, facultyOutcome.body)

    const pendingOne = (
      await prisma.callAssignment.findFirst({
        where: { tenant_id: tenant.id, outcome: 'PENDING', status: 'COMPLETED' },
        select: { id: true },
      })
    )!
    const decided = await api(adminToken, `/api/assignments/${pendingOne.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'REJECTED' }),
    })
    check('admin can record a decision', decided.status === 200 && decided.body?.assignment?.outcome === 'REJECTED', decided.body)
    check('decision date is stamped automatically', Boolean(decided.body?.assignment?.decisionAt), decided.body?.assignment)

    const afterDecision = await api(adminToken, '/api/tenant-admin/grant-dashboard')
    check(
      'success rate reflects the new rejection',
      afterDecision.body?.summary?.rejected === 1 && afterDecision.body?.summary?.successRate === 50,
      afterDecision.body?.summary
    )

    // --- Tenant isolation ---------------------------------------------------
    section('Tenant isolation')
    const otherTenant = await prisma.tenant.create({
      data: { name: `E2E Dash Other ${STAMP}`, atiId: `ATI-other-${MARKER}`, type: 'ENTERPRISE', status: 'ACTIVE' },
    })
    const otherAdmin = await prisma.user.create({
      data: {
        email: `other-${MARKER}@verify.local`,
        name: 'Other Admin',
        tenantId: otherTenant.id,
        roles: ['ADMIN'],
        status: 'ACTIVE',
      },
    })
    const otherToken = tokenFor(otherAdmin, otherTenant.id, otherTenant.atiId)

    const otherDash = await api(otherToken, '/api/tenant-admin/grant-dashboard')
    check('another tenant sees an empty dashboard', otherDash.body?.summary?.total === 0, otherDash.body?.summary)

    // A foreign org unit must not leak this tenant's data.
    const crossFilter = await api(otherToken, `/api/tenant-admin/grant-dashboard?orgUnitIds=${ai.id}`)
    check('foreign org unit id leaks nothing', (crossFilter.body?.allocation || []).length === 0, crossFilter.body?.allocation)

    const crossNotify = await api(otherToken, '/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Cross tenant', userIds: [asha.id] }),
    })
    check('cannot notify a user in another tenant', crossNotify.status === 404, crossNotify.body)

    await purgeTenant(otherTenant.id)

    if (KEEP) {
      console.log('\n--keep: fixtures retained for UI inspection')
      console.log(`  tenant  ${tenant.name}`)
      console.log(`  ADMIN_TOKEN=${adminToken}`)
      console.log(`  FACULTY_TOKEN=${ashaToken}`)
    }
  } finally {
    if (tenantId && !KEEP) {
      await purgeTenant(tenantId).catch((error) => {
        console.error('Cleanup failed:', error instanceof Error ? error.message : String(error))
      })
    }
    await prisma.$disconnect()
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (error) => {
  console.error('\nVerification crashed:', error)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
