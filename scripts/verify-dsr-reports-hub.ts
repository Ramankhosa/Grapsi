/**
 * DSR Reports hub — end-to-end checks in a disposable local database.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/verify-dsr-reports-hub.ts
 *
 * A. The new definitions (action status, pendency, qualifying match, India
 *    weeks) agree between SQL and TypeScript.
 * B. Incoming Calls: which calls reach which schools, open vs expired, action
 *    status and the manual completion mark.
 * C. Pendency: only strong/moderate automatic matches with nobody allocated;
 *    unallocating puts a call back; a coordinator closure is listed, not counted.
 * D. Assigned Calls and Follow-ups, and the reconciliation between reports.
 *
 * Built on the DSR reporting fixture; no mailers, notifications or AI calls.
 */
import { checker, withDisposableDb } from './lib/disposableDb'
import { buildReportingFixture } from './lib/dsrReportingFixture'

const DAY = 86400000

async function main() {
  await withDisposableDb(async ({ db, applied }) => {
    console.log(`Clone has ${applied.length} migration(s) the dev database lacks: ${applied.join(', ') || 'none'}`)
    const { ok, count } = checker()
    const { Prisma } = await import('../src/lib/prisma-generated')
    const defs = await import('../src/lib/fundingDept/reportDefinitions')
    const { getIncomingCalls } = await import('../src/lib/fundingDept/incomingCalls')
    const { getPendency } = await import('../src/lib/fundingDept/pendencyReport')
    const { getAssignedCalls } = await import('../src/lib/fundingDept/assignedCalls')
    const { getFollowUpReport } = await import('../src/lib/fundingDept/followUpReport')
    const { utcTimestamp } = await import('../src/lib/fundingDept/callSql')

    /* ---------------- A. SQL and TypeScript agree ---------------- */
    {
      const rows: Array<Record<string, unknown>> = []
      for (const completed of [null, '2026-09-20T10:00:00.000Z']) for (const decided of [null, '2026-09-19T10:00:00.000Z'])
        for (const shortlisted of [0, 1]) for (const allocations of [0, 2]) for (const followUps of [0, 1]) for (const namedActions of [0, 1])
          rows.push({ i: rows.length, completed, decided, shortlisted, allocations, followUps, namedActions })
      const sql = await db.$queryRaw<Array<{ i: number; s: string }>>(Prisma.sql`
        SELECT i, ${defs.actionStatusSql({ actionCompletedAt: 'r.completed', triageDecidedAt: 'r.decided', shortlisted: 'r.shortlisted', allocations: 'r.allocations', followUps: 'r."followUps"', namedActions: 'r."namedActions"' })} s
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(i int, completed text, decided text, shortlisted int, allocations int, "followUps" int, "namedActions" int)`)
      ok(sql.length === rows.length && sql.every(r => { const x = rows[r.i] as any
        return r.s === defs.actionStatus({ ...x, actionCompletedAt: x.completed, triageDecidedAt: x.decided }) }), `Action status: SQL and TypeScript agree on all ${rows.length} combinations`)

      const pend: Array<Record<string, unknown>> = []
      for (const days of [null, -3, 0, 14, 15, 40]) for (const matches of [0, 1]) for (const takenUp of [0, 1]) for (const independent of [0, 1])
        for (const dismissed of [false, true]) for (const completed of [false, true])
          pend.push({ i: pend.length, days, matches, takenUp, independent, dismissed, completed })
      const sqlPend = await db.$queryRaw<Array<{ i: number; s: string | null }>>(Prisma.sql`
        SELECT i, ${defs.pendencyStateSql({ daysToDeadline: 'r.days', qualifyingMatches: 'r.matches', takenUpAllocations: 'r."takenUp"', independentApplications: 'r.independent', dismissed: 'r.dismissed', actionCompleted: 'r.completed' })} s
          FROM jsonb_to_recordset(${JSON.stringify(pend)}::jsonb) AS r(i int, days int, matches int, "takenUp" int, independent int, dismissed boolean, completed boolean)`)
      ok(sqlPend.length === pend.length && sqlPend.every(r => { const x = pend[r.i] as any
        return r.s === defs.pendencyState({ daysToDeadline: x.days, qualifyingMatches: x.matches, takenUpAllocations: x.takenUp, independentApplications: x.independent, dismissed: x.dismissed, actionCompleted: x.completed }) }),
        `Pendency state: SQL and TypeScript agree on all ${pend.length} combinations`)

      const times = ['2026-09-27T18:00:00.000Z', '2026-09-27T18:31:00.000Z', '2026-09-25T06:00:00.000Z', '2026-09-21T00:00:00.000Z', '2026-09-20T18:29:00.000Z', '2026-01-04T20:00:00.000Z']
      const weeks = await db.$queryRaw<Array<{ t: string; w: Date }>>(Prisma.sql`SELECT t, ${defs.indiaWeekStartSql("(t::timestamptz AT TIME ZONE 'UTC')")} w FROM unnest(${times}::text[]) t`)
      ok(weeks.every(r => r.w.toISOString().slice(0, 10) === defs.indiaWeekStart(r.t)), `India week start: SQL and TypeScript agree on ${times.length} boundary instants`)

      const matches: Array<Record<string, unknown>> = []
      for (const inferred of [false, true]) for (const sv of ['person-call-census-v1', 'manual-allocation-v1', null]) for (const tier of ['strong', 'moderate', 'weak', null])
        for (const seen of ['2026-09-09T18:00:00.000Z', '2026-09-09T19:00:00.000Z']) for (const deadline of [null, '2026-09-09T00:00:00.000Z'])
          matches.push({ i: matches.length, inferred, sv, tier, seen, deadline })
      const sqlMatch = await db.$queryRaw<Array<{ i: number; q: boolean }>>(Prisma.sql`
        SELECT i, ${defs.qualifyingMatchSql('m', 'm.dl')} q FROM (
          SELECT i, inferred, sv source_version, tier match_tier, (seen::timestamptz AT TIME ZONE 'UTC') first_seen_at, (deadline::timestamptz AT TIME ZONE 'UTC') dl
            FROM jsonb_to_recordset(${JSON.stringify(matches)}::jsonb) AS r(i int, inferred boolean, sv text, tier text, seen text, deadline text)) m`)
      ok(sqlMatch.length === matches.length && sqlMatch.every(r => { const x = matches[r.i] as any
        return Boolean(r.q) === defs.isQualifyingMatch({ inferred: x.inferred, source_version: x.sv, match_tier: x.tier, first_seen_at: x.seen }, x.deadline) }),
        `Qualifying match: SQL and TypeScript agree on all ${matches.length} combinations`)
    }

    /* ---------------- Fixture ---------------- */
    const fx = await buildReportingFixture(db, 'hub')
    const { tenantId, now, calls, schools, users, allocations } = fx
    const at = (days: number) => new Date(now.getTime() + days * DAY)
    const match = (callId: string, user: { id: string }, school: { id: string }, tier: string, extra: { inferred?: boolean; sv?: string; seen?: Date } = {}) =>
      db.$executeRaw(Prisma.sql`INSERT INTO funding_opportunity_matches(id,tenant_id,funding_call_id,user_id,org_unit_id,school_id,match_score,match_tier,match_reason,source,source_version,inferred,is_current,refreshed_at,first_seen_at,last_seen_at,created_at,updated_at)
        VALUES (${`m-${callId}-${user.id}`},${tenantId},${callId},${user.id},${school.id},${school.id},0.8,${tier},'fixture','matching',${extra.sv ?? 'person-call-census-v1'},${extra.inferred ?? false},true,
          ${utcTimestamp(now)},${utcTimestamp(extra.seen ?? at(-6))},${utcTimestamp(now)},${utcTimestamp(now)},${utcTimestamp(now)})`)
    const { eng, med, sci } = schools
    await match(calls.closingSoon.id, users.fC1, sci, 'strong')          // AT_RISK in Science
    await match(calls.expiredIdle.id, users.fC1, sci, 'moderate', { seen: at(-10) }) // MISSED in Science
    await match(calls.three.id, users.fA1, eng, 'weak')                  // weak: never pendency, never incoming by match
    await match(calls.partial.id, users.fA2, eng, 'strong')              // allocated: not pendency
    await match(calls.realloc.id, users.fB1, med, 'strong')              // live reallocation: not pendency
    await match(calls.independent.id, users.fC1, sci, 'strong')          // independent application: not pendency
    await match(calls.notRelevant.id, users.fB2, med, 'strong')          // dismissed: not pendency
    await match(calls.broadOnly.id, users.fA3, eng, 'strong', { inferred: true })       // reconstructed: ignored
    await match(calls.future.id, users.fB2, med, 'strong', { sv: 'manual-allocation-v1' }) // manual snapshot: ignored
    await match(calls.reviewed.id, users.fA1, eng, 'strong')             // PENDING in Engineering (25 days left)
    await db.$executeRaw(Prisma.sql`INSERT INTO dsr_call_school_mappings(tenant_id,call_id,school_id,source,tier,reason) VALUES (${tenantId},${calls.dup.id},${eng.id},'INGESTION_DIRECT','direct','Mechanical')`)

    const allSchools = [eng.id, med.id, sci.id, schools.art.id]
    // Mark every fixture school's match projection fresh, so the reports don't queue
    // a background re-match (which would rewrite the fixture's matches).
    for (const id of allSchools) await db.$executeRaw(Prisma.sql`INSERT INTO dsr_match_projection_state(tenant_id,school_id,fingerprint,complete,unprofiled,refreshed_at)
      VALUES (${tenantId},${id},'fixture',true,'[]'::jsonb,${utcTimestamp(new Date(Date.now() + DAY))})`)
    const officerA = [eng.id, med.id]
    const asOf = new Date()
    const base = { asOf, page: 1, pageSize: 50 }

    /* ---------------- B. Incoming Calls ---------------- */
    {
      const open = await getIncomingCalls(tenantId, { ...base, schoolIds: allSchools })
      const ids = new Set(open.rows.map(r => r.callId))
      const expected = [calls.closingSoon, calls.partial, calls.realloc, calls.independent, calls.notRelevant, calls.reviewed, calls.dup].map(c => c.id)
      ok(open.total === 7 && expected.every(id => ids.has(id)), `Incoming: 7 open calls reach a school by mapping or strong/moderate match (got ${open.total})`)
      ok(!ids.has(calls.three.id) && !ids.has(calls.broadOnly.id) && !ids.has(calls.future.id), 'Incoming: weak, reconstructed and manual-snapshot matches do not bring a call in')
      ok(!ids.has(calls.expiredIdle.id), 'Incoming: expired calls are hidden by default')
      const withExpired = await getIncomingCalls(tenantId, { ...base, schoolIds: allSchools, includeExpired: true })
      ok(withExpired.total === 8 && withExpired.rows.some(r => r.callId === calls.expiredIdle.id), 'Incoming: "Include expired" adds the expired call')
      const status = (id: string) => open.rows.find(r => r.callId === id)?.actionStatus
      ok(status(calls.closingSoon.id) === 'NOT_STARTED' && status(calls.dup.id) === 'NOT_STARTED' && status(calls.independent.id) === 'NOT_STARTED', 'Incoming: untouched calls are Not started')
      ok(status(calls.partial.id) === 'IN_PROGRESS' && status(calls.reviewed.id) === 'IN_PROGRESS' && status(calls.notRelevant.id) === 'IN_PROGRESS', 'Incoming: an allocation or a review decision is In progress, not Completed')
      ok(open.summary.notStarted === 3 && open.summary.openCalls === 7, `Incoming summary: 3 not started of 7 open (got ${open.summary.notStarted}/${open.summary.openCalls})`)
      const notStarted = await getIncomingCalls(tenantId, { ...base, schoolIds: allSchools, action: 'NOT_STARTED' })
      ok(notStarted.total === open.summary.notStarted, 'Incoming: the Not started tile equals the rows it filters to')
      const dupRow = open.rows.find(r => r.callId === calls.dup.id)!
      ok(dupRow.schools.length === 1 && dupRow.schools[0].sources.includes('INGESTION_DIRECT'), 'Incoming: a mapped call shows its school and route')
      const scoped = await getIncomingCalls(tenantId, { ...base, schoolIds: [sci.id] })
      ok(scoped.rows.every(r => r.schools.every(s => s.schoolId === sci.id)) && scoped.total === 2, `Incoming: a Science-only scope sees only Science (got ${scoped.total})`)

      // The manual mark, as the action-status route writes it.
      await db.$executeRaw(Prisma.sql`INSERT INTO call_school_triage(id,tenant_id,funding_call_id,org_unit_id,status,decided_at,decided_by_user_id,action_completed_at,action_completed_by_user_id,action_completed_note,created_at,updated_at)
        VALUES ('t-mark',${tenantId},${calls.closingSoon.id},${sci.id},'NEW',${utcTimestamp(now)},${users.officerC.id},${utcTimestamp(now)},${users.officerC.id},'Circulated; nobody available',${utcTimestamp(now)},${utcTimestamp(now)})`)
      const done = await getIncomingCalls(tenantId, { ...base, schoolIds: allSchools, action: 'COMPLETED' })
      ok(done.total === 1 && done.rows[0].callId === calls.closingSoon.id && done.rows[0].schools[0].completed?.note === 'Circulated; nobody available', 'Incoming: the manual mark completes the call, with its note')
      const closing = await getIncomingCalls(tenantId, { ...base, schoolIds: allSchools, action: 'NOT_COMPLETED', closingWithin: 7 })
      ok(!closing.rows.some(r => r.callId === calls.closingSoon.id), 'Incoming: a completed call leaves "Closing in 7 days, not completed"')
    }

    /* ---------------- C. Pendency ---------------- */
    {
      const all = await getPendency(tenantId, { ...base, schoolIds: allSchools, state: 'all' })
      const by = (id: string, school: string) => all.rows.find(r => r.callId === id && r.school.id === school)?.state
      ok(by(calls.expiredIdle.id, sci.id) === 'MISSED', 'Pendency: a matched call that closed with nobody allocated is Missed')
      ok(by(calls.reviewed.id, eng.id) === 'PENDING', 'Pendency: an open matched call with nobody allocated is Pending, even after a review')
      ok(by(calls.closingSoon.id, sci.id) === 'COMPLETED_NO_ALLOCATION', 'Pendency: a coordinator closure without allocation is listed separately')
      ok(all.total === 3, `Pendency: exactly 3 pairs qualify (got ${all.total}: ${all.rows.map(r => r.title).join(', ')})`)
      ok(all.summary.missed === 1 && all.summary.pending === 1 && all.summary.atRisk === 0 && all.summary.completedNoAllocation === 1, `Pendency summary ${JSON.stringify(all.summary)}`)
      const counted = await getPendency(tenantId, { ...base, schoolIds: allSchools })
      ok(counted.total === 2, 'Pendency: the default view counts missed + at risk + pending only')
      const officerC = all.members.find(m => m.coordinatorId === users.officerC.id)
      const officerAMember = all.members.find(m => m.coordinatorId === users.officerA.id)
      ok(officerC?.missed === 1 && officerAMember?.pending === 1, 'Pendency: each pair is charged to its school\'s responsible coordinator')
      const aOnly = await getPendency(tenantId, { ...base, schoolIds: officerA })
      ok(aOnly.total === 1 && aOnly.rows[0].callId === calls.reviewed.id, 'Pendency: a member sees only their own schools')

      // Allocate, then unallocate: the call leaves pendency and comes back.
      const a = await db.callAssignment.create({ data: { tenant_id: tenantId, funding_call_id: calls.reviewed.id, assignee_user_id: users.fA1.id, assigned_by_user_id: users.officerA.id, assignee_org_unit_id: eng.id, status: 'ASSIGNED' } })
      ok(!(await getPendency(tenantId, { ...base, schoolIds: officerA })).rows.some(r => r.callId === calls.reviewed.id), 'Pendency: allocating clears it')
      await db.callAssignment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } })
      ok((await getPendency(tenantId, { ...base, schoolIds: officerA })).rows.some(r => r.callId === calls.reviewed.id), 'Pendency: unallocating puts it back')
      await db.callAssignment.delete({ where: { id: a.id } })

      const missedRegister = await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int n FROM funding_calls fc WHERE fc."tenantId"=${tenantId} AND COALESCE(fc.close_date, fc."deadlineAt") < now()
          AND EXISTS (SELECT 1 FROM funding_opportunity_matches m WHERE m.funding_call_id=fc.id AND ${defs.qualifyingMatchSql('m', 'COALESCE(fc.close_date, fc."deadlineAt")')})
          AND NOT EXISTS (SELECT 1 FROM call_assignments ca WHERE ca.funding_call_id=fc.id)`)
      ok(missedRegister[0].n === all.summary.missed, 'Reconcile: Pendency Missed = expired calls with a direct match and no allocation at all')
    }

    /* ---------------- D. Assigned Calls and Follow-ups ---------------- */
    {
      const active = await getAssignedCalls(tenantId, { ...base, schoolIds: allSchools })
      ok(active.total === 5 && active.summary.active === 5, `Assigned: 5 active allocations (got ${active.total})`)
      const every = await getAssignedCalls(tenantId, { ...base, schoolIds: allSchools, status: 'all' })
      ok(every.total === 7, `Assigned: 7 allocations in all states (got ${every.total})`)
      const incoming = await getIncomingCalls(tenantId, { ...base, schoolIds: allSchools, callId: calls.partial.id })
      const forCall = await getAssignedCalls(tenantId, { ...base, schoolIds: allSchools, status: 'all', callId: calls.partial.id })
      ok(incoming.rows[0].allocations === forCall.total && forCall.total === 3, 'Reconcile: Incoming "allocated" = Assigned Calls rows for that call')
      const byMe = await getAssignedCalls(tenantId, { ...base, schoolIds: allSchools, status: 'all', assignedByUserId: users.deputy.id })
      ok(byMe.total === 1, '"Allocated by me" narrows to the allocator')
      const medOnly = await getAssignedCalls(tenantId, { ...base, schoolIds: [med.id], status: 'all' })
      ok(medOnly.rows.every(r => r.school.id === med.id) && medOnly.total === 3, 'Assigned: scope follows the assignee\'s school')

      const log = (assignmentId: string | null, author: { id: string }, kind: string, target: string, when: Date, callId?: string, unit?: string) =>
        db.$executeRaw(Prisma.sql`INSERT INTO assignment_follow_ups(id,tenant_id,assignment_id,funding_call_id,org_unit_id,created_by_user_id,kind,contact_target,note,happened_at,created_at,updated_at)
          VALUES (${`f-${Math.random().toString(36).slice(2)}`},${tenantId},${assignmentId},${callId ?? null},${unit ?? null},${author.id},${kind},${target},'fixture',${utcTimestamp(when)},${utcTimestamp(when)},${utcTimestamp(when)})`)
      await log(allocations.partialDrafting.id, users.officerA, 'CALL', 'FACULTY', now, calls.partial.id, eng.id)
      await log(allocations.reallocLive.id, users.officerA, 'NOTE', 'INTERNAL', at(-7), calls.realloc.id, med.id)
      await log(null, users.officerC, 'EMAIL', 'FACULTY', now, calls.closingSoon.id, sci.id)
      await log(null, users.officerA, 'TRIAGE', 'INTERNAL', now, calls.reviewed.id, eng.id)
      const report = await getFollowUpReport(tenantId, { ...base, schoolIds: allSchools, weeks: 4 })
      const A = report.members.find(m => m.userId === users.officerA.id)!, C = report.members.find(m => m.userId === users.officerC.id)!
      ok(A.total.followUps === 2 && A.total.facultyContacts === 1 && C.total.followUps === 1, `Follow-ups: counted by author, TRIAGE excluded (A ${A.total.followUps}, C ${C.total.followUps})`)
      ok(report.logTotal === 3, 'Follow-ups: the log has the same 3 entries the totals count')
      const week = report.weeks[report.weeks.length - 1]
      // Officer A owns every live ENG and MED allocation (5); one was followed up this week.
      ok(A.weeks[week].active === 5 && A.weeks[week].touched === 1 && A.weeks[week].silent === 4, `Follow-ups: this week officer A has 1 of 5 followed up (got ${JSON.stringify(A.weeks[week])})`)
      const silent = await getAssignedCalls(tenantId, { ...base, schoolIds: allSchools, silent: true })
      ok(silent.total === 4, `Reconcile: Assigned "silent 7+ days" = 4 (got ${silent.total})`)
      const onlyC = await getFollowUpReport(tenantId, { ...base, schoolIds: allSchools, weeks: 4, memberUserId: users.officerC.id })
      ok(onlyC.members.every(m => m.userId === users.officerC.id) && onlyC.logTotal === 1, 'Follow-ups: the member filter shows only that member')
      const effort = report.effort.find(e => e.assignmentId === allocations.partialDrafting.id)!
      ok(effort.facultyContacts === 1 && effort.daysToFirstContact !== null && effort.perWeek[week] === 1, 'Follow-ups: effort by allocation records the contact trail')

      // A logged reminder is a follow-up (glossary): in the member total, the headline and the log alike.
      await log(allocations.reallocLive.id, users.officerA, 'REMINDER', 'INTERNAL', now, calls.realloc.id, med.id)
      const withReminder = await getFollowUpReport(tenantId, { ...base, asOf: new Date(), schoolIds: allSchools, weeks: 4 })
      const A2 = withReminder.members.find(m => m.userId === users.officerA.id)!
      ok(A2.total.followUps === 3 && A2.total.reminders === 1, `Follow-ups: a reminder counts as a follow-up and is broken out (got ${A2.total.followUps}/${A2.total.reminders})`)
      ok(withReminder.totals.followUps === withReminder.logTotal, `Follow-ups: headline = log entries (${withReminder.totals.followUps} vs ${withReminder.logTotal})`)
      const allocationTotal = withReminder.effort.find(e => e.assignmentId === allocations.reallocLive.id)!.followUps
      ok(allocationTotal === 2, `Follow-ups: the allocation row counts the reminder too (got ${allocationTotal})`)
    }

    /* ---------------- E. Tiles open their own rows; ownership and time ---------------- */
    {
      const { NO_OWNER } = await import('../src/lib/fundingDept/followUpReport')
      const { members } = fx
      // Two submissions (this month and 40 days ago, the older one past its internal deadline).
      const done = (callId: string, days: number, extra: Record<string, unknown> = {}) => db.callAssignment.create({ data: { tenant_id: tenantId, funding_call_id: callId,
        assignee_user_id: users.fA3.id, assigned_by_user_id: users.officerA.id, assignee_org_unit_id: eng.id, status: 'COMPLETED', created_at: at(days - 5),
        submitted_at: at(days), completed_at: at(days), ...extra } })
      const recent = await done(calls.dup.id, 0), old = await done(calls.three.id, -40, { deadline_at: at(-45) })
      const fresh = { ...base, asOf: new Date() }
      const tiles = await getAssignedCalls(tenantId, { ...fresh, schoolIds: allSchools })
      const month = await getAssignedCalls(tenantId, { ...fresh, schoolIds: allSchools, status: 'submitted', submittedIn: 'month' })
      const allTime = await getAssignedCalls(tenantId, { ...fresh, schoolIds: allSchools, status: 'submitted' })
      ok(month.total === tiles.summary.submittedThisMonth && month.rows.some(r => r.id === recent.id) && !month.rows.some(r => r.id === old.id),
        `Assigned: "Submitted this month" opens exactly its ${tiles.summary.submittedThisMonth} row(s) (got ${month.total})`)
      ok(allTime.total > month.total, 'Assigned: the Submitted status still lists every submission')
      const overdueAll = await getAssignedCalls(tenantId, { ...fresh, schoolIds: allSchools, status: 'all', due: 'overdue' })
      ok(overdueAll.total === tiles.summary.overdue && !overdueAll.rows.some(r => r.id === old.id),
        `Assigned: a submitted allocation is never "overdue", whatever the status filter (${overdueAll.total} vs tile ${tiles.summary.overdue})`)
      await db.callAssignment.deleteMany({ where: { id: { in: [recent.id, old.id] } } })

      // A per-call transfer to the ENG deputy: Pendency charges it to them, and the head's member filter opens it.
      await db.$executeRaw(Prisma.sql`INSERT INTO dsr_responsibility_transfers(tenant_id,school_id,call_id,owner_user_id,reason)
        VALUES (${tenantId},${eng.id},${calls.reviewed.id},${users.deputy.id},'Covering while A is away')`)
      const moved = await getPendency(tenantId, { ...fresh, schoolIds: allSchools })
      ok(moved.members.find(m => m.coordinatorId === users.deputy.id)?.pending === 1 && !moved.members.some(m => m.coordinatorId === users.officerA.id && m.pending > 0),
        'Pendency: a transferred call is charged to the transfer owner')
      const drill = await getPendency(tenantId, { ...fresh, schoolIds: allSchools, coordinatorUserId: users.deputy.id })
      ok(drill.total === 1 && drill.rows[0].callId === calls.reviewed.id, 'Pendency: the member drill-down opens exactly the calls that member is charged with')
      const incomingOwner = async () => (await getIncomingCalls(tenantId, { ...fresh, schoolIds: [eng.id], callId: calls.reviewed.id })).rows[0]?.schools[0]?.coordinator?.id
      ok(await incomingOwner() === users.deputy.id, 'Incoming: the transfer owner is the coordinator')
      // Once the owner leaves the department the transfer no longer counts (the Overview's rule).
      await db.fundingDeptMember.update({ where: { id: members.mDep.id }, data: { is_active: false } })
      const lapsed = await getPendency(tenantId, { ...fresh, schoolIds: allSchools })
      ok(lapsed.members.find(m => m.coordinatorId === users.officerA.id)?.pending === 1 && await incomingOwner() === users.officerA.id,
        'Pendency and Incoming: a transfer to an inactive member falls back to the primary coordinator')
      await db.fundingDeptMember.update({ where: { id: members.mDep.id }, data: { is_active: true } })
      await db.$executeRaw(Prisma.sql`DELETE FROM dsr_responsibility_transfers WHERE tenant_id=${tenantId}`)

      // An allocation in a school nobody covers (ART) still counts as active and silent.
      const artWork = await db.callAssignment.create({ data: { tenant_id: tenantId, funding_call_id: calls.dup.id, assignee_user_id: users.fC1.id,
        assigned_by_user_id: users.head.id, assignee_org_unit_id: schools.art.id, status: 'ASSIGNED', created_at: at(-2) } })
      // A decline 20 days ago, edited today: it stopped being owed follow-up when the faculty member replied.
      const declined = await db.callAssignment.create({ data: { tenant_id: tenantId, funding_call_id: calls.dup.id, assignee_user_id: users.fA2.id,
        assigned_by_user_id: users.officerA.id, assignee_org_unit_id: eng.id, status: 'DECLINED', created_at: at(-30), responded_at: at(-20) } })
      const cover = await getFollowUpReport(tenantId, { ...base, asOf: new Date(), schoolIds: allSchools, weeks: 4 })
      const current = cover.weeks[cover.weeks.length - 1], previous = cover.weeks[cover.weeks.length - 2]
      const unowned = cover.members.find(m => m.userId === NO_OWNER)
      ok(unowned?.weeks[current].active === 1 && unowned.weeks[current].silent === 1, 'Follow-ups: an allocation in a school with no coordinator is counted under "No coordinator"')
      ok(cover.totals.silentThisWeek === cover.effort.filter(e => e.silentThisWeek).length,
        `Follow-ups: "Silent this week" = the silent allocations listed (${cover.totals.silentThisWeek} vs ${cover.effort.filter(e => e.silentThisWeek).length})`)
      const before = cover.members.find(m => m.userId === users.officerA.id)!.weeks[previous].active
      await db.callAssignment.delete({ where: { id: declined.id } })
      const without = await getFollowUpReport(tenantId, { ...base, asOf: new Date(), schoolIds: allSchools, weeks: 4 })
      ok(without.members.find(m => m.userId === users.officerA.id)!.weeks[previous].active === before,
        'Follow-ups: a declined allocation is not counted as active after the faculty member declined')
      await db.callAssignment.delete({ where: { id: artWork.id } })
    }

    console.log(`\nAll ${count()} checks passed.`)
  })
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
