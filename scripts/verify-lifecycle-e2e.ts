/**
 * Full tenant lifecycle verification, end to end, against a running dev server.
 *
 *   tenant -> deep org structure -> faculty (manpower) import with employee IDs
 *   -> profile embeddings -> saved research areas -> publications
 *   -> funding call -> researcher matching -> assignment -> submission
 *   -> outcome -> grant dashboard -> notifications
 *
 * Every step drives the real HTTP API with a minted token, so routing, auth,
 * validation, embeddings and DB writes are all exercised. Creates an isolated
 * throwaway tenant and removes it at the end.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/verify-lifecycle-e2e.ts [baseUrl]
 *
 * Checks marked GAP are known-unimplemented work (multi-level hierarchy phases
 * 1-4). They report as GAP, not FAIL, so the exit code still means "regression".
 */

import { prisma } from '../src/lib/prisma'
import { generateJWT } from '../src/lib/auth'

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const BASE_URL = positional[0] || 'http://localhost:3010'
const KEEP = process.argv.includes('--keep')
const STAMP = Date.now()
const MARKER = `e2e-life-${STAMP}`

let passed = 0
let failed = 0
let gaps = 0

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

/** A known missing capability. Records the observed behaviour without failing. */
function gap(label: string, observedAsExpected: boolean, detail?: unknown) {
  gaps += 1
  console.log(`  GAP   ${label}`)
  if (!observedAsExpected) {
    console.log('        ! behaved differently than the gap analysis predicted:')
    console.log('        →', typeof detail === 'string' ? detail : JSON.stringify(detail))
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
  return { status: response.status, body }
}

function json(token: string, method: string, payload: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  } satisfies RequestInit
}

