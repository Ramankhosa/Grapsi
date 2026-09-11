/**
 * Chasing the calls nobody has taken up.
 *
 * Every other sweep in this module chases an allocation: a deadline approaching,
 * a request unanswered, an obligation due. All of them presuppose that somebody
 * was put on the call. The failure nobody was chasing is the one before that — a
 * relevant call arrives, sits in a school queue, and closes. It appeared on a
 * dashboard the whole time, which is not the same as anyone being told.
 *
 * Three rungs, because one was not enough and four would be noise:
 *
 *   OFFICER  the covering officer, at the tenant's untouched threshold
 *   HEAD     the department head, if it is still sitting there a week later
 *   ADMIN    the organisation administrators, a week after that
 *
 * Each rung fires exactly once per (call, school). The lock IS
 * `call_school_triage.escalation_stages`, appended by a guarded UPDATE that only
 * matches when the stage is absent — the same claim-then-act convention
 * `auto_nudge_stages` uses, so two overlapping hourly sweeps cannot both send.
 *
 * The sweep has to CREATE the triage row to hold that stamp, since by definition
 * nobody has triaged the call. That is safe only because `untouchedSql` tests
 * `decided_at IS NULL` rather than row existence: under the old row-existence
 * rule this sweep would have silently cleared the very backlog it reports.
 *
 * One notification per recipient per run, naming every call, rather than one per
 * call. Six separate emails about six calls is how a ladder teaches people to
 * filter it into a folder they never open.
 */
import { sendEmail } from '@/lib/mailer'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { resolveActivityWindow } from './accountabilityService'
import { getUnallocatedBacklog, type BacklogCall } from './pendencyService'
import { getDeptSettingsFor, type DeptSettings } from './settings'
import { isMemberAway } from './shared'

export const ESCALATION_STAGES = ['OFFICER', 'HEAD', 'ADMIN'] as const
export type EscalationStage = (typeof ESCALATION_STAGES)[number]

/** Prefix on every notification this ladder writes, for the timeline to spot. */
export const PENDENCY_NOTICE_PREFIX = 'Unallocated calls'

export interface PendencyEscalationResult {
  tenants: number
  callsConsidered: number
  /** Rungs claimed, by stage. A rung claimed is a rung whose notice was sent. */
  claimed: Record<EscalationStage, number>
  alreadyClaimed: number
  noticesSent: number
  /** Notices that went to a deputy because the officer is on leave. */
  reroutedToDeputy: number
  skippedDisabled: number
  emailFailed: number
}

function emptyResult(): PendencyEscalationResult {
  return {
    tenants: 0,
    callsConsidered: 0,
    claimed: { OFFICER: 0, HEAD: 0, ADMIN: 0 },
    alreadyClaimed: 0,
    noticesSent: 0,
    reroutedToDeputy: 0,
    skippedDisabled: 0,
    emailFailed: 0,
  }
}

type LadderSettings = Pick<
  DeptSettings,
  'untouchedDays' | 'escalateToHeadAfterDays' | 'escalateToAdminAfterDays' | 'escalateToAdmin'
>

/** The rungs, in order, with the age each becomes eligible at. */
function ladderFor(settings: LadderSettings): Array<{ stage: EscalationStage; days: number; gap: number }> {
  const ladder: Array<{ stage: EscalationStage; days: number; gap: number }> = [
    { stage: 'OFFICER', days: settings.untouchedDays, gap: 0 },
    {
      stage: 'HEAD',
      days: settings.untouchedDays + settings.escalateToHeadAfterDays,
      gap: settings.escalateToHeadAfterDays,
    },
  ]
  if (settings.escalateToAdmin) {
    ladder.push({
      stage: 'ADMIN',
      days:
        settings.untouchedDays + settings.escalateToHeadAfterDays + settings.escalateToAdminAfterDays,
      gap: settings.escalateToAdminAfterDays,
    })
  }
  return ladder
}

/**
 * Which rung fires next for this call, or null for none.
 *
 * The LOWEST eligible rung that has not fired, not the highest. That is the
 * opposite of the deadline ladder, which takes `.filter(...).pop()` to get the
 * most urgent window, and the difference is the whole point: a deadline nudge is
 * a statement about a date, so the most urgent one is the only one worth sending.
 * A rung here is a statement about who has already been told, so sending ADMIN
 * first would assert two notices that were never sent.
 *
 * That was not hypothetical. Anchored to age alone, the first sweep after this
 * shipped escalated a 48-day-old backlog straight to the administrators under the
 * words "after both the officer and the department head were told".
 *
 * Walking in order needs a brake, or the ladder would climb all three rungs in
 * three consecutive hourly sweeps. `lastEscalatedAt` is that brake: each rung
 * also waits its own configured gap after the previous one actually fired.
 */
