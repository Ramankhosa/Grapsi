/**
 * What each tenant's funding department counts as late.
 *
 * Seven days of an unallocated call is a pendency at one institution and normal
 * at another, because the two run on different agency calendars and different
 * staffing. These numbers were constants in the source — correct defaults, but
 * the wrong place for a policy an office has to be able to argue about and set.
 *
 * Deliberately NOT the plan-entitlement system, which answers "has this tenant
 * paid for the grant reviewer" and is set by the platform. Deliberately not the
 * proposal-desk settings either: those describe which stages an office runs,
 * these describe when it considers itself behind.
 *
 * Every default equals the constant it replaced, so a tenant that never opens
 * the screen sees no change whatsoever.
 */
import prisma from '@/lib/prisma'

import { SILENT_DAYS, UNANSWERED_DAYS, UNTOUCHED_DAYS } from './accountabilityProgress'

export interface DeptSettings {
  // --- When work is late ---------------------------------------------------
  /** Days a relevant call may sit unallocated before it is a pendency. */
  untouchedDays: number
  /** Days live work may go with no contact before it has gone quiet. */
  silentDays: number
  /** Days an unanswered request may sit before the faculty member is chased. */
  unansweredDays: number
  /** Days from entering the system that a first touch is expected inside. */
  firstTouchTargetDays: number
  /** Days with no allocation before a faculty member reads as dormant. */
  facultyDormantDays: number

  // --- The pendency ladder -------------------------------------------------
  /** Chase the covering officer about unallocated calls at all. */
  pendencyEscalationEnabled: boolean
  /** Further days past the officer's notice before the head is told. */
  escalateToHeadAfterDays: number
  /** Tell the tenant's administrators when the head's notice also went unanswered. */
  escalateToAdmin: boolean
  /** Further days past the head's notice before the administrators are told. */
  escalateToAdminAfterDays: number

  // --- Reporting -----------------------------------------------------------
  /** Write the weekly snapshot that gives every figure a direction of travel. */
  weeklySnapshotsEnabled: boolean
  /**
   * Share of decided calls dismissed as not relevant, above which the rate is
   * flagged. The cheapest way to empty a queue is to call everything irrelevant,
   * and nothing else in the system would notice.
   */
  dismissalRateWarnPct: number

  // --- Call-to-school mapping ---------------------------------------------
  /**
   * Route calls to a school's coordinator from the stored call-to-school
   * mapping, not only from faculty matches and recorded work. Off until the
   * department head has reviewed the backfill dry run, so no school wakes up
   * to a sudden backlog.
   */
  callMappingRoutingEnabled: boolean
  /**
   * Also map calls that share only a broad discipline group with a school.
   * Off by default: a broad match floods queues with calls nobody will take.
   */
  mapBroadTier: boolean
}

export const DEFAULT_DEPT_SETTINGS: DeptSettings = {
  untouchedDays: UNTOUCHED_DAYS,
  silentDays: SILENT_DAYS,
  unansweredDays: UNANSWERED_DAYS,
  firstTouchTargetDays: 3,
  facultyDormantDays: 90,
  pendencyEscalationEnabled: true,
  escalateToHeadAfterDays: 7,
  escalateToAdmin: true,
  escalateToAdminAfterDays: 7,
  weeklySnapshotsEnabled: true,
  dismissalRateWarnPct: 40,
  callMappingRoutingEnabled: false,
  mapBroadTier: false,
}

/** The booleans a tenant admin can flip, for the settings screen and the API. */
export const DEPT_TOGGLES = [
  'pendencyEscalationEnabled',
  'escalateToAdmin',
  'weeklySnapshotsEnabled',
  'callMappingRoutingEnabled',
  'mapBroadTier',
] as const
export type DeptToggle = (typeof DEPT_TOGGLES)[number]

/** The numbers a tenant admin can set. Bounds below. */
export const DEPT_NUMBERS = [
  'untouchedDays',
  'silentDays',
  'unansweredDays',
  'firstTouchTargetDays',
  'facultyDormantDays',
  'escalateToHeadAfterDays',
  'escalateToAdminAfterDays',
  'dismissalRateWarnPct',
] as const
export type DeptNumber = (typeof DEPT_NUMBERS)[number]

const BOUNDS: Record<DeptNumber, [number, number]> = {
  untouchedDays: [1, 90],
  silentDays: [1, 180],
  unansweredDays: [1, 60],
  firstTouchTargetDays: [1, 60],
  facultyDormantDays: [7, 1095],
  escalateToHeadAfterDays: [1, 90],
  escalateToAdminAfterDays: [1, 90],
  dismissalRateWarnPct: [5, 100],
}

