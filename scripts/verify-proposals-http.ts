/**
 * HTTP-level checks for the proposal desk.
 *
 * The service walk (`verify-proposals.ts --walk`) proves the logic; this proves
 * the routes: that the right person gets 200, the wrong person gets 404 rather
 * than 403, and the lens actually strips what it claims to strip. Those are the
 * failures that never show up in a service test because the service is not the
 * thing enforcing them.
 *
 * Needs the dev server running (default http://localhost:3010).
 *
 * Usage: node ./node_modules/tsx/dist/cli.cjs scripts/verify-proposals-http.ts
 *          [--base http://localhost:3010] [--tenant FDEPT-DEMO-ATI]
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
    for (const [key, value] of Object.entries(dotenv.parse(readEnvFile(envPath)))) {
      process.env[key] = value
    }
  }
}

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : 'http://localhost:3010'
const tenantIndex = args.indexOf('--tenant')
const TENANT_ATI = tenantIndex >= 0 ? args[tenantIndex + 1] : 'FDEPT-DEMO-ATI'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const { default: prisma } = await import('../src/lib/prisma')
  const { Prisma } = await import('@prisma/client')
  const { generateJWT } = await import('../src/lib/auth')

  const tenant = await prisma.tenant.findFirst({
    where: { atiId: TENANT_ATI },
    select: { id: true, atiId: true },
  })
  if (!tenant) {
    console.log(`No tenant ${TENANT_ATI}. Seed it with scripts/seed-funding-dept-demo.ts.`)
    process.exit(1)
  }

  const proposal = await prisma.grantProposal.findFirst({
    where: { tenant_id: tenant.id },
    orderBy: { created_at: 'desc' },
    include: {
      versions: { orderBy: { version_no: 'desc' }, take: 1 },
      reviews: { where: { shared_at: { not: null } }, take: 1 },
    },
  })
  if (!proposal) {
    console.log('No proposal to test. Run verify-proposals.ts --walk --keep first.')
    process.exit(1)
  }

  async function tokenFor(email: string): Promise<string | null> {
    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true, email: true, roles: true, tenantId: true, tenant: { select: { atiId: true } } },
    })
    if (!user) return null
    return generateJWT({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      tenant_id: user.tenantId,
      tenant_ati_id: user.tenant?.atiId,
    } as any)
  }

  async function call(
    token: string | null,
    pathname: string,
    init: RequestInit = {}
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const text = await response.text()
    let body: any = text
    try {
      body = JSON.parse(text)
    } catch {
      /* CSV and binary come back as text */
    }
    return { status: response.status, body }
  }

  const piEmail = (
    await prisma.user.findUnique({ where: { id: proposal.pi_user_id }, select: { email: true } })
  )?.email
  // The officer who actually covers this proposal's school. Picking any member
  // would test the wrong thing: a member covering other schools is *supposed*
  // to be refused, which is the separate check below.
  const covering = await prisma.fundingDeptSchoolAssignment.findFirst({
    where: {
      tenant_id: tenant.id,
      org_unit_id: proposal.org_unit_id,
      member: { is_active: true },
    },
    select: { member: { select: { user: { select: { email: true } } } } },
  })
  const officer = covering?.member ? { user: covering.member.user } : null

  // A member of the same department who covers different schools — the reach
  // clamp's real subject.
  const otherSchoolOfficer = await prisma.fundingDeptMember.findFirst({
    where: {
      tenant_id: tenant.id,
      is_active: true,
      is_head: false,
      user_id: { not: covering?.member?.user ? undefined : undefined },
      school_assignments: { none: { org_unit_id: proposal.org_unit_id } },
    },
    select: { user: { select: { email: true } } },
  })
  const head = await prisma.fundingDeptMember.findFirst({
    where: { tenant_id: tenant.id, is_active: true, is_head: true },
    select: { user: { select: { email: true } } },
  })
  // Somebody in the tenant with no business seeing this proposal at all.
  const stranger = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      id: { not: proposal.pi_user_id },
      roles: { hasEvery: ['MEMBER'] },
      NOT: { fundingDeptMembership: { some: { is_active: true } } },
    },
    select: { email: true },
  })

  const piToken = piEmail ? await tokenFor(piEmail) : null
  const officerToken = officer?.user.email ? await tokenFor(officer.user.email) : null
  const headToken = head?.user.email ? await tokenFor(head.user.email) : null
  const strangerToken = stranger?.email ? await tokenFor(stranger.email) : null
  const otherOfficerToken = otherSchoolOfficer?.user.email
    ? await tokenFor(otherSchoolOfficer.user.email)
    : null

  console.log(`\n=== HTTP checks against ${BASE} ===`)
  console.log(`  proposal ${proposal.id} (${proposal.status})`)
  console.log(`  PI ${piEmail} · officer ${officer?.user.email} · stranger ${stranger?.email}\n`)

  // --- anonymous ---------------------------------------------------------
  const anon = await call(null, `/api/proposals/${proposal.id}`)
  check('an anonymous request is refused', anon.status === 401, `got ${anon.status}`)

  // --- the applicant -----------------------------------------------------
  if (piToken) {
    const mine = await call(piToken, '/api/proposals?view=mine')
    check('the applicant lists their own proposals', mine.status === 200, `got ${mine.status}`)
    check(
      'their own proposal is in the list',
      (mine.body?.proposals || []).some((row: any) => row.id === proposal.id)
    )

    const dossier = await call(piToken, `/api/proposals/${proposal.id}`)
    check('the applicant opens their proposal', dossier.status === 200, `got ${dossier.status}`)
    check('the reviewer workspace is hidden from them', dossier.body?.proposal?.reviewerCallId === null)
    check(
      'no unshared review is exposed',
      (dossier.body?.reviews || []).every((review: any) => review.sharedAt)
    )
    check(
      'no internal note is exposed',
      (dossier.body?.reviews || []).every((review: any) => review.internalNote === null)
    )

    const register = await call(piToken, '/api/proposals?view=register')
    check('the applicant cannot open the register', register.status === 403, `got ${register.status}`)

    const version = proposal.versions[0]
    if (version) {
      const run = await call(piToken, `/api/proposals/${proposal.id}/versions/${version.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      check('the applicant cannot start a review', run.status === 403, `got ${run.status}`)
    }
  }

  // --- the officer -------------------------------------------------------
  if (officerToken) {
    const dossier = await call(officerToken, `/api/proposals/${proposal.id}`)
    check('the covering officer opens the proposal', dossier.status === 200, `got ${dossier.status}`)
    check('the officer is told the workspace exists', 'reviewerCallId' in (dossier.body?.proposal || {}))
    check('the officer may manage it', dossier.body?.capabilities?.canManage === true)

    const register = await call(officerToken, '/api/proposals?view=register')
    check('the officer opens the register', register.status === 200, `got ${register.status}`)

    const csv = await call(officerToken, '/api/proposals/register?format=csv')
    check('the register exports as CSV', csv.status === 200 && String(csv.body).includes('Principal Investigator'))
  }

  // --- the department head ------------------------------------------------
  if (headToken) {
    const dossier = await call(headToken, `/api/proposals/${proposal.id}`)
    check('the department head reaches every school', dossier.status === 200, `got ${dossier.status}`)
  }

  // --- an officer of the same department, but not this school --------------
  if (otherOfficerToken) {
    const dossier = await call(otherOfficerToken, `/api/proposals/${proposal.id}`)
    check(
      'an officer covering other schools is refused, with 404 not 403',
      dossier.status === 404,
      `got ${dossier.status}`
    )
    const register = await call(otherOfficerToken, '/api/proposals?view=register')
    check(
      'and their register excludes it',
      register.status === 200 &&
        !(register.body?.proposals || []).some((row: any) => row.id === proposal.id)
    )
  } else {
    console.log('  SKIP  every officer covers this school; reach clamp not exercised')
  }

  // --- a colleague with no business here ----------------------------------
  if (strangerToken) {
    const dossier = await call(strangerToken, `/api/proposals/${proposal.id}`)
    check(
      'an unrelated colleague gets 404, not 403',
      dossier.status === 404,
      `got ${dossier.status}`
    )

    const mine = await call(strangerToken, '/api/proposals?view=mine')
    check(
      'and sees none of it in their own list',
      mine.status === 200 && !(mine.body?.proposals || []).some((row: any) => row.id === proposal.id)
    )
  } else {
    console.log('  SKIP  no unrelated colleague found to test with')
  }

  // --- letters, checklist, follow-ups and post-award ----------------------
  // These four arrived after the first pass and each has its own rule about
  // who may write: the office issues letters and ticks lines, the applicant
  // only reads them.
  const checklistItem = await prisma.grantProposalChecklistItem.findFirst({
    where: { proposal_id: proposal.id },
    orderBy: { sort_order: 'asc' },
    select: { id: true, label: true },
  })

  if (piToken) {
    const dossier = await call(piToken, `/api/proposals/${proposal.id}`)
    check(
      'the applicant is told what to attach',
      Array.isArray(dossier.body?.checklist),
      `${(dossier.body?.checklist || []).length} lines`
    )
    check(
      'the applicant may not issue a letter',
      (
        await call(piToken, `/api/proposals/${proposal.id}/documents`, {
          method: 'POST',
          body: new URLSearchParams({ kind: 'ENDORSEMENT' }),
        })
      ).status === 403
    )
    check(
      'the applicant may not log a follow-up',
      (
        await call(piToken, `/api/proposals/${proposal.id}/follow-ups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'CALL', note: 'trying it on' }),
        })
      ).status === 403
    )
    check(
      'the applicant may not add an obligation',
      (
        await call(piToken, `/api/proposals/${proposal.id}/milestones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', kind: 'UC' }),
        })
      ).status === 403
    )
    if (checklistItem) {
      check(
        'the applicant may not tick their own checklist',
        (
          await call(piToken, `/api/proposals/${proposal.id}/checklist/${checklistItem.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'DONE' }),
          })
        ).status === 403
      )
    }
  }

  if (officerToken) {
    const letters = await call(officerToken, `/api/proposals/${proposal.id}/documents`)
    check('the officer lists the letters', letters.status === 200, `got ${letters.status}`)

    const followUps = await call(officerToken, `/api/proposals/${proposal.id}/follow-ups`)
    check('the officer reads the contact log', followUps.status === 200, `got ${followUps.status}`)

    if (checklistItem) {
      const noReason = await call(
        officerToken,
        `/api/proposals/${proposal.id}/checklist/${checklistItem.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'WAIVED' }),
        }
      )
      check('waiving without a reason is refused', noReason.status === 400, `got ${noReason.status}`)
    }

    const badMilestone = await call(officerToken, `/api/proposals/${proposal.id}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', kind: 'NOT_A_KIND' }),
    })
    check('an unknown obligation type is rejected', badMilestone.status === 400, `got ${badMilestone.status}`)

    // A stage this institution has switched off must be refused at the route,
    // not merely hidden on the screen.
    const before = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { proposal_settings: true },
    })
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        proposal_settings: {
          ...((before?.proposal_settings as any) || {}),
          postAwardEnabled: false,
        } as any,
      },
    })
    const switchedOff = await call(officerToken, `/api/proposals/${proposal.id}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', kind: 'UC' }),
    })
    check(
      'a switched-off stage is refused at the route',
      switchedOff.status === 403 && switchedOff.body?.code === 'FEATURE_DISABLED',
      `got ${switchedOff.status} ${switchedOff.body?.code || ''}`
    )
    // `?? undefined` would make Prisma skip the field and leave the tenant
    // switched off, so a column that started NULL is put back as NULL.
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        proposal_settings:
          before?.proposal_settings == null
            ? (Prisma.DbNull as any)
            : (before.proposal_settings as any),
      },
    })
  }

  if (otherOfficerToken) {
    for (const suffix of ['documents', 'follow-ups', 'checklist', 'milestones']) {
      const out = await call(otherOfficerToken, `/api/proposals/${proposal.id}/${suffix}`)
      check(`${suffix} are 404 outside reach, not 403`, out.status === 404, `got ${out.status}`)
    }
  }

  // --- bad input ----------------------------------------------------------
  if (officerToken) {
    const missing = await call(officerToken, '/api/proposals/does-not-exist')
    check('an unknown proposal is 404', missing.status === 404, `got ${missing.status}`)

    const badStatus = await call(officerToken, `/api/proposals/${proposal.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'NOT_A_STATUS' }),
    })
    check('an unknown status is rejected', badStatus.status === 400, `got ${badStatus.status}`)

    const emptyCreate = await call(officerToken, '/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    check('a proposal with no call and no agency is rejected', emptyCreate.status === 400, `got ${emptyCreate.status}`)
  }

  console.log(`\n${failures === 0 ? 'All HTTP checks passed.' : `${failures} check(s) FAILED.`}\n`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