export function stageFor(
  daysWaiting: number,
  settings: LadderSettings,
  state: { claimed?: readonly string[]; lastEscalatedAt?: Date | string | null } = {},
  now: Date = new Date()
): EscalationStage | null {
  const claimed = new Set(state.claimed ?? [])
  const lastAt = state.lastEscalatedAt ? new Date(state.lastEscalatedAt) : null
  const daysSinceLast = lastAt
    ? Math.floor((now.getTime() - lastAt.getTime()) / 86400000)
    : null

  for (const rung of ladderFor(settings)) {
    if (claimed.has(rung.stage)) continue
    if (daysWaiting < rung.days) return null
    // A rung above the first waits its gap after the previous notice went out.
    // A missing timestamp on an already-claimed ladder means the row predates
    // this column, and the gap is unknowable — so it is treated as satisfied
    // rather than blocking the ladder forever.
    if (rung.gap > 0 && claimed.size > 0 && daysSinceLast !== null && daysSinceLast < rung.gap) {
      return null
    }
    return rung.stage
  }
  return null
}

/**
 * Claim one rung for one (call, school).
 *
 * Upserts the triage row with no `decided_at`, so creating it does not count as
 * anybody having looked at the call. Returns true only for the caller that won
 * the race, which is the caller that owes the notice.
 */
