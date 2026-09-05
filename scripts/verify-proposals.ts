/**
 * Verification harness for the grant-proposal desk.
 *
 * Read-only by default: checks the schema landed (tables, CHECKs, the partial
 * uniques and the sweep index) and prints the current proposal state per tenant.
 *
 * Pass --walk to run the whole lifecycle against a real tenant on a throwaway
 * proposal: create from an assignment, upload two drafts, exercise the cut-off
 * rules, record a submission, sanction it, and assert the linked assignment
 * followed through the shared write path. It cleans up after itself unless
 * --keep is given, so running it twice is itself the test.
 *
 * Pass --review as well to run the AI reviewer for real against the first
 * draft, wait for it to finish, share it, and assert the frozen snapshot. That
 * spends model tokens, so it is opt-in.
 *
 * Usage: node ./node_modules/tsx/dist/cli.cjs scripts/verify-proposals.ts
 *          [--walk] [--review] [--tenant <ati>] [--keep] [--no-email]
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
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

const args = process.argv.slice(2)
const WALK = args.includes('--walk')
const KEEP = args.includes('--keep')
const REVIEW = args.includes('--review')
const tenantArgIndex = args.indexOf('--tenant')
const TENANT_ATI = tenantArgIndex >= 0 ? args[tenantArgIndex + 1] : null

if (args.includes('--no-email')) {
  // Blank the mail credentials before any module that captures them loads.
  process.env.MJ_APIKEY_PUBLIC = ''
  process.env.MJ_APIKEY_PRIVATE = ''
  process.env.SENDGRID_API_KEY = ''
}

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const { default: prisma } = await import('../src/lib/prisma')

  console.log('\n=== Schema ===')

  const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'grant_proposal%'
    ORDER BY table_name
  `)
  const tableNames = tables.map((row) => row.table_name)
  for (const expected of [
    'grant_proposals',
    'grant_proposal_versions',
    'grant_proposal_reviews',
    'grant_proposal_team_members',
    'grant_proposal_budget_lines',
    'grant_proposal_events',
  ]) {
    check(`table ${expected}`, tableNames.includes(expected))
  }

  const constraints: Array<{ conname: string }> = await prisma.$queryRawUnsafe(`
    SELECT conname FROM pg_constraint
    WHERE conname LIKE 'grant_proposal%check%'
    ORDER BY conname
  `)
  const conNames = constraints.map((row) => row.conname)
  for (const expected of [
    'grant_proposals_status_check',
    'grant_proposal_versions_review_status_check',
    'grant_proposal_reviews_status_check',
    'grant_proposal_team_role_check',
    'grant_proposal_budget_head_check',
  ]) {
    check(`CHECK ${expected}`, conNames.includes(expected))
  }

  const indexes: Array<{ indexname: string; indexdef: string }> = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename LIKE 'grant_proposal%'
    ORDER BY indexname
  `)
  const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]))

  const callPi = byName.get('grant_proposals_call_pi_key')
  check(
    'partial unique (tenant, call, PI) excludes WITHDRAWN',
    Boolean(callPi && callPi.includes('WITHDRAWN')),
    callPi ? 'present' : 'missing'
  )
  const sweepIdx = byName.get('idx_grant_proposal_reviews_sweep')
  check(
    'sweep index is partial on live run states',
    Boolean(sweepIdx && sweepIdx.includes('QUEUED')),
    sweepIdx ? 'present' : 'missing'
  )
  check('version number unique per proposal', byName.has('grant_proposal_versions_no_key'))
  check('duplicate bytes rejected per proposal', byName.has('grant_proposal_versions_sha_key'))
  const teamKey = byName.get('grant_proposal_team_user_key')
  check(
    'team unique is partial on user_id',
    Boolean(teamKey && teamKey.includes('user_id IS NOT NULL')),
    teamKey ? 'present' : 'missing'
  )

  const settingsColumn: Array<{ column_name: string }> = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'proposal_settings'
  `)
  check('tenants.proposal_settings exists', settingsColumn.length === 1)

  console.log('\n=== Current state ===')
  const counts = await prisma.grantProposal.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  if (counts.length === 0) {
    console.log('  (no proposals yet)')
  } else {
    for (const row of counts) {
      console.log(`  ${row.status.padEnd(22)} ${row._count._all}`)
    }
  }

  if (!WALK) {
    console.log(
      `\n${failures === 0 ? 'All schema checks passed.' : `${failures} check(s) FAILED.`} Pass --walk to run the lifecycle.\n`
    )
    await prisma.$disconnect()
    process.exit(failures === 0 ? 0 : 1)
  }

  // ---------------------------------------------------------------------
  // Lifecycle walk
  // ---------------------------------------------------------------------
  console.log('\n=== Lifecycle walk ===')

  const { createProposal, getProposalDossier, updateProposalDetails } = await import(
    '../src/lib/proposals/proposalService'
  )
  const { uploadProposalVersion } = await import('../src/lib/proposals/versionService')
  const { transitionProposal } = await import('../src/lib/proposals/statusService')
  const { replaceProposalBudget } = await import('../src/lib/proposals/budgetService')
  const { replaceProposalTeam } = await import('../src/lib/proposals/teamService')

  // Find a tenant with a live assignment to hang the walk off.
  const assignment = await prisma.callAssignment.findFirst({
    where: {
      status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
      proposal: null,
      ...(TENANT_ATI ? { tenant: { atiId: TENANT_ATI } } : {}),
      assignee: { researcher_profile: { org_unit_id: { not: null } } },
    },
    include: {
      tenant: { select: { id: true, name: true, atiId: true } },
      assignee: { select: { id: true, name: true, email: true } },
      funding_call: { select: { id: true, title: true, agencyName: true } },
    },
    orderBy: { created_at: 'desc' },
  })

  if (!assignment) {
    console.log(
      '  SKIP — no live assignment with a placed assignee found. Seed one with scripts/seed-funding-dept-demo.ts.'
    )
    await prisma.$disconnect()
    process.exit(failures === 0 ? 0 : 1)
  }

  console.log(
    `  Tenant ${assignment.tenant.atiId} · assignee ${assignment.assignee.name || assignment.assignee.email}`
  )

  const officer = await prisma.fundingDeptMember.findFirst({
    where: { tenant_id: assignment.tenant_id, is_active: true },
    select: { user_id: true },
  })
  const officerId = officer?.user_id || assignment.assigned_by_user_id

  let proposalId: string | null = null
  try {
    const proposal = await createProposal({
      tenantId: assignment.tenant_id,
      actorUserId: officerId,
      piUserId: assignment.assignee_user_id,
      assignmentId: assignment.id,
    })
    proposalId = proposal.id
    check('created from an assignment', Boolean(proposal.id), `status ${proposal.status}`)
    check('school snapshotted', Boolean(proposal.org_unit_id))
    check('agency snapshotted', Boolean(proposal.agency_name), proposal.agency_name)

    const piRow = await prisma.grantProposalTeamMember.findFirst({
      where: { proposal_id: proposal.id, role: 'PI' },
    })
    check('PI seeded onto the team', Boolean(piRow))

    // --- version 1 -----------------------------------------------------
    const v1 = await uploadProposalVersion({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: assignment.assignee_user_id,
      lens: 'faculty',
      fileName: 'draft-v1.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Objectives\nWe will do the thing.\n\nMethodology\nCarefully.\n'),
      note: 'First draft',
    })
    check('version 1 uploaded', v1.versionNo === 1, `v${v1.versionNo}`)

    const afterV1 = await prisma.grantProposal.findUnique({ where: { id: proposal.id } })
    check('status moved to IN_REVIEW', afterV1?.status === 'IN_REVIEW', afterV1?.status)
    check('current_version_no tracked', afterV1?.current_version_no === 1)

    // --- duplicate bytes -----------------------------------------------
    let duplicateRejected = false
    try {
      await uploadProposalVersion({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: assignment.assignee_user_id,
        lens: 'faculty',
        fileName: 'draft-v1-again.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Objectives\nWe will do the thing.\n\nMethodology\nCarefully.\n'),
      })
    } catch (error: any) {
      duplicateRejected = error?.code === 'DUPLICATE_FILE'
    }
    check('identical bytes rejected', duplicateRejected)

    // --- legacy .doc ---------------------------------------------------
    let docRejected = false
    try {
      await uploadProposalVersion({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: assignment.assignee_user_id,
        lens: 'faculty',
        fileName: 'old.doc',
        buffer: Buffer.from('anything'),
      })
    } catch (error: any) {
      docRejected = error?.code === 'LEGACY_DOC'
    }
    check('legacy .doc rejected with the fix', docRejected)

    // --- cut-off in the past --------------------------------------------
    await updateProposalDetails({
      proposalId: proposal.id,
      tenantId: assignment.tenant_id,
      actorUserId: officerId,
      lens: 'officer',
      reviewCutoffAt: new Date(Date.now() - 86_400_000),
    })

    let cutoffBlocked = false
    try {
      await uploadProposalVersion({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: assignment.assignee_user_id,
        lens: 'faculty',
        fileName: 'draft-v2.txt',
        buffer: Buffer.from('Objectives\nWe will do the thing, better.\n'),
      })
    } catch (error: any) {
      cutoffBlocked = error?.code === 'UPLOAD_BLOCKED'
    }
    check('faculty blocked after the cut-off', cutoffBlocked)

    let overrideNeedsReason = false
    try {
      await uploadProposalVersion({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: officerId,
        lens: 'officer',
        fileName: 'draft-v2.txt',
        buffer: Buffer.from('Objectives\nWe will do the thing, better.\n'),
      })
    } catch (error: any) {
      overrideNeedsReason = error?.code === 'UPLOAD_BLOCKED'
    }
    check('officer override needs a reason', overrideNeedsReason)

    const v2 = await uploadProposalVersion({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      lens: 'officer',
      fileName: 'draft-v2.txt',
      buffer: Buffer.from('Objectives\nWe will do the thing, better.\n'),
      overrideReason: 'Agency extended its deadline by a week.',
    })
    check('officer accepted a late draft with a reason', v2.versionNo === 2, `v${v2.versionNo}`)
    check('override reason recorded on the version', Boolean(v2.overrideReason))

    // --- the AI review loop ----------------------------------------------
    if (REVIEW) {
      const { ensureReviewerWorkspace, runProposalReview } = await import(
        '../src/lib/proposals/reviewRunner'
      )
      const { shareProposalReview } = await import('../src/lib/proposals/shareService')

      const fresh = await prisma.grantProposal.findUnique({ where: { id: proposal.id } })
      const reviewerCallId = await ensureReviewerWorkspace(fresh, officerId)
      check('reviewer workspace created', Boolean(reviewerCallId))

      const seeded = await prisma.reviewerSection.count({ where: { call_id: reviewerCallId } })
      check('workspace seeded with sections', seeded > 0, `${seeded} sections`)

      const v1row = await prisma.grantProposalVersion.findFirst({
        where: { proposal_id: proposal.id, version_no: 1 },
      })
      const run = await prisma.grantProposalReview.create({
        data: {
          tenant_id: assignment.tenant_id,
          proposal_id: proposal.id,
          version_id: v1row!.id,
          reviewer_call_id: reviewerCallId,
          run_by_user_id: officerId,
          status: 'QUEUED',
        },
      })

      console.log('  running the reviewer (this makes real model calls)…')
      const outcome = await runProposalReview(run.id)
      check('the run claimed and executed', outcome.ran)

      const finished = await prisma.grantProposalReview.findUnique({ where: { id: run.id } })
      console.log(`  run finished as ${finished?.status}${finished?.error ? ` — ${finished.error}` : ''}`)

      if (finished?.status === 'DONE') {
        check('a score was recorded', finished.overall_score != null, String(finished.overall_score))
        check('progress steps recorded', Array.isArray((finished.progress as any)?.steps))

        const v1after = await prisma.grantProposalVersion.findUnique({ where: { id: v1row!.id } })
        check('version marked REVIEWED', v1after?.review_status === 'REVIEWED', v1after?.review_status)

        // A second claim must find nothing: the run is over.
        const second = await runProposalReview(run.id)
        check('a finished run cannot be claimed twice', second.ran === false)

        await shareProposalReview({
          tenantId: assignment.tenant_id,
          proposalId: proposal.id,
          reviewId: run.id,
          actorUserId: officerId,
          officerNote: 'Tighten the methodology and resubmit.',
        })
        const shared = await prisma.grantProposalReview.findUnique({ where: { id: run.id } })
        check('shared with the researcher', Boolean(shared?.shared_at))
        check('report frozen at share time', Boolean(shared?.report_snapshot))
        const snapshotSections = (shared?.report_snapshot as any)?.sections || []
        check('snapshot carries the section reviews', snapshotSections.length > 0, `${snapshotSections.length} sections`)
        check('one row per section title in the snapshot',
          new Set(snapshotSections.map((s: any) => s.section_title)).size === snapshotSections.length)

        const v1shared = await prisma.grantProposalVersion.findUnique({ where: { id: v1row!.id } })
        check('version marked SHARED', v1shared?.review_status === 'SHARED', v1shared?.review_status)

        const facultyReviews = await getProposalDossier(proposal.id, 'faculty')
        check('the researcher now sees exactly one review', facultyReviews.reviews.length === 1)
        check(
          'the researcher never sees the internal note',
          facultyReviews.reviews[0]?.internalNote === null
        )
      } else {
        console.log('  (review did not complete — the checks above it still stand)')
      }
    }

    // --- team + budget ---------------------------------------------------
    const team = await replaceProposalTeam({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: assignment.assignee_user_id,
      members: [
        { userId: assignment.assignee_user_id, name: 'PI', role: 'PI' },
        { userId: null, name: 'Dr External', role: 'CO_PI', affiliation: 'Partner Institute', isExternal: true },
      ],
    })
    check('team saved with an external co-PI', team.length === 2)

    let twoPisRejected = false
    try {
      await replaceProposalTeam({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: assignment.assignee_user_id,
        members: [
          { userId: assignment.assignee_user_id, name: 'PI', role: 'PI' },
          { userId: null, name: 'Another PI', role: 'PI', isExternal: true },
        ],
      })
    } catch (error: any) {
      twoPisRejected = error?.code === 'ONE_PI'
    }
    check('a second principal investigator is refused', twoPisRejected)

    const budget = await replaceProposalBudget({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: assignment.assignee_user_id,
      lines: [
        { head: 'MANPOWER', yearNo: 1, amount: 600000 },
        { head: 'EQUIPMENT', yearNo: 1, amount: 400000 },
        { head: 'MANPOWER', yearNo: 2, amount: 600000 },
      ],
    })
    check('budget total computed from its lines', budget.total === 1600000, String(budget.total))

    const withBudget = await prisma.grantProposal.findUnique({ where: { id: proposal.id } })
    check('requested_amount kept in step', withBudget?.requested_amount === 1600000)

    // --- the standing watches ---------------------------------------------
    // A cut-off two days out puts the proposal squarely inside the D3 rung, so
    // the sweep has something real to find rather than passing on an empty set.
    await prisma.grantProposal.update({
      where: { id: proposal.id },
      data: {
        review_cutoff_at: new Date(Date.now() + 2 * 86_400_000),
        nudge_stages: [],
      },
    })

    const { sweepProposals } = await import('../src/lib/proposals/sweeps')
    const firstSweep = await sweepProposals()
    check('the cut-off sweep nudges the applicant', firstSweep.cutoffNudges >= 1, JSON.stringify(firstSweep))

    const secondSweep = await sweepProposals()
    check(
      'a second sweep does not nudge again',
      secondSweep.cutoffNudges === 0,
      JSON.stringify(secondSweep)
    )

    const stages = await prisma.grantProposal.findUnique({
      where: { id: proposal.id },
      select: { nudge_stages: true },
    })
    check('the ladder recorded the rung it fired', Boolean(stages?.nudge_stages.includes('D3')), String(stages?.nudge_stages))

    // A fresh draft answers the nudge, so the ladder starts again.
    await uploadProposalVersion({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: assignment.assignee_user_id,
      lens: 'faculty',
      fileName: 'draft-v3.txt',
      buffer: Buffer.from(['Objectives', 'Third pass, addressing the remarks.'].join(String.fromCharCode(10))),
    })
    const afterUpload = await prisma.grantProposal.findUnique({
      where: { id: proposal.id },
      select: { nudge_stages: true },
    })
    check('a new draft resets the ladder', afterUpload?.nudge_stages.length === 0)

    // --- clearing --------------------------------------------------------
    // Whether clearing needs a written reason depends on whether a review was
    // ever sent to the applicant — which is exactly what --review just did.
    const sharedCount = await prisma.grantProposalReview.count({
      where: { proposal_id: proposal.id, shared_at: { not: null } },
    })

    if (sharedCount === 0) {
      let clearNeedsReason = false
      try {
        await transitionProposal({
          tenantId: assignment.tenant_id,
          proposalId: proposal.id,
          actorUserId: officerId,
          lens: 'officer',
          to: 'CLEARED',
        })
      } catch (error: any) {
        clearNeedsReason = error?.code === 'BAD_TRANSITION'
      }
      check('clearing an unreviewed proposal needs a reason', clearNeedsReason)
    }

    await transitionProposal({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      lens: 'officer',
      to: 'CLEARED',
      ...(sharedCount === 0
        ? { overrideReason: 'Deadline tomorrow, reviewed offline by the Dean.' }
        : {}),
    })
    check(
      sharedCount > 0
        ? 'a reviewed proposal clears without an override'
        : 'an unreviewed proposal clears with a recorded reason',
      true
    )
    const cleared = await prisma.grantProposal.findUnique({ where: { id: proposal.id } })
    check('cleared with a recorded reason', cleared?.status === 'CLEARED', cleared?.status)
    check('cleared_by stamped', Boolean(cleared?.cleared_by_user_id))

    // --- submission through the shared write path -----------------------
    const submitResult = await transitionProposal({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: assignment.assignee_user_id,
      lens: 'faculty',
      to: 'SUBMITTED',
      submissionReference: 'REF/VERIFY/2026/001',
      submittedAt: new Date(),
    })
    check('submission recorded', submitResult.proposal.status === 'SUBMITTED')
    check('the linked assignment went through the shared path', submitResult.submissionApplied)

    const assignmentAfter = await prisma.callAssignment.findUnique({ where: { id: assignment.id } })
    check(
      'assignment closed as COMPLETED',
      assignmentAfter?.status === 'COMPLETED',
      assignmentAfter?.status
    )
    check('assignment carries the submission date', Boolean(assignmentAfter?.submitted_at))

    // --- the agency's answer --------------------------------------------
    await transitionProposal({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      lens: 'officer',
      to: 'SANCTIONED',
      sanctionedAmount: 1450000,
      sanctionReference: 'SANC/2026/77',
      agencyStatusNote: 'Sanctioned at a reduced equipment head.',
    })
    const sanctioned = await prisma.grantProposal.findUnique({ where: { id: proposal.id } })
    check('sanctioned amount stored', sanctioned?.sanctioned_amount === 1450000)

    const assignmentOutcome = await prisma.callAssignment.findUnique({ where: { id: assignment.id } })
    check(
      'assignment outcome written back as AWARDED',
      assignmentOutcome?.outcome === 'AWARDED',
      assignmentOutcome?.outcome
    )
    check(
      'award amount mirrored onto the assignment',
      assignmentOutcome?.award_amount === 1450000,
      String(assignmentOutcome?.award_amount)
    )


    // --- the register -------------------------------------------------------
    const { buildRegisterRows, registerToCsv } = await import('../src/lib/proposals/register')
    const registerRows = await buildRegisterRows({
      tenantId: assignment.tenant_id,
      reachUnitIds: null,
    })
    const mine = registerRows.find((row) => row.title === proposal.title)
    check('the register lists the proposal', Boolean(mine))
    check('the register names the school and the PI', Boolean(mine?.school && mine?.pi))
    check('the register carries the co-investigator', (mine?.coInvestigators || '').includes('Dr External'))
    const csv = registerToCsv(registerRows)
    check('the register renders as CSV', csv.split(String.fromCharCode(13, 10)).length === registerRows.length + 1)

    // --- tenant feature toggles -------------------------------------------
    // The point of a switch is that turning it off actually stops something,
    // so each one is exercised rather than merely stored.
    const { saveProposalSettings, getProposalSettings } = await import(
      '../src/lib/proposals/settings'
    )
    const originalSettings = await getProposalSettings(assignment.tenant_id)

    try {
      await saveProposalSettings(assignment.tenant_id, { budgetEnabled: false })
      const readBack = await getProposalSettings(assignment.tenant_id)
      check('a toggle persists', readBack.budgetEnabled === false)
      check('the other toggles are untouched', readBack.teamEnabled === true)

      // Turning budgets off must not silently wipe the ones already recorded.
      const budgetStillThere = await prisma.grantProposalBudgetLine.count({
        where: { proposal_id: proposal.id },
      })
      check('existing budget rows survive the switch', budgetStillThere > 0)

      await saveProposalSettings(assignment.tenant_id, { cutoffEnabled: false })
      await prisma.grantProposal.update({
        where: { id: proposal.id },
        data: { review_cutoff_at: new Date(Date.now() - 86_400_000), status: 'IN_REVIEW' },
      })

      // With the cut-off switched off a past date must not block anybody.
      const lateUpload = await uploadProposalVersion({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: assignment.assignee_user_id,
        lens: 'faculty',
        fileName: 'draft-v4.txt',
        buffer: Buffer.from(
          ['Objectives', 'Fourth pass, cut-off disabled.'].join(String.fromCharCode(10))
        ),
      })
      check('a disabled cut-off stops blocking uploads', lateUpload.versionNo === 4)

      // And the sweep must not chase a cut-off nobody operates.
      await prisma.grantProposal.update({
        where: { id: proposal.id },
        data: { review_cutoff_at: new Date(Date.now() + 2 * 86_400_000), nudge_stages: [] },
      })
      const quietSweep = await sweepProposals()
      check(
        'the sweep skips a switched-off cut-off',
        quietSweep.cutoffNudges === 0 && quietSweep.skippedDisabled >= 1,
        JSON.stringify(quietSweep)
      )
    } finally {
      await saveProposalSettings(assignment.tenant_id, originalSettings)
      const restored = await getProposalSettings(assignment.tenant_id)
      check('settings restored after the walk', restored.cutoffEnabled && restored.budgetEnabled)
    }

    // --- endorsement letters, follow-ups, checklist, post-award ------------
    const { issueProposalDocument, listProposalDocuments, readProposalDocument } = await import(
      '../src/lib/proposals/documentService'
    )
    const { recordProposalFollowUp, listProposalFollowUps, claimDueFollowUpReminders } =
      await import('../src/lib/proposals/followUpService')
    const { listChecklist, updateChecklistItem, outstandingRequiredItems } = await import(
      '../src/lib/proposals/checklistService'
    )
    const {
      addProposalMilestone,
      listProposalMilestones,
      seedPostAwardSchedule,
      setProjectDates,
    } = await import('../src/lib/proposals/postAwardService')

    // The checklist should already exist, seeded when the record was opened.
    const seeded = await listChecklist(proposal.id, true)
    check('a new proposal starts with the tenant checklist', seeded.length > 0, `${seeded.length} lines`)
    const outstandingAtStart = await outstandingRequiredItems(proposal.id)
    check('and every line starts outstanding', outstandingAtStart.length === seeded.length)

    // The endorsement letter. A tiny PDF header is enough to prove the path.
    const letterBytes = Buffer.from(
      ['%PDF-1.4', 'endorsement letter (scanned)', '%%EOF'].join(String.fromCharCode(10))
    )
    const letter = await issueProposalDocument({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      kind: 'ENDORSEMENT',
      referenceNo: 'DSR/2026/VERIFY/1',
      signedBy: 'Registrar',
      fileName: 'endorsement.pdf',
      mimeType: 'application/pdf',
      buffer: letterBytes,
    })
    check('an endorsement letter is issued', Boolean(letter.id), letter.title)
    check('it carries its reference number', letter.referenceNo === 'DSR/2026/VERIFY/1')
    check('and is visible to the applicant by default', letter.visibleToFaculty === true)

    const readBack = await readProposalDocument(proposal.id, letter.id, false)
    check('the applicant can read the file back', readBack.buffer.length === letterBytes.length)

    // Issuing it should have ticked its own checklist line.
    const afterLetter = await listChecklist(proposal.id, true)
    const endorsementLine = afterLetter.find((item) => /ndorsement/.test(item.label))
    check(
      'issuing the letter ticks its own checklist line',
      endorsementLine?.status === 'DONE' && endorsementLine?.documentId === letter.id,
      endorsementLine?.status
    )

    let duplicateLetterRejected = false
    try {
      await issueProposalDocument({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: officerId,
        kind: 'ENDORSEMENT',
        fileName: 'endorsement-again.pdf',
        buffer: letterBytes,
      })
    } catch (error: any) {
      duplicateLetterRejected = error?.code === 'DUPLICATE_FILE'
    }
    check('re-issuing the identical letter is refused', duplicateLetterRejected)

    // Waiving a required line needs a reason.
    const waivable = afterLetter.find((item) => item.status === 'PENDING')
    if (waivable) {
      let waiveNeedsReason = false
      try {
        await updateChecklistItem({
          tenantId: assignment.tenant_id,
          proposalId: proposal.id,
          itemId: waivable.id,
          actorUserId: officerId,
          status: 'WAIVED',
        })
      } catch (error: any) {
        waiveNeedsReason = error?.code === 'REASON_REQUIRED'
      }
      check('waiving a required attachment needs a reason', waiveNeedsReason)
    }

    // Clearing must refuse while required lines are outstanding.
    //
    // Exercised on its own: by this point in the walk the proposal is
    // sanctioned, and the review requirement would answer first if it were
    // still on — either would mask the gate under test.
    const settingsBeforeGate = await getProposalSettings(assignment.tenant_id)
    await saveProposalSettings(assignment.tenant_id, { requireReviewBeforeClearing: false })
    await prisma.grantProposal.update({
      where: { id: proposal.id },
      data: { status: 'IN_REVIEW' },
    })

    let clearBlockedByChecklist = false
    let blockMessage = ''
    try {
      await transitionProposal({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: officerId,
        lens: 'officer',
        to: 'CLEARED',
      })
    } catch (error: any) {
      clearBlockedByChecklist = error?.code === 'CHECKLIST_INCOMPLETE'
      blockMessage = error?.message || ''
    }
    check('an incomplete checklist blocks clearance', clearBlockedByChecklist)
    check(
      'and the refusal names what is missing',
      blockMessage.includes('Still outstanding'),
      blockMessage.slice(0, 80)
    )

    // A written reason clears it anyway, which is the escape hatch an office
    // with a deadline tomorrow actually needs.
    await transitionProposal({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      lens: 'officer',
      to: 'CLEARED',
      overrideReason: 'Agency accepts the endorsement letter separately.',
    })
    const clearedOverChecklist = await prisma.grantProposal.findUnique({
      where: { id: proposal.id },
      select: { status: true },
    })
    check('a reason clears it over an incomplete checklist', clearedOverChecklist?.status === 'CLEARED')

    await saveProposalSettings(assignment.tenant_id, {
      requireReviewBeforeClearing: settingsBeforeGate.requireReviewBeforeClearing,
    })

    // Settle every remaining line so the ordinary clearance below still works.
    for (const item of await listChecklist(proposal.id, true)) {
      if (item.status === 'PENDING') {
        await updateChecklistItem({
          tenantId: assignment.tenant_id,
          proposalId: proposal.id,
          itemId: item.id,
          actorUserId: officerId,
          status: 'NOT_APPLICABLE',
        })
      }
    }
    check('the checklist can be settled', (await outstandingRequiredItems(proposal.id)).length === 0)

    // A follow-up that moves the status and sets a tickler, in one action.
    const followUp = await recordProposalFollowUp({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      lens: 'officer',
      kind: 'CALL',
      note: 'Rang the PI — says the agency portal shows it with the expert committee.',
      remindAt: new Date(Date.now() - 60_000),
    })
    check('a follow-up is recorded', Boolean(followUp.id))
    check('the officer sees their own tickler', followUp.remindAt !== null)

    const facultyLog = await listProposalFollowUps(proposal.id, 'faculty')
    check('the contact log stays internal by default', facultyLog.length === 0)

    const claimed = await claimDueFollowUpReminders(10)
    check('a due tickler is claimed exactly once', claimed.some((row) => row.id === followUp.id))
    const claimedAgain = await claimDueFollowUpReminders(10)
    check(
      'and never claimed twice',
      !claimedAgain.some((row) => row.id === followUp.id)
    )

    // --- post-award: the obligations that outlive the submission -----------
    await prisma.grantProposal.update({
      where: { id: proposal.id },
      data: { status: 'SANCTIONED', sanctioned_amount: 1450000 },
    })

    const projectStart = new Date('2026-04-01T00:00:00Z')
    const schedule = await seedPostAwardSchedule({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      startAt: projectStart,
      years: 2,
    })
    check('a sanctioned project gets a default schedule', schedule.years === 2)

    const obligations = await listProposalMilestones(proposal.id)
    check(
      'with a UC and a report for each year',
      obligations.filter((row) => row.kind === 'UC').length === 2 &&
        obligations.filter((row) => row.kind === 'REPORT').length === 2,
      `${obligations.length} obligations`
    )
    check(
      'these belong to the proposal, not an assignment',
      (await prisma.assignmentMilestone.count({
        where: { proposal_id: proposal.id, assignment_id: null },
      })) === obligations.length
    )

    let scheduleTwice = false
    try {
      await seedPostAwardSchedule({
        tenantId: assignment.tenant_id,
        proposalId: proposal.id,
        actorUserId: officerId,
        startAt: projectStart,
        years: 2,
      })
    } catch (error: any) {
      scheduleTwice = error?.code === 'ALREADY_SCHEDULED'
    }
    check('scheduling twice is refused', scheduleTwice)

    const instalment = await addProposalMilestone({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      kind: 'INSTALMENT',
      title: 'First instalment',
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      amount: 700000,
    })
    check('an instalment can be added', instalment.amount === 700000)

    // The schedule already dated the project, so THIS one is a real extension
    // rather than a first set — which is the distinction the history records.
    const beforeExtension = await prisma.grantProposal.findUnique({
      where: { id: proposal.id },
      select: { project_start_at: true, project_end_at: true },
    })
    check('the schedule dated the project', Boolean(beforeExtension?.project_end_at))

    const dates = await setProjectDates({
      tenantId: assignment.tenant_id,
      proposalId: proposal.id,
      actorUserId: officerId,
      endAt: new Date('2028-09-30T00:00:00Z'),
      reason: 'Agency granted a six-month extension.',
    })
    check('an extension moves the end date', Boolean(dates.projectEndAt))
    const extensionEvent = await prisma.grantProposalEvent.findFirst({
      where: { proposal_id: proposal.id, kind: 'MILESTONE_CHANGED' },
      orderBy: { created_at: 'desc' },
      select: { payload: true },
    })
    check(
      'and the previous end date survives in the history',
      Boolean((extensionEvent?.payload as any)?.extension)
    )

    // The obligation ladder: the instalment is 3 days out, so D7 is its rung.
    const obligationSweep = await sweepProposals()
    check(
      'an approaching obligation is nudged',
      obligationSweep.obligationNudges >= 1,
      JSON.stringify({ obligationNudges: obligationSweep.obligationNudges })
    )
    const quietObligationSweep = await sweepProposals()
    check(
      'and not nudged again on the same rung',
      quietObligationSweep.obligationNudges === 0
    )

    // The assignment ladder must be untouched by any of this.
    const assignmentMilestonesUnaffected = await prisma.assignmentMilestone.count({
      where: { assignment_id: { not: null }, proposal_id: { not: null } },
    })
    check('no row ever belongs to both an assignment and a proposal', assignmentMilestonesUnaffected === 0)

    // --- lenses -----------------------------------------------------------
    const officerView = await getProposalDossier(proposal.id, 'officer')
    const facultyView = await getProposalDossier(proposal.id, 'faculty')
    check('officer sees the reviewer workspace field', 'reviewerCallId' in officerView.proposal)
    check('faculty never sees the reviewer workspace', facultyView.proposal.reviewerCallId === null)

    const events = await prisma.grantProposalEvent.findMany({
      where: { proposal_id: proposal.id },
      orderBy: { created_at: 'asc' },
      select: { kind: true },
    })
    const kinds = events.map((row) => row.kind)
    check(
      'the history reads as one story',
      ['CREATED', 'VERSION_UPLOADED', 'CLEARED', 'SUBMITTED'].every((kind) => kinds.includes(kind)),
      kinds.join(' → ')
    )
  } finally {
    if (proposalId && !KEEP) {
      const versions = await prisma.grantProposalVersion.findMany({
        where: { proposal_id: proposalId },
        select: { storage_path: true },
      })
      await prisma.grantProposal.delete({ where: { id: proposalId } }).catch(() => undefined)
      for (const version of versions) {
        fs.promises.unlink(version.storage_path).catch(() => undefined)
      }
      // The assignment was closed out by the walk; put it back as it was.
      await prisma.callAssignment
        .update({
          where: { id: assignment.id },
          data: {
            status: assignment.status,
            outcome: assignment.outcome,
            award_amount: assignment.award_amount,
            award_currency: assignment.award_currency,
            decision_at: assignment.decision_at,
            submitted_at: assignment.submitted_at,
            completed_at: assignment.completed_at,
            submission_reference: assignment.submission_reference,
            submission_notes: assignment.submission_notes,
          },
        })
        .catch(() => undefined)
      console.log('  (cleaned up)')
    }
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
