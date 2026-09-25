/**
 * DSR reporting fix — end-to-end checks in a disposable local database.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/verify-dsr-reporting.ts [--print]
 *
 * A. Every state and count definition agrees between SQL and TypeScript.
 * B. Baseline: the headline figures of the three totals functions for a fixed
 *    fixture. A change to any of these numbers must come with a note below
 *    saying why it moved.
 * C. Call-to-school mapping, routing and backfill (Phase 1).
 * D. Review, submission and deadline corrections (Phase 2).
 * E. Call Register, Mapping register and Audit trail (Phase 3).
 *
 * No mailers, notifications or AI calls; the clone is dropped afterwards.
 */
import assert from 'node:assert/strict'
import { checker, withDisposableDb } from './lib/disposableDb'
import { buildReportingFixture } from './lib/dsrReportingFixture'

const PRINT = process.argv.includes('--print')
const DAY = 86400000

async function main() {
  await withDisposableDb(async ({ db, applied }) => {
    console.log(`Clone has ${applied.length} migration(s) the dev database lacks: ${applied.join(', ') || 'none'}`)
    const { ok, count } = checker()
    const { Prisma } = await import('../src/lib/prisma-generated')
    const defs = await import('../src/lib/fundingDept/reportDefinitions')

    /* ---------------- A. SQL and TypeScript definitions agree ---------------- */
    {
      const review: Array<Record<string, unknown>> = []
      for (const triageStatus of [null, 'NEW', 'IN_REVIEW', 'RELEVANT', 'SHORTLISTED', 'NOT_RELEVANT'])
        for (const decided of [null, '2026-09-20T10:00:00.000Z'])
          for (const dispositionReason of [null, 'AWAITING_ACTION', 'RELEVANCE_UNRESOLVED', 'CAPACITY', 'OTHER'])
            for (const formalAllocations of [0, 1]) for (const namedActions of [0, 2])
              review.push({ i: review.length, triageStatus, decided, dispositionReason, formalAllocations, namedActions })
      const sqlReview = await db.$queryRaw<Array<{ i: number; state: string }>>(Prisma.sql`
        SELECT i, ${defs.reviewStateSql({ triageStatus: 'r."triageStatus"', triageDecidedAt: 'r.decided', dispositionReason: 'r."dispositionReason"', formalAllocations: 'r."formalAllocations"', namedActions: 'r."namedActions"' })} state
          FROM jsonb_to_recordset(${JSON.stringify(review)}::jsonb) AS r(i int, "triageStatus" text, decided text, "dispositionReason" text, "formalAllocations" int, "namedActions" int)`)
      ok(sqlReview.every(row => {
        const input = review[row.i] as any
        return row.state === defs.reviewState({ ...input, triageDecidedAt: input.decided })
      }) && sqlReview.length === review.length, `Review state: SQL and TypeScript agree on all ${review.length} combinations`)

      const apps: Array<Record<string, unknown>> = []
      for (const submitted_at of [null, '2026-09-20T10:00:00.000Z'])
        for (const assignment_status of [null, 'ASSIGNED', 'COMPLETED', 'DECLINED'])
          for (const proposal_status of [null, 'DRAFT', 'SUBMITTED', 'SANCTIONED', 'REJECTED'])
            for (const outcome of [null, 'PENDING', 'AWARDED'])
              apps.push({ i: apps.length, submitted_at, assignment_status, proposal_status, outcome })
      const sqlApps = await db.$queryRaw<Array<{ i: number; submitted: boolean }>>(Prisma.sql`
        SELECT i, ${defs.dsrApplicationSubmittedSql('a')} submitted
          FROM jsonb_to_recordset(${JSON.stringify(apps)}::jsonb) AS a(i int, submitted_at text, assignment_status text, proposal_status text, outcome text)`)
      ok(sqlApps.every(row => row.submitted === defs.isSubmission(apps[row.i] as any)), `Submission: SQL and TypeScript agree on all ${apps.length} combinations`)

      const deadlines: Array<Record<string, unknown>> = []
      const asOfs = ['2026-09-25T04:30:00.000Z', '2026-09-24T18:40:00.000Z', '2026-09-25T18:20:00.000Z'] // 10:00, 00:10 and 23:50 IST
      const cutoffs = [null, '2026-09-25T00:00:00.000Z', '2026-09-24T18:29:00.000Z', '2026-09-24T18:31:00.000Z', '2026-09-23T00:00:00.000Z',
        '2026-10-02T00:00:00.000Z', '2026-10-03T00:00:00.000Z', '2026-10-02T18:31:00.000Z']
      for (const asOf of asOfs) for (const deadline of cutoffs)
        for (const formalAllocations of [0, 1]) for (const submissions of [0, 1]) for (const closedWithReason of [false, true])
          deadlines.push({ i: deadlines.length, asOf, deadline, formalAllocations, submissions, closedWithReason })
      let deadlineAgree = true
      for (const asOf of asOfs) {
        const subset = deadlines.filter(d => d.asOf === asOf)
        const rows = await db.$queryRaw<Array<{ i: number; state: string }>>(Prisma.sql`
          SELECT i, ${defs.deadlineStateSql({ deadline: 'd.deadline', formalAllocations: 'd."formalAllocations"', submissions: 'd.submissions', closedWithReason: 'd."closedWithReason"' }, new Date(asOf))} state
            FROM (SELECT i, deadline::timestamptz AT TIME ZONE 'UTC' deadline, "formalAllocations", submissions, "closedWithReason"
                    FROM jsonb_to_recordset(${JSON.stringify(subset)}::jsonb) AS r(i int, deadline text, "formalAllocations" int, submissions int, "closedWithReason" boolean)) d`)
        for (const row of rows) {
          const input = deadlines[row.i] as any
          const js = defs.deadlineState(input, new Date(asOf))
          if (js !== row.state) { deadlineAgree = false; console.log('Deadline disagreement', input, { sql: row.state, js }) }
        }
      }
      ok(deadlineAgree, `Deadline state: SQL and TypeScript agree on all ${deadlines.length} combinations, including India day boundaries`)
    }

    /* ---------------- B. Baseline figures ---------------- */
    const fx = await buildReportingFixture(db, 'baseline')
    const { getManagementReport } = await import('../src/lib/fundingDept/managementService')
    const { getSchoolFunnel, getDepartmentTotals } = await import('../src/lib/fundingDept/schoolFunnelService')
    const { getIncomingReport } = await import('../src/lib/fundingDept/incomingReport')
    const { refreshCurrentSchoolMatches } = await import('../src/lib/fundingDept/currentMatches')
    const schoolIds = Object.values(fx.schools).map(s => s.id)
    const refresh = async () => { for (const id of schoolIds) await refreshCurrentSchoolMatches(fx.tenantId, id) }
    const report = async (extra: Record<string, unknown> = {}) => {
      await refresh()
      return getManagementReport(fx.tenantId, { start: new Date(fx.now.getTime() - 90 * DAY), end: new Date(Date.now() + 1), asOf: new Date(), mode: 'portfolio', includeExpired: true, ...extra } as any)
    }
    const callsIn = (r: Awaited<ReturnType<typeof report>>) => r.members.flatMap(m => m.schools.flatMap(s => s.calls.map(c => ({ school: s.name, id: c.id, quality: c.quality }))))

    const baseline = async () => {
      const management = await report()
      const funnel = await getSchoolFunnel(fx.tenantId)
      const department = await getDepartmentTotals(fx.tenantId, funnel)
      const incoming = await getIncomingReport(fx.tenantId, undefined, { includeExpired: true, asOf: new Date() })
      return { management, funnel, department, incoming }
    }
    const before = await baseline()
    const pick = (b: typeof before) => ({
      summarize: (({ schools, callSchoolOpportunities, distinctCalls, unclassified, allocated, independent, applications, submitted, allocatedSubmissions, independentSubmissions, actedOn, untouched, unallocated, missedUnallocatedNoSubmission }) =>
        ({ schools, callSchoolOpportunities, distinctCalls, unclassified, allocated, independent, applications, submitted, allocatedSubmissions, independentSubmissions, actedOn, untouched, unallocated, missedUnallocatedNoSubmission }))(b.management.totals),
      department: (({ openCalls, unclassifiedCalls, unmappedSchools, pending, live, submitted, proposalsSubmitted }) => ({ openCalls, unclassifiedCalls, unmappedSchools, pending, live, submitted, proposalsSubmitted }))(b.department),
      incoming: { rows: b.incoming.length, withCall: b.incoming.filter(r => r.callId).length, duplicates: b.incoming.filter(r => r.duplicate).length,
        completed: b.incoming.filter(r => r.actionClass === 'COMPLETED').length },
    })
    const figures = pick(before)
    if (PRINT) {
      console.log(JSON.stringify(figures, null, 2))
      console.log(JSON.stringify(callsIn(before.management), null, 2))
      console.log(JSON.stringify(before.funnel.map(f => ({ n: f.name, relevantOpen: f.relevantOpen, pending: f.pending, live: f.live, submitted: f.submitted })), null, 2))
    }
    // Frozen figures. Notes explain every number that moved from the pre-fix code.
    // Before call-to-school mapping only 8 calls reach any school: the
    // cross-disciplinary, expired-idle, closing-soon and keyword calls are
    // relevant to a school but nobody was matched, so no queue shows them.
    assert.deepEqual(figures.summarize, {
      schools: 4,
      // Moved (Phase 0): the ad-hoc proposal with no funding call no longer
      // counts as a call or a call-school responsibility. Before: 9 and 9.
      callSchoolOpportunities: 8, distinctCalls: 8,
      // "unclassified" here counts calls with no origin school, not calls with no
      // discipline classification — relabelled in the Phase 2 unit labels.
      unclassified: 7, allocated: 7, independent: 2, applications: 9,
      submitted: 2, allocatedSubmissions: 1, independentSubmissions: 1,
      actedOn: 7, untouched: 1, unallocated: 2, missedUnallocatedNoSubmission: 0,
    }, 'management totals baseline')
    ok(true, 'Management totals match the frozen baseline')
    assert.deepEqual(figures.department, {
      openCalls: 12, unclassifiedCalls: 1, unmappedSchools: 1, pending: 3, live: 5,
      // Moved (Phase 0): the funnel counted an allocation as submitted only on
      // the assignment's own COMPLETED status, so the allocation whose linked
      // proposal was at the agency read 0 here and 1 in the management report.
      submitted: 1, proposalsSubmitted: 2,
    }, 'department totals baseline')
    ok(true, 'Department totals match the frozen baseline')
    assert.deepEqual(figures.incoming, { rows: 16, withCall: 15, duplicates: 1, completed: 0 }, 'incoming baseline')
    ok(true, 'Incoming ledger matches the frozen baseline')
    ok(before.management.totals.submitted === before.funnel.reduce((n, f) => n + f.submitted, 0) + before.management.totals.independentSubmissions,
      'Allocated submissions agree between the department funnel and the management report')

    /* ---------------- C. Call-to-school mapping (Phase 1) ---------------- */
    const mapping = await import('../src/lib/fundingDept/callSchoolMapping')
    const { saveDeptSettings } = await import('../src/lib/fundingDept/settings')
    const mappings = () => db.$queryRaw<Array<{ call_id: string; school_id: string; source: string; tier: string | null; is_active: boolean; is_origin: boolean; mapped_at: Date }>>(
      Prisma.sql`SELECT * FROM dsr_call_school_mappings WHERE tenant_id=${fx.tenantId}`)
    const mapped = (rows: Awaited<ReturnType<typeof mappings>>, callId: string) => rows.filter(r => r.call_id === callId && r.is_active).map(r => r.school_id).sort()
    const { eng, med, sci, art } = fx.schools
    for (const call of Object.values(fx.calls)) await mapping.mapCallToSchools(call.id)
    let rows = await mappings()
    ok(JSON.stringify(mapped(rows, fx.calls.three.id)) === JSON.stringify([eng.id, med.id, sci.id].sort()), 'A call classified into three schools’ areas maps to all three, with no faculty match anywhere')
    ok(mapped(rows, fx.calls.unclassified.id).length === 0, 'An unclassified call creates no school responsibilities')
    ok(rows.find(r => r.call_id === fx.calls.dup.id && r.school_id === eng.id)?.source === 'ORIGIN' && rows.filter(r => r.call_id === fx.calls.dup.id).length === 1, 'The origin school is mapped once, as origin, however many times the call arrived')
    ok(rows.find(r => r.call_id === fx.calls.broadKeyword.id)?.tier === 'keyword' && mapped(rows, fx.calls.broadOnly.id).length === 0, 'A broad+keyword call maps by keyword while broad mapping is off; broad-only does not map')
    ok(!rows.some(r => r.school_id === art.id), 'A school with no research areas or keywords receives no mappings')
    ok(rows.length === 14, `Fixture maps 14 school responsibilities (got ${rows.length})`)
    ok((await Promise.all(Object.values(fx.calls).map(c => mapping.mapCallToSchools(c.id)))).flat().length === 0, 'Re-running the mapper adds nothing')
    const events = await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int n FROM dsr_events WHERE tenant_id=${fx.tenantId} AND entity_type='MAPPING' AND kind='MAPPED'`)
    ok(events[0].n === 14, 'Every mapping wrote exactly one audit event')

    // Routing: off until the department switches it on.
    const visible = async (schoolId: string, extra: Record<string, unknown> = {}) =>
      (await report({ schoolIds: [schoolId], ...extra })).members.flatMap(m => m.schools.flatMap(s => s.calls.map(c => c.id)))
    ok(!(await visible(sci.id)).includes(fx.calls.three.id), 'With routing off, the mapped-but-unmatched call stays out of the queue')
    await saveDeptSettings(fx.tenantId, { callMappingRoutingEnabled: true })
    const sciCalls = await visible(sci.id)
    ok([fx.calls.three.id, fx.calls.closingSoon.id, fx.calls.expiredIdle.id].every(id => sciCalls.includes(id)), 'With routing on, a relevant school sees the call before any faculty match')
    const sciDesk = await report({ schoolIds: [sci.id], mode: 'pending', includeExpired: false })
    ok(sciDesk.workbench.some(w => w.callId === fx.calls.closingSoon.id) && !sciDesk.workbench.some(w => w.schoolId !== sci.id), 'The Science coordinator’s desk carries the closing-soon call and nothing from other schools')
    ok((await visible(eng.id)).includes(fx.calls.broadKeyword.id) && !(await visible(eng.id)).includes(fx.calls.broadOnly.id), 'Engineering sees the keyword call but not the broad-only one')

    // Add-only reclassification.
    await db.fundingCallResearchAreaTaxonomy.deleteMany({ where: { funding_call_id: fx.calls.three.id, taxonomy_area_id: fx.areas.pharm.id } })
    await mapping.mapCallToSchools(fx.calls.three.id)
    rows = await mappings()
    ok(mapped(rows, fx.calls.three.id).includes(med.id), 'Reclassification never removes an existing mapping')
    await assert.rejects(() => mapping.endCallSchoolMapping(fx.tenantId, fx.calls.three.id, med.id, fx.users.head.id, '  '), /Say why/)
    await mapping.endCallSchoolMapping(fx.tenantId, fx.calls.three.id, med.id, fx.users.head.id, 'Pharmacology dropped from the call after correction')
    await mapping.mapCallToSchools(fx.calls.three.id)
    rows = await mappings()
    ok(!mapped(rows, fx.calls.three.id).includes(med.id) && rows.some(r => r.call_id === fx.calls.three.id && r.school_id === med.id && !r.is_active),
      'Only a head action with a reason ends a mapping; the ended row stays and the mapper does not revive it')
    await mapping.addCallSchoolMapping(fx.tenantId, fx.calls.broadOnly.id, art.id, fx.users.head.id, 'Design strand relevant to Arts')
    ok(mapped(await mappings(), fx.calls.broadOnly.id).includes(art.id), 'The head can add a school to a call by hand')

    // Broad mapping, when the department allows it.
    await saveDeptSettings(fx.tenantId, { mapBroadTier: true })
    await mapping.mapCallToSchools(fx.calls.broadOnly.id)
    ok((await mappings()).some(r => r.call_id === fx.calls.broadOnly.id && r.school_id === eng.id && r.tier === 'broad'), 'Broad matches map once the department switches broad mapping on')
    await saveDeptSettings(fx.tenantId, { mapBroadTier: false })

    // A school's profile change re-maps its open calls, add-only.
    await db.tenantOrgUnitResearchArea.create({ data: { tenant_id: fx.tenantId, org_unit_id: art.id, taxonomy_area_id: fx.areas.chem.id } })
    const added = await mapping.remapSchoolOpenCalls(fx.tenantId, [art.id])
    ok(added.length === 3 && added.every(r => r.schoolId === art.id) && !added.some(r => r.callId === fx.calls.expiredIdle.id),
      `A school gaining an area picks up its still-open calls only (got ${added.length})`)
    const audit = await db.$queryRaw<Array<{ kind: string; n: number }>>(Prisma.sql`SELECT kind, count(*)::int n FROM dsr_events WHERE tenant_id=${fx.tenantId} AND entity_type='MAPPING' GROUP BY kind ORDER BY kind`)
    ok(audit.find(a => a.kind === 'ENDED')?.n === 1 && audit.find(a => a.kind === 'ADDED_BY_HEAD')?.n === 1, 'Ending and adding by hand are both in the audit trail')

    /* ---------------- D. Review, submission and deadline states (Phase 2) ---------------- */
    const { ensureAllocationAction } = await import('../src/lib/fundingDept/managementActions')
    const { incomingCounts } = await import('../src/lib/fundingDept/incomingReport')
    let full = await report()
    const row = (r: typeof full, callId: string, schoolId: string) => r.members.flatMap(m => m.schools.flatMap(s => s.calls)).find(c => c.id === callId && c.schoolId === schoolId)!
    const reviewedRow = row(full, fx.calls.reviewed.id, eng.id)
    ok(reviewedRow.reviewState === 'REVIEWED_ALLOCATION_PENDING', 'A school that marked a call relevant without allocating is "reviewed, allocation pending"')
    ok(full.workbench.filter(w => w.callId === fx.calls.reviewed.id).every(w => w.responsibility.queue === 'ALLOCATION_PENDING'),
      'Its duty sits in its own "allocation pending" queue, not "completed"')
    const partial = row(full, fx.calls.partial.id, eng.id)
    ok(partial.submissionSummary.label === '1 of 3 submitted' && partial.allocations.map(a => a.submissionState).sort().join() === 'CLOSED_NO_SUBMISSION,NOT_SUBMITTED,SUBMITTED_UNVERIFIED',
      'Partial submission shows as "1 of 3 submitted", with each allocation’s own state')
    ok(partial.allocations.find(a => a.submissionState === 'SUBMITTED_UNVERIFIED')?.allocatedBy?.id === fx.users.deputy.id, 'Each allocation keeps the person who actually allocated it')
    const realloc = row(full, fx.calls.realloc.id, med.id)
    ok(realloc.allocations.length === 2 && realloc.allocations.some(a => a.submissionState === 'CLOSED_NO_SUBMISSION') && realloc.reviewState === 'ALLOCATED', 'A decline followed by reallocation shows both allocations, the call still allocated')
    const independent = row(full, fx.calls.independent.id, sci.id)
    ok(independent.allocations.length === 0 && independent.submissionSummary.independentSubmitted === 1 && independent.reviewState !== 'ALLOCATED', 'An independent application is a submission but not an allocation')
    ok(row(full, fx.calls.expiredIdle.id, sci.id).deadlineState === 'MISSED_NEVER_ALLOCATED' && row(full, fx.calls.expiredLive.id, eng.id).deadlineState === 'MISSED_ALLOCATED_NOT_SUBMITTED',
      'The two kinds of missed call are told apart')
    const headView = await report({ includeExpired: false, showMissed: true })
    ok(Boolean(row(headView, fx.calls.expiredIdle.id, sci.id)) && headView.attentionCounts.missedNeverAllocated >= 1 && headView.attentionCounts.missedAllocatedNotSubmitted >= 1,
      'The head sees both kinds of missed call with expired calls hidden')
    ok(!(await report({ includeExpired: false, showMissed: false })).members.flatMap(m => m.schools.flatMap(s => s.calls)).some(c => c.id === fx.calls.expiredIdle.id),
      'A coordinator’s expired toggle still hides an idle missed call')
    ok((await report({ attention: 'missed-never-allocated' })).members.flatMap(m => m.schools.flatMap(s => s.calls)).every(c => c.deadlineState === 'MISSED_NEVER_ALLOCATED'),
      'The "missed, never allocated" filter returns only those calls')

    // A review leaves a next action.
    await db.callSchoolTriage.create({ data: { tenant_id: fx.tenantId, org_unit_id: eng.id, funding_call_id: fx.calls.dup.id, status: 'RELEVANT', decided_at: new Date(), decided_by_user_id: fx.users.officerA.id } })
    const created = await ensureAllocationAction(fx.tenantId, eng.id, fx.calls.dup.id, fx.users.head.id) as { owner_user_id: string; due_at: Date } | null
    ok(created?.owner_user_id === fx.users.officerA.id && created.due_at.getTime() > Date.now(), 'A "relevant" review with no next action gets a dated one, owned by the school’s coordinator')
    ok(await ensureAllocationAction(fx.tenantId, eng.id, fx.calls.dup.id, fx.users.head.id) === null, 'A second review does not stack another action')

    // Intake: period, units and review state.
    const incomingAll = await getIncomingReport(fx.tenantId, undefined, { includeExpired: true, asOf: new Date() })
    const units = incomingCounts(incomingAll)
    ok(units.intakeEvents === 16 && units.uniqueCalls === 14 && units.duplicates === 1, `Intake reports events, unique calls and duplicates separately (${units.intakeEvents}/${units.uniqueCalls}/${units.duplicates})`)
    const dupRow = incomingAll.find(r => r.id.startsWith('import:'))!
    ok(dupRow.reviewState === 'REVIEWED_ALLOCATION_PENDING' && dupRow.actionClass === 'DSR_ACTION_REQUIRED', 'A reviewed intake is not "completed" until allocated or closed')
    const inPeriod = await getIncomingReport(fx.tenantId, undefined, { includeExpired: true, asOf: new Date(), start: new Date(fx.now.getTime() - 19 * DAY), end: new Date(Date.now() + 1) })
    ok(!inPeriod.some(r => r.id.startsWith('import:')) && inPeriod.some(r => r.id.startsWith('intake:')), 'The intake period filters on arrival date')

    // Changing ownership keeps the allocator and the history.
    await db.fundingDeptSchoolAssignment.deleteMany({ where: { tenant_id: fx.tenantId, org_unit_id: eng.id } })
    await db.fundingDeptSchoolAssignment.create({ data: { tenant_id: fx.tenantId, member_id: fx.members.mC.id, org_unit_id: eng.id, assigned_by_user_id: fx.users.head.id } })
    full = await report()
    const moved = row(full, fx.calls.partial.id, eng.id)
    ok(moved.coverage.responsible?.id === fx.users.officerC.id && moved.allocations.find(a => a.submissionState === 'SUBMITTED_UNVERIFIED')?.allocatedBy?.id === fx.users.deputy.id,
      'Changing the responsible coordinator keeps the earlier allocator')
    ok(await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int n FROM dsr_events WHERE tenant_id=${fx.tenantId} AND entity_type='OWNERSHIP' AND school_id=${eng.id} AND kind='DELETE'`).then(r => r[0].n >= 1),
      'The ownership change is in the audit trail')

    /* ---------------- E. Call Register, Mapping register, Audit trail (Phase 3) ---------------- */
    const reg = await import('../src/lib/fundingDept/callRegister')
    const mapReg = await import('../src/lib/fundingDept/mappingRegister')
    const auditTrail = await import('../src/lib/fundingDept/auditTrail')
    const { writeTables, definitionsSheet } = await import('../src/lib/fundingDept/managementExport')
    const asOf = new Date()
    const everything = await reg.getCallRegister(fx.tenantId, { asOf, all: true })
    const active = await db.$queryRaw<Array<{ calls: number; resp: number }>>(Prisma.sql`SELECT count(DISTINCT call_id)::int calls, count(*)::int resp FROM dsr_call_school_mappings WHERE tenant_id=${fx.tenantId} AND is_active`)
    ok(everything.totals.calls === active[0].calls && everything.totals.responsibilities === active[0].resp, `Register headline counts unique calls (${everything.totals.calls}) and school responsibilities (${everything.totals.responsibilities})`)
    const pages: string[] = []
    for (let p = 1; p <= Math.ceil(everything.total / 5); p++) pages.push(...(await reg.getCallRegister(fx.tenantId, { asOf, page: p, pageSize: 5 })).rows.map(r => r.callId))
    const exported = reg.registerExportTables(everything.rows)
    ok(pages.length === everything.total && new Set(pages).size === pages.length && exported[0].rows.length - 1 === everything.total
      && exported[1].rows.length - 1 === everything.totals.responsibilities, 'Register: headline = paged drill-down rows = export rows, with no duplicates')
    const threeRow = everything.rows.find(r => r.callId === fx.calls.three.id)!
    ok(threeRow.responsibilities.every(r => r.reviewState === 'NOT_REVIEWED') && !threeRow.schoolNames.includes('Medicine'), 'An ended mapping drops out of the Register; the rest show their own review state')
    ok(everything.rows.find(r => r.callId === fx.calls.partial.id)?.submissionLabel === '1 of 3 submitted', 'The Register’s collapsed row reads "1 of 3 submitted"')
    const sciOnly = await reg.getCallRegister(fx.tenantId, { asOf, all: true, scopeSchoolIds: [sci.id] })
    ok(sciOnly.rows.every(r => r.responsibilities.every(p => p.schoolId === sci.id)) && sciOnly.total > 0, 'A coordinator’s Register holds only their own schools')
    const pendingAlloc = await reg.getCallRegister(fx.tenantId, { asOf, all: true, reviewState: 'REVIEWED_ALLOCATION_PENDING' })
    ok(pendingAlloc.rows.some(r => r.callId === fx.calls.reviewed.id) && pendingAlloc.rows.every(r => r.responsibilities.every(p => p.reviewState === 'REVIEWED_ALLOCATION_PENDING')), 'Register review-state filter returns exactly those responsibilities')
    const missedNever = await reg.getCallRegister(fx.tenantId, { asOf, all: true, deadlineState: 'MISSED_NEVER_ALLOCATED' })
    ok(missedNever.rows.map(r => r.callId).includes(fx.calls.expiredIdle.id) && !missedNever.rows.some(r => r.callId === fx.calls.expiredLive.id), 'The "missed, never allocated" saved filter excludes allocated misses')
    const partlySubmitted = await reg.getCallRegister(fx.tenantId, { asOf, all: true, submission: 'PARTLY_SUBMITTED' })
    ok(partlySubmitted.rows.length === 1 && partlySubmitted.rows[0].callId === fx.calls.partial.id, 'Register submission filter finds the partly submitted call')
    await assert.rejects(() => reg.getCallRegister(fx.tenantId, { asOf, reviewState: 'DONE' }), /Unknown review state/)

    const overview = await reg.getOverview(fx.tenantId, { start: new Date(fx.now.getTime() - 90 * DAY), end: new Date(Date.now() + 1), asOf, untouchedDays: 7 })
    const notReviewed = await reg.getCallRegister(fx.tenantId, { asOf, all: true, reviewState: 'NOT_REVIEWED', start: new Date(fx.now.getTime() - 90 * DAY), end: new Date(Date.now() + 1) })
    const overdueRows = await reg.getCallRegister(fx.tenantId, { asOf, all: true, overdueActions: true })
    ok(overview.totals.reviewsPending === notReviewed.totals.responsibilities && overview.needsAttention.missedNeverAllocated === missedNever.totals.responsibilities
      && overview.needsAttention.overdueActions === overdueRows.totals.responsibilities,
      'Overview totals equal the Register rows they open')
    const future = await reg.getOverview(fx.tenantId, { start: new Date(Date.now() - DAY), end: new Date(Date.now() + 1), asOf, untouchedDays: 7 })
    ok(future.totals.callsMapped === 0 && JSON.stringify(future.needsAttention) === JSON.stringify(overview.needsAttention), 'A period filter changes period totals but never hides "needs attention now"')
    ok(overview.schools.reduce((n, s) => n + s.responsibilities, 0) === overview.totals.responsibilities, 'The coordinator-by-school table adds up to the headline')

    const mappedTab = await mapReg.getMappedCalls(fx.tenantId, { all: true })
    ok(mappedTab.total === (await mappings()).length && mappedTab.rows.some(r => !r.is_active && r.ended_reason), 'Mapping register lists every mapping, ended ones with their reason')
    const queue = await mapReg.getUnclassifiedQueue(fx.tenantId, { all: true })
    ok(queue.rows.filter(r => r.id === fx.calls.unclassified.id).length === 1 && queue.total === queue.rows.length, 'An unclassified call appears exactly once in the Unclassified queue')
    const gaps = await mapReg.getSchoolRoutingGaps(fx.tenantId)
    ok(gaps.some(g => g.id === art.id && g.nextAction === 'Assign coverage'), 'A mapped school with no coordinator shows as a head action: assign coverage')

    const trail = await auditTrail.getAuditTrail(fx.tenantId, { callId: fx.calls.three.id, all: true })
    ok(trail.rows.some(r => r.kind === 'ENDED' && r.reason) && trail.rows.filter(r => r.kind === 'MAPPED').length >= 3 && trail.total === trail.rows.length, 'Audit trail shows who mapped and who ended a responsibility, and why')
    const scopedTrail = await auditTrail.getAuditTrail(fx.tenantId, { scopeSchoolIds: [sci.id], all: true })
    ok(scopedTrail.rows.every(r => r.school_id === sci.id), 'A coordinator’s audit trail holds only their schools')
    const timelineEvents = await auditTrail.departmentEventsForCall(fx.tenantId, fx.calls.three.id)
    const { buildTimeline } = await import('../src/lib/fundingDept/callTimeline')
    const empty = { followUps: [], candidates: [], assignments: [], documents: [], milestones: [], notifications: [], proposalEvents: [] }
    ok(buildTimeline({ ...empty, departmentEvents: timelineEvents }).events.some(e => e.kind === 'DEPARTMENT' && /ended/.test(e.title)), 'The call timeline carries the department audit events')
    const xlsx = writeTables([definitionsSheet({ report: 'Call register', snapshot: 'test' }), ...exported], 'xlsx')
    ok(xlsx instanceof Uint8Array && xlsx.length > 1000, 'The Register exports as a stamped workbook')

    // Backfill dry run on a second tenant that never had the writer.
    const fresh = await buildReportingFixture(db, 'backfill')
    const plan = await mapping.planBackfill(fresh.tenantId)
    if (PRINT) console.log(plan.bySource, plan.rows.map(r => `${r.source} ${r.callId.slice(-5)} ${r.schoolId.slice(-5)} ${r.mappedAt.toISOString()}`))
    ok(plan.bySource.ORIGIN === 1 && plan.bySource.RECONSTRUCTED_FROM_WORK === 7 && plan.bySource.INGESTION_DIRECT === 4 && plan.bySource.INGESTION_KEYWORD === 1 && plan.rows.length === 13,
      `Backfill dry run reports its counts by source (${JSON.stringify(plan.bySource)})`)
    const callCreated = new Map((await db.fundingCall.findMany({ where: { tenantId: fresh.tenantId }, select: { id: true, createdAt: true } })).map(c => [c.id, c.createdAt.getTime()]))
    ok(plan.rows.filter(r => r.source === 'RECONSTRUCTED_FROM_WORK').every(r => r.mappedAt.getTime() !== callCreated.get(r.callId)),
      'No reconstructed row is dated with the call’s intake date')
    ok(plan.rows.filter(r => r.source.startsWith('INGESTION_')).every(r => r.backfilled && r.reason.endsWith('(mapped at backfill)')), 'Rows relevant today are labelled as mapped at backfill')
    ok(await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int n FROM dsr_call_school_mappings WHERE tenant_id=${fresh.tenantId}`).then(r => r[0].n === 0), 'A dry run writes nothing')
    await mapping.writeMappings(plan.rows)
    ok((await mapping.planBackfill(fresh.tenantId)).rows.length === 0, 'Applying the backfill twice adds nothing the second time')

    console.log(`Verified ${count()} DSR reporting assertions.`)
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