export const DEPT_SETTING_COPY: Record<DeptToggle | DeptNumber, { label: string; help: string }> = {
  untouchedDays: {
    label: 'Days before an unallocated call is a pendency',
    help: 'A relevant, open call nobody has been put on and nobody has logged contact about. Raise this if your office works to a longer cycle.',
  },
  silentDays: {
    label: 'Days of silence before live work has gone quiet',
    help: 'An accepted application nobody has recorded anything about. Work on the proposal itself counts as contact, so a researcher uploading drafts is never silent.',
  },
  unansweredDays: {
    label: 'Days to wait for a reply before chasing',
    help: 'How long a request may sit unanswered before it reaches the chase queue. A request sent this morning is never held against anyone.',
  },
  firstTouchTargetDays: {
    label: 'Days a new call should be looked at within',
    help: 'Used to report how quickly each officer reacts to a call arriving in their schools. It triggers no notices on its own.',
  },
  facultyDormantDays: {
    label: 'Days before a faculty member reads as dormant',
    help: 'Somebody in a covered school who has been sent nothing for this long. People who cannot be matched at all are reported separately, because that is a data gap rather than neglect.',
  },
  pendencyEscalationEnabled: {
    label: 'Chase unallocated calls automatically',
    help: 'Notifies the covering officer about relevant calls nobody has taken up. Turn this off to leave the backlog to the reports alone.',
  },
  escalateToHeadAfterDays: {
    label: 'Days before the department head is told',
    help: 'Counted from the officer’s notice, not from the call arriving.',
  },
  escalateToAdmin: {
    label: 'Escalate to administrators',
    help: 'When the head’s notice also went unanswered, tell the organisation’s administrators. Turn this off if the department head is the last word.',
  },
  escalateToAdminAfterDays: {
    label: 'Days before administrators are told',
    help: 'Counted from the head’s notice.',
  },
  weeklySnapshotsEnabled: {
    label: 'Keep weekly history',
    help: 'Records each school’s numbers once a week so reports can show whether a backlog is growing or clearing. Turn this off to keep live figures only.',
  },
  callMappingRoutingEnabled: {
    label: 'Route calls by school relevance',
    help: 'Put every call mapped to a school into its coordinator’s queue as soon as it is classified, even before any researcher is matched. Review the mapping register with the head before turning this on.',
  },
  mapBroadTier: {
    label: 'Also map broad discipline matches',
    help: 'Map calls that share only a broad discipline group with a school. Leave off unless schools say they are missing calls; it widens every queue.',
  },
  dismissalRateWarnPct: {
    label: 'Dismissal rate that gets flagged (%)',
    help: 'Share of decided calls an officer marked not relevant. Set this high if your schools genuinely receive many calls outside their disciplines.',
  },
}

function clampInt(value: unknown, fallback: number, bounds: [number, number]): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), bounds[0]), bounds[1])
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Read whatever is stored and return a complete, valid settings object.
 *
 * Never throws and never returns a partial. A half-written column degrades to
 * the defaults rather than leaving a sweep to discover mid-run that
 * `untouchedDays` is undefined and interpolate it into an interval literal.
 */
export function normalizeDeptSettings(raw: unknown): DeptSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const next = { ...DEFAULT_DEPT_SETTINGS }
  for (const key of DEPT_NUMBERS) {
    next[key] = clampInt(source[key], DEFAULT_DEPT_SETTINGS[key], BOUNDS[key])
  }
  for (const key of DEPT_TOGGLES) {
    next[key] = bool(source[key], DEFAULT_DEPT_SETTINGS[key])
  }
  return next
}

export async function getDeptSettings(tenantId: string): Promise<DeptSettings> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { dept_settings: true },
  })
  if (!tenant) return DEFAULT_DEPT_SETTINGS
  return normalizeDeptSettings(tenant.dept_settings)
}

export async function saveDeptSettings(
  tenantId: string,
  patch: Partial<DeptSettings>
): Promise<DeptSettings> {
  const current = await getDeptSettings(tenantId)
  const next = normalizeDeptSettings({ ...current, ...patch })
  await prisma.tenant.update({ where: { id: tenantId }, data: { dept_settings: next as any } })
  return next
}

/**
 * Settings for many tenants at once, for the sweeps — which run across every
 * tenant and would otherwise read the same row once per call.
 */
export async function getDeptSettingsFor(tenantIds: string[]): Promise<Map<string, DeptSettings>> {
  const rows = await prisma.tenant.findMany({
    where: { id: { in: Array.from(new Set(tenantIds)) } },
    select: { id: true, dept_settings: true },
  })
  const map = new Map<string, DeptSettings>()
  for (const row of rows) map.set(row.id, normalizeDeptSettings(row.dept_settings))
  return map
}

/** The subset `computeFlags` takes, so callers need not reshape it by hand. */
export function flagThresholdsFrom(settings: DeptSettings) {
  return { untouchedDays: settings.untouchedDays, silentDays: settings.silentDays }
}