async function claimStage(
  tenantId: string,
  callId: string,
  orgUnitId: string,
  stage: EscalationStage
): Promise<boolean> {
  // Create-if-absent first, deliberately not in the same statement as the claim:
  // ON CONFLICT DO NOTHING means a row that already exists keeps its status, its
  // note and its decision, which a blind upsert would overwrite with NEW.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO call_school_triage (id, tenant_id, funding_call_id, org_unit_id, status, created_at, updated_at)
    VALUES (${`esc_${callId}_${orgUnitId}`.slice(0, 64)}, ${tenantId}, ${callId}, ${orgUnitId}, 'NEW', now(), now())
    ON CONFLICT (funding_call_id, org_unit_id) DO NOTHING
  `)

  const claimed = await prisma.$executeRaw(Prisma.sql`
    UPDATE call_school_triage
       SET escalation_stages = array_append(escalation_stages, ${stage}),
           last_escalated_at = now(),
           updated_at = now()
     WHERE funding_call_id = ${callId}
       AND org_unit_id = ${orgUnitId}
       AND NOT (${stage} = ANY(escalation_stages))
  `)
  return claimed === 1
}

/** Who hears about this rung, and why that is the right set of people. */
async function recipientsFor(
  tenantId: string,
  stage: EscalationStage,
  call: BacklogCall,
  now: Date
): Promise<{ userIds: string[]; rerouted: boolean }> {
  if (stage === 'OFFICER') {
    const officerUserId = call.officer?.userId ?? null
    // Nobody covers the school, or the officer is away. Either way the notice
    // skips straight past a rung that would reach no one: a backlog in an
    // uncovered school is the head problem from the first day, not the eighth.
    if (!officerUserId) {
      const head = await prisma.fundingDeptMember.findFirst({
        where: { tenant_id: tenantId, is_head: true, is_active: true },
        select: { user_id: true },
      })
      return { userIds: head ? [head.user_id] : [], rerouted: false }
    }
    const officer = await prisma.fundingDeptMember.findFirst({
      where: { tenant_id: tenantId, user_id: officerUserId },
      select: { away_from: true, away_until: true },
    })
    if (officer && isMemberAway(officer, now)) {
      const deputy = await prisma.fundingDeptSchoolAssignment.findFirst({
        where: {
          tenant_id: tenantId,
          org_unit_id: call.schoolId,
          is_deputy: true,
          member: { is_active: true },
        },
        select: { member: { select: { user_id: true } } },
      })
      const deputyUserId = deputy?.member?.user_id
      // The officer is still told, so they are not surprised on their return;
      // the deputy is told because they are the one who can act this week.
      if (deputyUserId && deputyUserId !== officerUserId) {
        return { userIds: [officerUserId, deputyUserId], rerouted: true }
      }
    }
    return { userIds: [officerUserId], rerouted: false }
  }

  if (stage === 'HEAD') {
    const head = await prisma.fundingDeptMember.findFirst({
      where: { tenant_id: tenantId, is_head: true, is_active: true },
      select: { user_id: true },
    })
    return { userIds: head ? [head.user_id] : [], rerouted: false }
  }

  const admins = await prisma.user.findMany({
    where: { tenantId, roles: { hasSome: ['OWNER', 'ADMIN'] } },
    select: { id: true },
    take: 20,
  })
  return { userIds: admins.map((row) => row.id), rerouted: false }
}

const STAGE_COPY: Record<EscalationStage, (count: number, school: string) => string> = {
  OFFICER: (count, school) =>
    `${count === 1 ? 'A relevant call has' : `${count} relevant calls have`} been sitting in ${school} with nobody on them.`,
  HEAD: (count, school) =>
    `${count === 1 ? 'A relevant call in' : `${count} relevant calls in`} ${school} ${count === 1 ? 'is' : 'are'} still unallocated after the covering officer was told.`,
  ADMIN: (count, school) =>
    `${count === 1 ? 'A relevant call in' : `${count} relevant calls in`} ${school} ${count === 1 ? 'remains' : 'remain'} unallocated after both the officer and the department head were told.`,
}

function describe(calls: BacklogCall[]) {
  return calls
    .slice(0, 8)
    .map((call) => {
      const closes = call.closesAt
        ? ` — closes ${new Date(call.closesAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          })}`
        : ''
      return `• ${call.title || 'Untitled call'} (${call.daysWaiting} days waiting${closes})`
    })
    .join('\n')
}

/**
 * One tenant's pendency ladder.
 *
 * Reuses `getUnallocatedBacklog`, which means the sweep chases exactly the rows
 * the report shows. A separate query here would eventually chase a different set
 * from the one a head is looking at, and nobody would be able to say which was
 * right.
 */
async function sweepTenant(
  tenantId: string,
  settings: DeptSettings,
  now: Date,
  result: PendencyEscalationResult
): Promise<void> {
  if (!settings.pendencyEscalationEnabled) {
    result.skippedDisabled += 1
    return
  }

  const window = await resolveActivityWindow(tenantId, 'reporting', now)
  const backlog = await getUnallocatedBacklog(tenantId, {
    window,
    schoolIds: [],
    settings,
    now,
  })
  result.callsConsidered += backlog.calls.length

  // Grouped by (recipient set, school, stage) so one officer receives one notice
  // naming every call rather than one notice per call.
  const batches = new Map<string, { stage: EscalationStage; school: string; calls: BacklogCall[] }>()

  for (const call of backlog.calls) {
    const stage = stageFor(
      call.daysWaiting,
      settings,
      { claimed: call.escalated, lastEscalatedAt: call.lastEscalatedAt },
      now
    )
    if (!stage) continue
    if (call.escalated.includes(stage)) {
      result.alreadyClaimed += 1
      continue
    }
    const won = await claimStage(tenantId, call.callId, call.schoolId, stage)
    if (!won) {
      result.alreadyClaimed += 1
      continue
    }
    result.claimed[stage] += 1

    const key = `${stage}:${call.schoolId}`
    const existing = batches.get(key)
    if (existing) existing.calls.push(call)
    else batches.set(key, { stage, school: call.schoolName, calls: [call] })
  }

  for (const batch of batches.values()) {
    const { userIds, rerouted } = await recipientsFor(tenantId, batch.stage, batch.calls[0], now)
    if (rerouted) result.reroutedToDeputy += 1
    if (userIds.length === 0) continue

    const title = `${PENDENCY_NOTICE_PREFIX} in ${batch.school}`
    const body = `${STAGE_COPY[batch.stage](batch.calls.length, batch.school)}\n\n${describe(batch.calls)}`

    try {
      await notifyQuietly({
        tenantId,
        userIds,
        title,
        body,
        category: 'DEADLINE',
        linkUrl: '/funding-dept/accountability?tab=backlog',
      })
      result.noticesSent += 1
    } catch (error) {
      console.warn('Pendency escalation: in-app notice failed', error)
    }

    // Email only at the rungs where somebody is being told about somebody else
    // work. An officer reads their own worklist; a head and an administrator are
    // being interrupted precisely because the normal channel did not work.
    if (batch.stage !== 'OFFICER') {
      const recipients = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { email: true },
      })
      for (const recipient of recipients) {
        if (!recipient.email) continue
        try {
          await sendEmail({
            to: recipient.email,
            subject: title,
            text: body,
            html: `<p>${STAGE_COPY[batch.stage](batch.calls.length, batch.school)}</p><pre style="font-family:inherit">${describe(batch.calls)}</pre>`,
          })
        } catch (error) {
          result.emailFailed += 1
          console.warn('Pendency escalation: email failed', error)
        }
      }
    }
  }
}

export async function sweepPendencyEscalations(
  options: { now?: Date; tenantId?: string } = {}
): Promise<PendencyEscalationResult> {
  const now = options.now ?? new Date()
  const result = emptyResult()

  // Only tenants that actually staff a funding department. Without a member
  // there is nobody for the first rung to tell, and the sweep would spend its
  // budget computing backlogs nobody asked for.
  const tenantRows = await prisma.fundingDeptMember.findMany({
    where: { is_active: true, ...(options.tenantId ? { tenant_id: options.tenantId } : {}) },
    select: { tenant_id: true },
    distinct: ['tenant_id'],
  })
  const tenantIds = tenantRows.map((row) => row.tenant_id)
  result.tenants = tenantIds.length
  if (tenantIds.length === 0) return result

  const settingsByTenant = await getDeptSettingsFor(tenantIds)

  for (const tenantId of tenantIds) {
    try {
      await sweepTenant(tenantId, settingsByTenant.get(tenantId)!, now, result)
    } catch (error) {
      // One tenant bad data must not stop the sweep for the rest: this runs
      // hourly across every tenant, and a throw here means nobody is chased.
      console.warn(`Pendency escalation failed for tenant ${tenantId}`, error)
    }
  }

  return result
}