function tokenFor(user: { id: string; email: string; roles: string[] }, tenantId: string, atiId: string) {
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

function csvUpload(csv: string, options: { autoCreateUnits: boolean; dryRun: boolean }) {
  const form = new FormData()
  form.append('file', new Blob([csv]), 'roster.csv')
  form.append('autoCreateUnits', String(options.autoCreateUnits))
  form.append('dryRun', String(options.dryRun))
  return form
}

async function purgeTenant(tenantId: string) {
  const userIds = (await prisma.user.findMany({ where: { tenantId }, select: { id: true } })).map((u) => u.id)
  await prisma.notification.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.callAssignment.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.facultyImportJob.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.referenceLibrary.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.researcherSavedResearchArea.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.researcherNotificationPreference.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.researcherProfile.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.project.deleteMany({ where: { tenantId } })
  // Something in the request path provisions a TenantPlan on demand; it holds a
  // restrict-style FK, so it has to go before the tenant.
  await prisma.tenantPlan.deleteMany({ where: { tenantId } })
  await prisma.usageLog.deleteMany({ where: { tenantId } })
  await prisma.user.deleteMany({ where: { tenantId } })
  await prisma.tenantOrgUnit.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.fundingCall.deleteMany({ where: { tenantId } })
  await prisma.tenant.delete({ where: { id: tenantId } })
}

async function sweepLeftovers() {
  const stale = await prisma.tenant.findMany({
    where: { atiId: { startsWith: 'ATI-e2e-life-' } },
    select: { id: true },
  })
  for (const { id } of stale) {
    try {
      await purgeTenant(id)
    } catch (err) {
      console.warn('  (could not sweep leftover tenant)', err instanceof Error ? err.message : err)
    }
  }
  if (stale.length > 0) console.log(`Swept ${stale.length} leftover tenant(s)`)
}

async function main() {
  console.log(`Full lifecycle verification against ${BASE_URL} (marker ${MARKER})`)
  await sweepLeftovers()

  let tenantId: string | null = null

  try {
    // ================= 1. TENANT CREATION =================================
    section('1. Tenant creation')
    const tenant = await prisma.tenant.create({
      data: { name: `E2E Lifecycle ${STAMP}`, atiId: `ATI-${MARKER}`, type: 'ENTERPRISE', status: 'ACTIVE' },
    })
    tenantId = tenant.id
    check('tenant created ACTIVE', tenant.status === 'ACTIVE')
    check('org scope enforcement defaults off (back-compat)', tenant.org_scope_enforced === false, tenant.org_scope_enforced)

    const admin = await prisma.user.create({
      data: {
        email: `admin-${MARKER}@verify.local`,
        name: 'Lifecycle Admin',
        tenantId: tenant.id,
        roles: ['ADMIN'],
        status: 'ACTIVE',
        emailVerified: true,
      },
    })
    const adminToken = tokenFor(admin, tenant.id, tenant.atiId)

    // A plain MANAGER, to probe the delegation boundary later.
    const manager = await prisma.user.create({
      data: {
        email: `manager-${MARKER}@verify.local`,
        name: 'Lifecycle Manager',
        tenantId: tenant.id,
        roles: ['MANAGER'],
        status: 'ACTIVE',
        emailVerified: true,
      },
    })
    const managerToken = tokenFor(manager, tenant.id, tenant.atiId)

    // ================= 2. ORG STRUCTURE ===================================
    section('2. Org structure (deep hierarchy)')
    const school = await api(adminToken, '/api/tenant-admin/org-units', json(adminToken, 'POST', {
      kind: 'SCHOOL',
      name: 'School of Engineering',
    }))
    check('creates a top-level unit', school.status === 201, school.body)
    const schoolId = school.body?.unit?.id

    const dept = await api(adminToken, '/api/tenant-admin/org-units', json(adminToken, 'POST', {
      kind: 'DEPARTMENT',
      name: 'Department of Civil Engineering',
      parentId: schoolId,
    }))
    check('creates a second-level unit', dept.status === 201, dept.body)
    const deptId = dept.body?.unit?.id

    const third = await api(adminToken, '/api/tenant-admin/org-units', json(adminToken, 'POST', {
      name: 'Structures Research Centre',
      parentId: deptId,
      levelLabel: 'Research Centre',
    }))
    check('creates a third level through the API', third.status === 201, third.body)
    const centreId = third.body?.unit?.id
    check('third level reports depth 2 and a 3-id path',
      third.body?.unit?.depth === 2 && (third.body?.unit?.path || []).length === 3, third.body?.unit)
    check('per-unit level label is honoured', third.body?.unit?.levelLabel === 'Research Centre', third.body?.unit)

    const fourth = await api(adminToken, '/api/tenant-admin/org-units', json(adminToken, 'POST', {
      name: 'Seismic Lab',
      parentId: centreId,
    }))
    check('creates a fourth level', fourth.status === 201, fourth.body)

    const subtree = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tenant_org_units WHERE tenant_id = ${tenant.id} AND path && ARRAY[${schoolId}]::text[]
    `
    check('subtree query returns the whole branch', subtree.length === 4, subtree.length)

    const tree = await api(adminToken, '/api/tenant-admin/org-units')
    check('GET returns a flat depth-aware unit list', (tree.body?.units || []).length === 4, tree.body?.units?.length)
    const nested = tree.body?.tree || []
    const depth3 = nested[0]?.children?.[0]?.children?.[0]?.children?.[0]
    check('GET nests all four levels', depth3?.name === 'Seismic Lab', nested)
    check('roll-up counts exist on the root', typeof nested[0]?.rollupFacultyCount === 'number', nested[0])
    check('legacy two-level shape still emitted for old clients',
      (tree.body?.schools || []).length === 1 && (tree.body?.schools?.[0]?.departments || []).length === 1,
      tree.body?.schools)

    // Re-parent the centre to the school and confirm descendants follow.
    const moved = await api(adminToken, `/api/tenant-admin/org-units/${centreId}`, json(adminToken, 'PATCH', {
      parentId: schoolId,
    }))
    check('a unit can be re-parented', moved.status === 200, moved.body)
    const labAfterMove = await prisma.tenantOrgUnit.findFirstOrThrow({
      where: { tenant_id: tenant.id, name: 'Seismic Lab' },
      select: { depth: true, path: true },
    })
    check('descendants follow the move', labAfterMove.depth === 2 && labAfterMove.path[0] === schoolId, labAfterMove)

    const cycle = await api(adminToken, `/api/tenant-admin/org-units/${schoolId}`, json(adminToken, 'PATCH', {
      parentId: centreId,
    }))
    check('moving a unit beneath itself is rejected', cycle.status === 400, cycle.body)

    // Put it back so later stages see the intended shape.
    await api(adminToken, `/api/tenant-admin/org-units/${centreId}`, json(adminToken, 'PATCH', { parentId: deptId }))
    const centre = { id: centreId as string }

    // ================= 3. MANPOWER IMPORT =================================
    section('3. Manpower (faculty) import')
    const roster = [
      'Name,Email,Employee ID,School,Department,Designation,Research Areas,Keywords,Research Summary',
      `Asha Verma,asha-${MARKER}@verify.local,10428,School of Engineering,Department of Civil Engineering,Professor,structural health monitoring; earthquake engineering,seismic retrofitting; bridge monitoring,Develops sensor networks and machine learning models for structural health monitoring of bridges and detection of seismic damage in reinforced concrete.`,
      `Rahul Nair,rahul-${MARKER}@verify.local,10429,School of Engineering,Department of Civil Engineering,Assistant Professor,geotechnical engineering,soil mechanics; foundations,Researches soil-structure interaction and deep foundation behaviour under cyclic loading.`,
      `Dup Employee,dup-${MARKER}@verify.local,10428,School of Engineering,Department of Civil Engineering,Lecturer,materials,concrete,Duplicate employee id row.`,
    ].join('\n')

    const preview = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: csvUpload(roster, { autoCreateUnits: true, dryRun: true }),
    })
    check('dry run previews 2 creatable rows', preview.body?.created === 2, preview.body)
    check('dry run rejects the duplicate employee ID', preview.body?.errors === 1, preview.body?.results)

    const imported = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: csvUpload(roster, { autoCreateUnits: true, dryRun: false }),
    })
    check('import creates 2 faculty', imported.body?.created === 2, imported.body)

    const asha = await prisma.researcherProfile.findFirst({
      where: { user: { email: `asha-${MARKER}@verify.local` } },
      select: {
        user_id: true, employee_id: true, school: true, department: true, org_unit_id: true,
        research_areas: true, keywords: true, research_summary: true, normalized_text: true,
        content_hash: true, embedding_version: true,
      },
    })
    check('employee ID persisted', asha?.employee_id === '10428', asha?.employee_id)
    check('placed in the right school/department', asha?.school === 'School of Engineering' && asha?.department === 'Department of Civil Engineering', asha)
    check('linked to an org unit', asha?.org_unit_id === deptId, { got: asha?.org_unit_id, want: deptId })
    check('research areas split into an array', (asha?.research_areas.length || 0) === 2, asha?.research_areas)
    check('research summary stored', Boolean(asha?.research_summary), asha?.research_summary)

    // Deep placement through the importer's Unit Path column.
    const deepRoster = [
      'Name,Email,Unit Path,Designation,Research Areas',
      `Deep Placed,deep-${MARKER}@verify.local,School of Engineering > Department of Civil Engineering > Structures Research Centre > Seismic Lab,Reader,earthquake engineering`,
    ].join('\n')
    const deepImport = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: csvUpload(deepRoster, { autoCreateUnits: true, dryRun: false }),
    })
    check('importer accepts a Unit Path', deepImport.body?.created === 1, deepImport.body)
    const deepProfile = await prisma.researcherProfile.findFirst({
      where: { user: { email: `deep-${MARKER}@verify.local` } },
      select: { org_unit_id: true, school: true, department: true },
    })
    const seismicLab = await prisma.tenantOrgUnit.findFirstOrThrow({
      where: { tenant_id: tenant.id, name: 'Seismic Lab' },
      select: { id: true, depth: true },
    })
    check('Unit Path places the person at the deepest level',
      deepProfile?.org_unit_id === seismicLab.id && seismicLab.depth === 3, { deepProfile, seismicLab })
    check('deep placement still fills school (root) and department (own unit)',
      deepProfile?.school === 'School of Engineering' && deepProfile?.department === 'Seismic Lab', deepProfile)

    // ================= 4. PROFILE EMBEDDING ===============================
    section('4. Profile embedding (matching readiness)')
    check('normalized text built for embedding', Boolean(asha?.normalized_text), asha?.normalized_text?.slice(0, 80))
    const embedded = await prisma.$queryRaw<Array<{ has: boolean }>>`
      SELECT (embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL) AS has
      FROM researcher_profiles WHERE user_id = ${asha?.user_id || ''}
    `
    check('profile vector generated inline at import', embedded[0]?.has === true, {
      embeddingVersion: asha?.embedding_version,
      hint: 'needs VOYAGE_API_KEY / provider reachable',
    })

    // 2 from the flat roster + 1 placed via Unit Path.
    const facultyList = await api(adminToken, '/api/tenant-admin/faculty')
    check('roster lists imported faculty', facultyList.body?.total === 3, facultyList.body?.total)
    check('roster reports them as searchable', facultyList.body?.embedded === 3, facultyList.body?.embedded)
    const ashaRow = (facultyList.body?.faculty || []).find((r: any) => r.email === `asha-${MARKER}@verify.local`)
    check('roster surfaces the employee ID', ashaRow?.employeeId === '10428', ashaRow)
    const byEmployeeId = await api(adminToken, '/api/tenant-admin/faculty?q=10428')
    check('roster is searchable by employee ID', byEmployeeId.body?.total === 1, byEmployeeId.body?.total)

    // ================= 5. RESEARCH AREAS ==================================
    section('5. Saved research areas (alerts + finder)')
    const ashaUser = await prisma.user.findUniqueOrThrow({
      where: { email: `asha-${MARKER}@verify.local` },
      select: { id: true, email: true, roles: true },
    })
    const ashaToken = tokenFor(ashaUser, tenant.id, tenant.atiId)

    const savedArea = await api(ashaToken, '/api/researcher/research-areas', json(ashaToken, 'POST', {
      label: 'Structural health monitoring',
      researchArea: 'Sensor networks and machine learning for structural health monitoring of bridges',
      keywords: ['structural health monitoring', 'bridge sensors', 'damage detection'],
      disciplines: ['Civil Engineering'],
      isDefault: true,
      useForAlerts: true,
    }))
    check('faculty can save a research area', savedArea.status === 200 || savedArea.status === 201, savedArea.body)

    const areaRow = await prisma.researcherSavedResearchArea.findFirst({
      where: { user_id: ashaUser.id },
      select: { id: true, label: true, use_for_alerts: true, normalized_text: true, embedding_version: true },
    })
    check('research area persisted with alert flag', areaRow?.use_for_alerts === true, areaRow)
    const areaEmbedded = await prisma.$queryRaw<Array<{ has: boolean }>>`
      SELECT (embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL) AS has
      FROM researcher_saved_research_areas WHERE id = ${areaRow?.id || ''}
    `
    check('research area vector generated', areaEmbedded[0]?.has === true, areaRow?.embedding_version)

    // ================= 6. PUBLICATIONS ====================================
    section('6. Publication import')
    const pub = await api(ashaToken, '/api/researcher/funding-publications', json(ashaToken, 'POST', {
      title: 'Deep learning for vibration-based damage detection in reinforced concrete bridges',
      abstract:
        'We present a convolutional architecture that detects and localizes damage in reinforced concrete bridge decks from ambient vibration data, validated on three instrumented highway bridges over two years of monitoring.',
      year: 2025,
      venue: 'Structural Health Monitoring',
      doi: `10.1000/e2e.${STAMP}`,
    }))
    check('faculty can add a funding publication', pub.status === 200 || pub.status === 201, pub.body)

    const pubRow = await prisma.referenceLibrary.findFirst({
      where: { userId: ashaUser.id },
      select: { id: true, title: true, tags: true, fundingMatchText: true, fundingMatchHash: true, isActive: true },
    })
    check('publication stored in the reference library', Boolean(pubRow), pubRow)
    check('publication tagged for funding matching', (pubRow?.tags || []).includes('my-publication'), pubRow?.tags)
    check('funding match text built', Boolean(pubRow?.fundingMatchText), pubRow?.fundingMatchText?.slice(0, 60))
    const pubEmbedded = await prisma.$queryRaw<Array<{ has: boolean }>>`
      SELECT (funding_embedding IS NOT NULL OR funding_embedding_voyage_1024 IS NOT NULL) AS has
      FROM reference_library WHERE id = ${pubRow?.id || ''}
    `
    check('publication vector generated', pubEmbedded[0]?.has === true, 'funding_embedding')

    const pubList = await api(ashaToken, '/api/researcher/funding-publications')
    check('publications read back with the 5-publication cap', pubList.body?.max === 5 && (pubList.body?.publications || []).length === 1, pubList.body)

    // ================= 7. FUNDING CALL ====================================
    section('7. Funding call')
    const call = await prisma.fundingCall.create({
      data: {
        tenantId: tenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'PUBLISHED',
        title: `Resilient Infrastructure Monitoring Grant ${STAMP}`,
        agencyName: 'E2E Infrastructure Council',
        agency_name: 'E2E Infrastructure Council',
        scheme_title: `Resilient Infrastructure Monitoring Grant ${STAMP}`,
        description:
          'Supports sensor networks, machine learning and structural health monitoring for bridges and seismic resilience of civil infrastructure.',
        disciplines: ['structural health monitoring', 'civil engineering'],
        deadlineAt: new Date(Date.now() + 45 * 86400000),
        createdByUserId: admin.id,
        updatedByUserId: admin.id,
      } as any,
      select: { id: true, title: true },
    })
    check('tenant funding call published', Boolean(call.id))

    // ================= 8. RESEARCHER MATCHING =============================
    section('8. Researcher matching')
    const facets = await api(adminToken, '/api/researcher-matching?action=facets')
    check('facets expose the org tree', (facets.body?.schools?.length || 0) >= 1, facets.body?.schools)

    const match = await api(adminToken, '/api/researcher-matching', json(adminToken, 'POST', {
      fundingCallId: call.id,
      limit: 10,
    }))
    check('matching returns candidates', (match.body?.results?.length || 0) > 0, {
      status: match.status,
      error: match.body?.error,
      count: match.body?.results?.length,
    })
    // Results are keyed by userId/displayName — there is no email on a match row.
    const matchedAsha = (match.body?.results || []).find((r: any) => r.userId === ashaUser.id)
    check('the relevant researcher is matched to the call', Boolean(matchedAsha), (match.body?.results || []).map((r: any) => r.displayName))
    check('match carries a score for assignment provenance', typeof matchedAsha?.score === 'number', matchedAsha)
    check('match is tiered for the UI', typeof matchedAsha?.matchTier === 'string', matchedAsha?.matchTier)

    const scopedMatch = await api(adminToken, '/api/researcher-matching', json(adminToken, 'POST', {
      fundingCallId: call.id,
      filters: { orgUnitIds: [deptId] },
      limit: 10,
    }))
    check('org-unit filter narrows matching', (scopedMatch.body?.results || []).length > 0, scopedMatch.body?.results?.length)

    // ================= 9. ASSIGNMENT ======================================
    section('9. Call assignment')
    const assigned = await api(adminToken, '/api/assignments', json(adminToken, 'POST', {
      fundingCallId: call.id,
      assigneeUserId: ashaUser.id,
      deadlineAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      message: 'Please lead this proposal for the department.',
      matchScore: matchedAsha?.score ?? null,
      matchTier: matchedAsha?.matchTier ?? null,
    }))
    check('admin can assign the matched call', assigned.status === 201, assigned.body)
    const assignmentId = assigned.body?.assignment?.id
    check('assignment stores deadline and message',
      Boolean(assigned.body?.assignment?.deadlineAt) && Boolean(assigned.body?.assignment?.message), assigned.body?.assignment)

    const snapshot = await prisma.callAssignment.findUnique({
      where: { id: assignmentId },
      select: { assignee_org_unit_id: true, assigner_org_unit_id: true, match_score: true },
    })
    check('match provenance snapshotted', snapshot?.match_score !== null, snapshot)
    check('assignee org unit stamped at assignment time', snapshot?.assignee_org_unit_id === deptId, snapshot)

    const rahulId = (await prisma.user.findUniqueOrThrow({
      where: { email: `rahul-${MARKER}@verify.local` },
      select: { id: true },
    })).id

    // Back-compat: a MANAGER with no head grant keeps today's tenant-wide reach
    // until the tenant opts into lockdown.
    const managerAssign = await api(managerToken, '/api/assignments', json(managerToken, 'POST', {
      fundingCallId: call.id,
      assigneeUserId: rahulId,
      message: 'Legacy tenant-wide assigner probe.',
    }))
    check('an ungranted MANAGER keeps legacy tenant-wide reach', managerAssign.status === 201, managerAssign.body)
    await prisma.callAssignment.deleteMany({ where: { assignee_user_id: rahulId } })

    // ---- The delegation boundary this feature exists to create --------------
    section('9b. Delegated headship')
    const hodUser = await prisma.user.create({
      data: {
        email: `hod-${MARKER}@verify.local`,
        name: 'Civil HoD',
        tenantId: tenant.id,
        roles: ['MEMBER'],
        status: 'ACTIVE',
        emailVerified: true,
      },
      select: { id: true, email: true, roles: true },
    })
    const hodToken = tokenFor(hodUser, tenant.id, tenant.atiId)

    const beforeGrant = await api(hodToken, '/api/assignments', json(hodToken, 'POST', {
      fundingCallId: call.id,
      assigneeUserId: rahulId,
      message: 'Should fail before headship.',
    }))
    check('a plain member cannot assign', beforeGrant.status === 403, beforeGrant.body)

    const grant = await api(adminToken, `/api/tenant-admin/org-units/${deptId}/managers`, json(adminToken, 'POST', {
      userId: hodUser.id,
      scope: 'SUBTREE',
      title: 'Head of Department',
    }))
    check('admin can name a head of a unit', grant.status === 201, grant.body)

    const hodAssign = await api(hodToken, '/api/assignments', json(hodToken, 'POST', {
      fundingCallId: call.id,
      assigneeUserId: rahulId,
      message: 'Please prepare this proposal.',
    }))
    check('the head can now assign inside their own department', hodAssign.status === 201, hodAssign.body)
    const hodAssignmentId = hodAssign.body?.assignment?.id

    // Someone outside the head's branch.
    const outsider = await prisma.user.create({
      data: {
        email: `outsider-${MARKER}@verify.local`,
        name: 'Other School Faculty',
        tenantId: tenant.id,
        roles: ['MEMBER'],
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    const otherSchool = await api(adminToken, '/api/tenant-admin/org-units', json(adminToken, 'POST', {
      name: 'School of Management',
    }))
    await prisma.researcherProfile.create({
      data: {
        user_id: outsider.id,
        display_name: 'Other School Faculty',
        org_unit_id: otherSchool.body?.unit?.id,
        school: 'School of Management',
      },
    })
    const crossUnit = await api(hodToken, '/api/assignments', json(hodToken, 'POST', {
      fundingCallId: call.id,
      assigneeUserId: outsider.id,
      message: 'Should be blocked.',
    }))
    check('the head is blocked from assigning outside their branch', crossUnit.status === 403, crossUnit.body)
    check('the block explains why', String(crossUnit.body?.error || '').includes('not in a department you manage'), crossUnit.body)

    // Reach inherits downward: a head of the department covers the centre below it.
    await prisma.researcherProfile.update({
      where: { user_id: rahulId },
      data: { org_unit_id: centre.id },
    })
    const inherited = await api(hodToken, `/api/assignments/${hodAssignmentId}`)
    check('headship reaches assignments in units beneath the granted one', inherited.status === 200, inherited.body)

    // Both tracking directions.
    const assignedByMe = await api(hodToken, '/api/assignments?view=assigned-by-me')
    check('head can list what they assigned',
      (assignedByMe.body?.assignments || []).some((a: any) => a.id === hodAssignmentId), assignedByMe.body)
    const teamView = await api(hodToken, '/api/assignments?view=team')
    const teamIds = (teamView.body?.assignments || []).map((a: any) => a.id)
    check('head sees their own delegation in the team view', teamIds.includes(hodAssignmentId), teamIds)
    check('head sees the admin-created assignment in their branch', teamIds.includes(assignmentId), teamIds)
    check('team view is paged', typeof teamView.body?.total === 'number', teamView.body?.total)

    // A head of a different branch sees none of it.
    const otherHead = await prisma.user.create({
      data: {
        email: `otherhead-${MARKER}@verify.local`,
        name: 'Management Dean',
        tenantId: tenant.id,
        roles: ['MEMBER'],
        status: 'ACTIVE',
      },
      select: { id: true, email: true, roles: true },
    })
    await api(adminToken, `/api/tenant-admin/org-units/${otherSchool.body?.unit?.id}/managers`, json(adminToken, 'POST', {
      userId: otherHead.id,
      scope: 'SUBTREE',
      title: 'Dean',
    }))
    const otherHeadToken = tokenFor(otherHead, tenant.id, tenant.atiId)
    const otherTeam = await api(otherHeadToken, '/api/assignments?view=team')
    check('a head of another branch sees none of these assignments',
      (otherTeam.body?.assignments || []).length === 0, otherTeam.body?.assignments)
    const otherDetail = await api(otherHeadToken, `/api/assignments/${hodAssignmentId}`)
    check('a head of another branch cannot open the assignment', otherDetail.status === 404, otherDetail.body)

    // ================= 10. SUBMISSION + OUTCOME ===========================
    section('10. Submission and outcome tracking')
    const progressed = await api(ashaToken, `/api/assignments/${assignmentId}`, json(ashaToken, 'PATCH', { status: 'IN_PROGRESS' }))
    check('assignee can mark it in progress', progressed.body?.assignment?.status === 'IN_PROGRESS', progressed.body)

    const completed = await api(ashaToken, `/api/assignments/${assignmentId}`, json(ashaToken, 'PATCH', {
      status: 'COMPLETED',
      submissionReference: `IC/2026/${STAMP}`,
      submissionUrl: 'portal.example.edu/apply/882',
      submissionNotes: 'Submitted with three co-investigators.',
    }))
    check('assignee can record the submission', completed.body?.assignment?.status === 'COMPLETED', completed.body)
    check('submission is timestamped', Boolean(completed.body?.assignment?.completedAt), completed.body?.assignment)

    const outcome = await api(adminToken, `/api/assignments/${assignmentId}`, json(adminToken, 'PATCH', {
      outcome: 'AWARDED',
      awardAmount: 4500000,
      awardCurrency: 'INR',
    }))
    check('admin can record the funding outcome', outcome.body?.assignment?.outcome === 'AWARDED', outcome.body)
    check('award amount recorded', outcome.body?.assignment?.awardAmount === 4500000, outcome.body?.assignment)
    check('decision is timestamped', Boolean(outcome.body?.assignment?.decisionAt), outcome.body?.assignment)

    const assigneeCannotAward = await api(ashaToken, `/api/assignments/${assignmentId}`, json(ashaToken, 'PATCH', {
      outcome: 'REJECTED',
    }))
    check('assignee cannot rewrite the outcome', assigneeCannotAward.status === 403, assigneeCannotAward.body)

    // ================= 11. DASHBOARD ======================================
    section('11. Grant dashboard')
    const dash = await api(adminToken, '/api/tenant-admin/grant-dashboard')
    check('dashboard loads', dash.status === 200, dash.body?.error)
    check('dashboard counts the submission', dash.body?.summary?.submitted === 1, dash.body?.summary)
    check('dashboard counts the award', dash.body?.summary?.awarded === 1, dash.body?.summary)
    check('dashboard sums awarded funding', dash.body?.summary?.awardedAmount === 4500000, dash.body?.summary)
    check('dashboard computes a success rate', dash.body?.summary?.successRate === 100, dash.body?.summary)
    const allocRow = (dash.body?.allocation || []).find((r: any) => r.facultyUserId === ashaUser.id)
    check('allocation attributes it to the right faculty', Boolean(allocRow), dash.body?.allocation)
    check('allocation carries school/department labels',
      allocRow?.school === 'School of Engineering' && allocRow?.department === 'Department of Civil Engineering', allocRow)

    const report = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=department')
    check('report groups by department', (report.body?.rows || []).length > 0, report.body)
    const byAssigner = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=assigner')
    check('report groups by who assigned the call',
      byAssigner.status === 200 && (byAssigner.body?.rows || []).length > 0, byAssigner.body)
    const assignerLabels = (byAssigner.body?.rows || []).map((r: any) => r.label)
    check('assigner grouping names the admin who delegated',
      assignerLabels.includes('Lifecycle Admin'), assignerLabels)
    const byAssignerUnit = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=assignerUnit')
    check('report groups by the assigner’s unit', byAssignerUnit.status === 200, byAssignerUnit.body)
    const byOrgUnit = await api(adminToken, '/api/tenant-admin/grant-dashboard/report?groupBy=orgUnit')
    check('report groups by org unit at any depth', byOrgUnit.status === 200 && (byOrgUnit.body?.rows || []).length > 0, byOrgUnit.body)

    // A scoped head sees only their own branch's numbers.
    const hodDash = await api(hodToken, '/api/tenant-admin/grant-dashboard')
    check('a head can open the dashboard', hodDash.status === 200, hodDash.body)
    check('head dashboard is scoped, not tenant-wide', hodDash.body?.scope?.isTenantWide === false, hodDash.body?.scope)
    const otherHeadDash = await api(otherHeadToken, '/api/tenant-admin/grant-dashboard')
    check('a head of another branch sees none of these assignments in totals',
      otherHeadDash.body?.summary?.total === 0, otherHeadDash.body?.summary)

    // A hand-crafted out-of-scope filter must not widen reach.
    const forgedFilter = await api(otherHeadToken, `/api/tenant-admin/grant-dashboard?orgUnitIds=${deptId}`)
    check('out-of-scope orgUnitIds cannot widen a head’s dashboard',
      forgedFilter.body?.summary?.total === 0, forgedFilter.body?.summary)

    const managerDash = await api(managerToken, '/api/tenant-admin/grant-dashboard')
    check('an ungranted MANAGER keeps the tenant-wide view (back-compat)',
      managerDash.status === 200 && managerDash.body?.scope?.isTenantWide === true,
      { status: managerDash.status, scope: managerDash.body?.scope })

    // ================= 12. NOTIFICATIONS ==================================
    section('12. Notifications')
    const inbox = await api(ashaToken, '/api/notifications')
    const assignmentNote = (inbox.body?.notifications || []).find((n: any) => n.assignmentId === assignmentId)
    check('assignee was notified of the assignment', Boolean(assignmentNote), inbox.body?.notifications)
    const outcomeNote = (inbox.body?.notifications || []).some((n: any) => (n.category || '') === 'OUTCOME')
    check('assignee was notified of the outcome', outcomeNote, inbox.body?.notifications?.map((n: any) => n.category))

    const broadcast = await api(adminToken, '/api/notifications', json(adminToken, 'POST', {
      orgUnitIds: [schoolId],
      title: 'Quarterly grant briefing',
      body: 'All engineering faculty please review the new infrastructure calls.',
    }))
    check('admin can broadcast to a school', broadcast.status === 201, broadcast.body)
    // Everyone under the school, at every depth: 2 in the department + 1 in the
    // depth-3 lab beneath it.
    check('broadcast reaches the whole school subtree', broadcast.body?.sent === 3, broadcast.body)

    // Asha and Rahul now sit in the depth-2 centre; a school-level broadcast
    // must still reach them.
    await prisma.researcherProfile.update({
      where: { user_id: ashaUser.id },
      data: { org_unit_id: centre.id },
    })
    const deepBroadcast = await api(adminToken, '/api/notifications', json(adminToken, 'POST', {
      orgUnitIds: [schoolId],
      title: 'Deep unit reach probe',
      body: 'A school-level broadcast must reach a depth-2 centre.',
    }))
    check('school broadcast reaches faculty in depth-2 units', deepBroadcast.body?.sent === 3, deepBroadcast.body)

    // Selecting the unit someone is attached to directly must include them —
    // the old one-level expansion dropped exactly this case.
    const directBroadcast = await api(adminToken, '/api/notifications', json(adminToken, 'POST', {
      orgUnitIds: [centre.id],
      title: 'Direct unit probe',
      body: 'Members attached to the selected unit itself must be included.',
    }))
    check('broadcast includes members of the selected unit itself',
      (directBroadcast.body?.sent || 0) >= 1, directBroadcast.body)

    const headBroadcast = await api(hodToken, '/api/notifications', json(hodToken, 'POST', {
      allTenantUsers: true,
      title: 'Should be blocked',
      body: 'A head must not be able to message the whole organization.',
    }))
    check('a head cannot broadcast to the whole tenant', headBroadcast.status === 403, headBroadcast.body)
  } finally {
    if (tenantId && !KEEP) {
      await purgeTenant(tenantId)
      console.log('\nThrowaway tenant removed.')
    } else if (tenantId) {
      console.log(`\nKept tenant ${tenantId} (--keep)`)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${gaps} known gaps`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error('Verification crashed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
