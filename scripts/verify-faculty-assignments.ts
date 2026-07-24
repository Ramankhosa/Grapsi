/**
 * End-to-end verification for the faculty org structure, roster import,
 * researcher-matching filters and funding call assignment flow.
 *
 * Drives the real HTTP API on a running dev server with a minted access token,
 * so routing, auth, validation and DB writes are all exercised. Creates an
 * isolated throwaway tenant and removes it again at the end.
 *
 *   npx tsx scripts/verify-faculty-assignments.ts [baseUrl]
 */

import AdmZip from 'adm-zip'
import { prisma } from '../src/lib/prisma'
import { generateJWT } from '../src/lib/auth'

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const BASE_URL = positional[0] || 'http://localhost:3011'
/** Leave the fixtures in place (and print tokens) so the UI can be inspected. */
const KEEP = process.argv.includes('--keep')
const STAMP = Date.now()
const MARKER = `e2e-fa-${STAMP}`

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
  return { status: response.status, body }
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

/** Builds a minimal but structurally real .xlsx (ZIP of XML parts). */
function buildXlsx(rows: string[][]) {
  const shared: string[] = []
  const indexOf = (value: string) => {
    const existing = shared.indexOf(value)
    if (existing >= 0) return existing
    shared.push(value)
    return shared.length - 1
  }
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const sheetRows = rows
    .map((cells, rowIndex) => {
      const cellXml = cells
        .map((value, columnIndex) => {
          const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`
          return `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cellXml}</row>`
    })
    .join('')

  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
    )
  )
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    )
  )
  zip.addFile(
    'xl/workbook.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Roster" sheetId="1" r:id="rId1"/></sheets></workbook>`
    )
  )
  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
    )
  )
  zip.addFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    )
  )
  zip.addFile(
    'xl/sharedStrings.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((value) => `<si><t>${escape(value)}</t></si>`)
        .join('')}</sst>`
    )
  )
  return zip.toBuffer()
}

function uploadForm(buffer: Buffer, filename: string, options: { autoCreateUnits: boolean; dryRun: boolean }) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)]), filename)
  form.append('autoCreateUnits', String(options.autoCreateUnits))
  form.append('dryRun', String(options.dryRun))
  return form
}

/** Removes fixtures left behind by an interrupted earlier run. */
async function sweepLeftovers() {
  const stale = await prisma.tenant.findMany({
    where: { atiId: { startsWith: 'ATI-e2e-fa-' } },
    select: { id: true },
  })
  for (const { id } of stale) {
    await purgeTenant(id)
  }
  if (stale.length > 0) {
    console.log(`Swept ${stale.length} leftover tenant(s) from a previous run`)
  }
}

async function purgeTenant(tenantId: string) {
  const userIds = (await prisma.user.findMany({ where: { tenantId }, select: { id: true } })).map(u => u.id)
  await prisma.callAssignment.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.facultyImportJob.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.researcherProfile.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.user.deleteMany({ where: { tenantId } })
  await prisma.tenantOrgUnit.deleteMany({ where: { tenant_id: tenantId } })
  await prisma.fundingCall.deleteMany({ where: { tenantId } })
  await prisma.tenant.delete({ where: { id: tenantId } })
}

async function main() {
  console.log(`Verifying against ${BASE_URL} (marker ${MARKER})`)
  await sweepLeftovers()

  let tenantId: string | null = null

  try {
    // --- Fixtures -----------------------------------------------------------
    const tenant = await prisma.tenant.create({
      data: { name: `E2E Faculty ${STAMP}`, atiId: `ATI-${MARKER}`, type: 'ENTERPRISE', status: 'ACTIVE' },
    })
    tenantId = tenant.id

    const admin = await prisma.user.create({
      data: {
        email: `admin-${MARKER}@verify.local`,
        name: 'E2E Admin',
        tenantId: tenant.id,
        roles: ['ADMIN'],
        status: 'ACTIVE',
      },
    })
    const call = await prisma.fundingCall.create({
      data: {
        tenantId: tenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'PUBLISHED',
        title: `AI for Healthcare Grant ${STAMP}`,
        agencyName: 'E2E Science Council',
        description: 'Funding for machine learning and computer vision applied to medical imaging.',
        disciplines: ['machine learning', 'medical imaging'],
        createdByUserId: admin.id,
        updatedByUserId: admin.id,
      } as any,
    })

    const adminToken = tokenFor(admin, tenant.id, tenant.atiId)

    // --- Org structure ------------------------------------------------------
    section('Org structure')
    const createSchool = await api(adminToken, '/api/tenant-admin/org-units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'SCHOOL', name: 'School of Computer Science' }),
    })
    check('creates a school', createSchool.status === 201, createSchool.body)
    const schoolId = createSchool.body?.unit?.id

    const duplicate = await api(adminToken, '/api/tenant-admin/org-units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'SCHOOL', name: 'school of computer science' }),
    })
    check('rejects a duplicate school name case-insensitively', duplicate.status === 409, duplicate.body)

    const orphanDept = await api(adminToken, '/api/tenant-admin/org-units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'DEPARTMENT', name: 'Orphan' }),
    })
    check('rejects a department without a school', orphanDept.status === 400, orphanDept.body)

    // --- Roster import (CSV) ------------------------------------------------
    section('CSV roster import')
    const csv = [
      'Name,Email,School,Department,Designation,Research Areas,Keywords,Research Summary',
      `Asha Verma,asha-${MARKER}@verify.local,School of Computer Science,Department of Artificial Intelligence,Associate Professor,"machine learning; computer vision","deep learning; medical imaging",Builds vision models for clinical imaging and diagnosis.`,
      `Ravi Nair,ravi-${MARKER}@verify.local,School of Computer Science,Department of Data Science,Professor,"data mining; statistics","big data",Studies large scale data mining over civic datasets.`,
      ',bad-email,School of Computer Science,Department of Artificial Intelligence,,,,',
    ].join('\n')

    const preview = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: uploadForm(Buffer.from(csv, 'utf8'), 'roster.csv', { autoCreateUnits: true, dryRun: true }),
    })
    check('dry run reports 2 creatable rows', preview.body?.created === 2, preview.body)
    check('dry run flags the invalid row', preview.body?.errors === 1, preview.body?.results)
    const unitsAfterPreview = await prisma.tenantOrgUnit.count({ where: { tenant_id: tenant.id } })
    check('dry run writes nothing', unitsAfterPreview === 1, `org units = ${unitsAfterPreview}`)

    const imported = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: uploadForm(Buffer.from(csv, 'utf8'), 'roster.csv', { autoCreateUnits: true, dryRun: false }),
    })
    check('import creates 2 faculty', imported.body?.created === 2, imported.body)
    check('import auto-creates the 2 departments', imported.body?.unitsCreated?.length === 2, imported.body?.unitsCreated)

    const rerun = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: uploadForm(Buffer.from(csv, 'utf8'), 'roster.csv', { autoCreateUnits: true, dryRun: false }),
    })
    check('re-importing updates rather than duplicating', rerun.body?.updated === 2 && rerun.body?.created === 0, rerun.body)

    const strict = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: uploadForm(
        Buffer.from(
          `Name,Email,School,Department\nNew Person,new-${MARKER}@verify.local,School of Nowhere,Department of Nothing`,
          'utf8'
        ),
        'roster.csv',
        { autoCreateUnits: false, dryRun: false }
      ),
    })
    check('rejects unknown units when auto-create is off', strict.body?.errors === 1, strict.body?.results)

    // --- Roster import (XLSX) ----------------------------------------------
    section('XLSX roster import')
    const xlsx = buildXlsx([
      ['Name', 'Email', 'School', 'Department', 'Designation', 'Research Areas'],
      [
        'Meera Iyer',
        `meera-${MARKER}@verify.local`,
        'School of Life Sciences',
        'Department of Genomics',
        'Assistant Professor',
        'genomics; bioinformatics',
      ],
    ])
    const xlsxImport = await api(adminToken, '/api/tenant-admin/faculty/import', {
      method: 'POST',
      body: uploadForm(xlsx, 'roster.xlsx', { autoCreateUnits: true, dryRun: false }),
    })
    check('parses a real .xlsx and imports it', xlsxImport.body?.created === 1, xlsxImport.body)

    const meera = await prisma.researcherProfile.findFirst({
      where: { user: { email: `meera-${MARKER}@verify.local` } },
      select: { school: true, department: true, designation: true, research_areas: true, org_unit_id: true },
    })
    check('xlsx row lands in the right school/department', meera?.school === 'School of Life Sciences' && meera?.department === 'Department of Genomics', meera)
    check('xlsx row keeps designation and split research areas', meera?.designation === 'Assistant Professor' && meera?.research_areas.length === 2, meera)
    check('xlsx row is linked to an org unit', Boolean(meera?.org_unit_id), meera)

    // --- Faculty listing ----------------------------------------------------
    section('Faculty listing')
    const list = await api(adminToken, '/api/tenant-admin/faculty?limit=50')
    check('lists all imported faculty', list.body?.total === 3, list.body?.total)
    const searched = await api(adminToken, '/api/tenant-admin/faculty?q=Genomics')
    check('search filters by department', searched.body?.total === 1, searched.body?.total)

    // --- Matching facets + filters -----------------------------------------
    section('Researcher matching')
    const facets = await api(adminToken, '/api/researcher-matching?action=facets')
    check('facets expose the school tree', (facets.body?.schools?.length || 0) === 2, facets.body?.schools)
    const csSchool = (facets.body?.schools || []).find((s: any) => s.name === 'School of Computer Science')
    const aiDept = (csSchool?.departments || []).find((d: any) => d.name === 'Department of Artificial Intelligence')
    check('facets nest departments under their school', Boolean(aiDept), csSchool)

    const broadSearch = await api(adminToken, '/api/researcher-matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'machine learning for medical imaging', limit: 20, filters: { includeBelowThreshold: true } }),
    })
    check('search returns candidates', (broadSearch.body?.results?.length || 0) > 0, broadSearch.body)
    const foundAsha = (broadSearch.body?.results || []).some((r: any) => r.displayName === 'Asha Verma')
    check('search finds the relevant researcher', foundAsha, broadSearch.body?.results?.map((r: any) => r.displayName))

    const deptFiltered = await api(adminToken, '/api/researcher-matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'machine learning for medical imaging',
        limit: 20,
        filters: { orgUnitIds: [aiDept?.id], includeBelowThreshold: true },
      }),
    })
    const deptNames = (deptFiltered.body?.results || []).map((r: any) => r.department)
    check(
      'department filter restricts results to that department',
      deptNames.length > 0 && deptNames.every((name: string) => name === 'Department of Artificial Intelligence'),
      deptNames
    )

    const areaFiltered = await api(adminToken, '/api/researcher-matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'research',
        limit: 20,
        filters: { researchAreas: ['genomics'], includeBelowThreshold: true },
      }),
    })
    const areaNames = (areaFiltered.body?.results || []).map((r: any) => r.displayName)
    check(
      'discipline filter matches on research areas',
      areaNames.length === 0 || areaNames.every((name: string) => name === 'Meera Iyer'),
      areaNames
    )

    // --- Assignment lifecycle ----------------------------------------------
    section('Assignment lifecycle')
    const ashaUser = await prisma.user.findUnique({ where: { email: `asha-${MARKER}@verify.local` } })

    const assigned = await api(adminToken, '/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fundingCallId: call.id,
        assigneeUserId: ashaUser!.id,
        deadlineAt: '2026-09-30',
        message: 'Please lead this one — your imaging work is the closest fit.',
        matchScore: 0.82,
        matchTier: 'strong',
        matchBasis: 'rerank',
      }),
    })
    check('admin can assign a call', assigned.status === 201, assigned.body)
    const assignmentId = assigned.body?.assignment?.id
    check('assignment stores the deadline and message', Boolean(assigned.body?.assignment?.deadlineAt) && Boolean(assigned.body?.assignment?.message), assigned.body?.assignment)

    const dupeAssign = await api(adminToken, '/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundingCallId: call.id, assigneeUserId: ashaUser!.id }),
    })
    check('duplicate assignment is rejected', dupeAssign.status === 409, dupeAssign.body)

    const managed = await api(adminToken, '/api/assignments?view=managed')
    check('managed view lists the assignment', (managed.body?.assignments || []).some((a: any) => a.id === assignmentId), managed.body)

    // Faculty side
    const ashaToken = tokenFor({ id: ashaUser!.id, email: ashaUser!.email, roles: ashaUser!.roles }, tenant.id, tenant.atiId)
    const mine = await api(ashaToken, '/api/assignments?view=mine')
    check('assignee sees it in their own list', (mine.body?.assignments || []).some((a: any) => a.id === assignmentId), mine.body)

    const forbiddenManaged = await api(ashaToken, '/api/assignments?view=managed')
    check('non-admin cannot read the managed view', forbiddenManaged.status === 403, forbiddenManaged.body)

    const noProof = await api(ashaToken, `/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    })
    check('completing without submission info is rejected', noProof.status === 400, noProof.body)

    const completed = await api(ashaToken, `/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'COMPLETED',
        submissionReference: 'SERB/2026/00412',
        submissionUrl: 'portal.example.edu/apply/994',
        submissionNotes: 'Submitted with two co-investigators.',
        submittedAt: '2026-09-28',
      }),
    })
    check('completing with submission info succeeds', completed.status === 200 && completed.body?.assignment?.status === 'COMPLETED', completed.body)
    check('bare submission link is normalized to a URL', completed.body?.assignment?.submissionUrl === 'https://portal.example.edu/apply/994', completed.body?.assignment?.submissionUrl)
    check('completion is timestamped', Boolean(completed.body?.assignment?.completedAt), completed.body?.assignment)

    const cannotCancel = await api(ashaToken, `/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    })
    check('assignee cannot cancel their own assignment', cannotCancel.status === 403, cannotCancel.body)

    const adminSees = await api(adminToken, '/api/assignments?view=managed')
    const tracked = (adminSees.body?.assignments || []).find((a: any) => a.id === assignmentId)
    check('admin tracking view reflects the submission', tracked?.status === 'COMPLETED' && tracked?.submissionReference === 'SERB/2026/00412', tracked)

    // --- Tenant isolation ---------------------------------------------------
    section('Tenant isolation')
    const otherTenant = await prisma.tenant.create({
      data: { name: `E2E Other ${STAMP}`, atiId: `ATI-other-${MARKER}`, type: 'ENTERPRISE', status: 'ACTIVE' },
    })
    const otherAdmin = await prisma.user.create({
      data: {
        email: `other-admin-${MARKER}@verify.local`,
        name: 'Other Admin',
        tenantId: otherTenant.id,
        roles: ['ADMIN'],
        status: 'ACTIVE',
      },
    })
    const otherToken = tokenFor(otherAdmin, otherTenant.id, otherTenant.atiId)

    const otherFaculty = await api(otherToken, '/api/tenant-admin/faculty')
    check('another tenant sees none of this roster', otherFaculty.body?.total === 0, otherFaculty.body?.total)

    const crossAssign = await api(otherToken, '/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundingCallId: call.id, assigneeUserId: ashaUser!.id }),
    })
    check('another tenant cannot assign this call', crossAssign.status === 404, crossAssign.body)

    const crossRead = await api(otherToken, `/api/assignments/${assignmentId}`)
    check('another tenant cannot read the assignment', crossRead.status === 404, crossRead.body)

    await purgeTenant(otherTenant.id)

    if (KEEP) {
      // Leave one assignment open so the "Mark complete" path is visible too.
      const ravi = await prisma.user.findUnique({ where: { email: `ravi-${MARKER}@verify.local` } })
      if (ravi) {
        await api(adminToken, '/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fundingCallId: call.id,
            assigneeUserId: ravi.id,
            deadlineAt: '2026-08-15',
            message: 'Please review the eligibility criteria and prepare a concept note.',
          }),
        })
      }

      console.log('\n--keep: fixtures retained for UI inspection')
      console.log(`  tenant   ${tenant.name} (${tenant.id})`)
      console.log(`  admin    ${admin.email}`)
      console.log(`  ADMIN_TOKEN=${adminToken}`)
      if (ravi) {
        console.log(`  faculty  ${ravi.email} (open assignment)`)
        console.log(`  FACULTY_TOKEN=${tokenFor({ id: ravi.id, email: ravi.email, roles: ravi.roles }, tenant.id, tenant.atiId)}`)
      }
      console.log('  Re-run without --keep to remove them.')
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
