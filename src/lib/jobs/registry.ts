/**
 * Every scheduled job, in one place.
 *
 * There used to be two hand-maintained lists that had to agree by convention:
 * the key array the console API queried, and the card array the console page
 * rendered. They drifted, as two lists always do — three of the eight scheduled
 * jobs had no card, so nothing on that screen said the proposal sweep, the
 * review-recovery sweep and the source-monitor sweep had never run. Production's
 * scheduler was dead for months and the operations console showed green.
 *
 * So: one registry, read by the API for its keys and by the page for its cards,
 * and a unit test that fails if a `withJobRun` call site or a scheduler entry
 * appears without a matching row here.
 *
 * `expectedIntervalMinutes` is what makes staleness checkable. It is the cadence
 * the scheduler actually fires at, not an aspiration — a job quiet for much
 * longer than its own interval is either failing or not being fired at all, and
 * both are worth saying out loud.
 */

export interface JobDefinition {
  /** Matches the `jobKey` passed to `withJobRun` at the route. */
  jobKey: string
  label: string
  description: string
  /** Human cadence, for the card. */
  cadence: string
  /** POSTed directly by the console's run-now button, with the caller's bearer token. */
  endpoint: string
  body?: Record<string, unknown>
  /** How often the scheduler fires this, in minutes. Drives the staleness badge. */
  expectedIntervalMinutes: number
}

const HOUR = 60
const DAY = 24 * HOUR

export const JOB_REGISTRY: JobDefinition[] = [
  {
    jobKey: 'reminders-sweep',
    label: 'Reminder sweep',
    description:
      'Due follow-up reminders, the D30/D14/D7/D1 and no-acknowledgement nudge ladder, the unallocated-call pendency ladder, and the job health check.',
    cadence: 'Hourly at :05',
    endpoint: '/api/funding-dept/reminders/sweep',
    expectedIntervalMinutes: HOUR,
  },
  {
    jobKey: 'alerts-dispatch',
    label: 'Alert dispatch',
    description: 'Healing sweep: funding-match alerts for published calls never dispatched.',
    cadence: 'Hourly at :20',
    endpoint: '/api/funding/alerts/dispatch',
    expectedIntervalMinutes: HOUR,
  },
  {
    jobKey: 'proposal-reviews-sweep',
    label: 'Proposal review recovery',
    description:
      'Resumes AI review runs stranded by a crash or a deploy, so a researcher is never left waiting on a run that died.',
    cadence: 'Every 10 minutes',
    endpoint: '/api/proposals/reviews/sweep',
    expectedIntervalMinutes: 10,
  },
  {
    jobKey: 'proposals-sweep',
    label: 'Proposal desk sweep',
    description:
      'Internal cut-off nudges, the review service level, and agency-silence checks on submitted proposals.',
    cadence: 'Hourly at :40',
    endpoint: '/api/proposals/sweep',
    expectedIntervalMinutes: HOUR,
  },
  {
    jobKey: 'alerts-digest-daily',
    label: 'Daily alert digest',
    description: 'Bundles queued alerts into one email per user on a daily frequency.',
    cadence: 'Daily at digest hour :35',
    endpoint: '/api/funding/alerts/digest',
    body: { frequency: 'daily' },
    expectedIntervalMinutes: DAY,
  },
  {
    jobKey: 'alerts-digest-weekly',
    label: 'Weekly alert digest',
    description: 'Bundles queued alerts for users on a weekly frequency.',
    cadence: 'Mondays at digest hour :35',
    endpoint: '/api/funding/alerts/digest',
    body: { frequency: 'weekly' },
    expectedIntervalMinutes: 7 * DAY,
  },
  {
    jobKey: 'reports-weekly',
    label: 'Department weekly reports',
    description:
      'Writes the weekly school snapshot, then sends the worklist digest to each funding-department member and the rollup to the head.',
    cadence: 'Mondays at digest hour :35',
    endpoint: '/api/funding-dept/reports/weekly',
    expectedIntervalMinutes: 7 * DAY,
  },
  {
    jobKey: 'event-user-expiry',
    label: 'Event-user expiry',
    description:
      'Suspends EVENT/workshop users past their access window and revokes their refresh tokens.',
    cadence: 'Daily at digest hour :50',
    endpoint: '/api/platform/users/expire-event-access',
    expectedIntervalMinutes: DAY,
  },
  {
    // Dot-separated, unlike every other key here. Left alone deliberately: the
    // route already writes run history under this name, and renaming it would
    // orphan that history for no reader-visible gain.
    jobKey: 'funding.monitor.sweep',
    label: 'Source watch sweep',
    description:
      'Re-checks monitored funder pages and queues what changed for review. Politeness-paced, and picks up where it left off when it runs out of time.',
    cadence: 'Daily at monitor hour :10',
    endpoint: '/api/funding/monitor/sweep',
    expectedIntervalMinutes: DAY,
  },
]

export const JOB_KEYS = JOB_REGISTRY.map((job) => job.jobKey)

export function jobDefinition(jobKey: string): JobDefinition | undefined {
  return JOB_REGISTRY.find((job) => job.jobKey === jobKey)
}

/**
 * How much later than its own cadence a job may be before it is called stale.
 *
 * Generous on purpose. The scheduler fires on a minute gate rather than a precise
 * clock, a long run can push the next one late, and a badge that cries wolf is a
 * badge people learn to ignore. Three times the interval plus an hour of slack
 * catches a genuinely dead job without flagging a merely late one.
 */
export const STALENESS_FACTOR = 3
export const STALENESS_SLACK_MINUTES = 60

export function stalenessLimitMs(job: JobDefinition): number {
  return (job.expectedIntervalMinutes * STALENESS_FACTOR + STALENESS_SLACK_MINUTES) * 60_000
}

export type JobHealth = 'ok' | 'stale' | 'never'

/**
 * Whether a job looks alive, given when it last succeeded.
 *
 * `never` is its own answer rather than a flavour of stale, because the two have
 * different causes and different fixes: stale means a job that used to work has
 * stopped, never means nobody has ever fired it — which is precisely the state
 * production was in while the console showed nothing at all.
 */
export function jobHealth(job: JobDefinition, lastSuccessAt: Date | string | null): JobHealth {
  if (!lastSuccessAt) return 'never'
  const at = new Date(lastSuccessAt).getTime()
  if (Number.isNaN(at)) return 'never'
  return Date.now() - at > stalenessLimitMs(job) ? 'stale' : 'ok'
}
