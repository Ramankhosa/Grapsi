import type { FundingIntakeBatchStatus, FundingIntakeJobStatus } from './types'

const ACTIVE_JOB_STATUSES = new Set<FundingIntakeJobStatus>(['queued', 'fetching', 'extracting'])
export const FUNDING_INTAKE_JOB_STATUS_KEYS: FundingIntakeJobStatus[] = [
  'queued',
  'fetching',
  'extracting',
  'needs_review',
  'draft_created',
  'failed',
  'canceled',
]

export function buildFundingIntakeJobStatusCounts(
  jobStatuses: FundingIntakeJobStatus[]
): Record<FundingIntakeJobStatus, number> {
  const counts = Object.fromEntries(
    FUNDING_INTAKE_JOB_STATUS_KEYS.map((status) => [status, 0])
  ) as Record<FundingIntakeJobStatus, number>

  for (const status of jobStatuses) {
    counts[status] = (counts[status] || 0) + 1
  }

  return counts
}

export function deriveFundingIntakeBatchStatus(
  jobStatuses: FundingIntakeJobStatus[]
): FundingIntakeBatchStatus {
  if (jobStatuses.some((status) => ACTIVE_JOB_STATUSES.has(status))) {
    return 'processing'
  }

  if (jobStatuses.length === 0) {
    return 'completed'
  }

  const failedCount = jobStatuses.filter((status) => status === 'failed').length
  const canceledCount = jobStatuses.filter((status) => status === 'canceled').length

  if (canceledCount === jobStatuses.length) {
    return 'canceled'
  }

  if (failedCount === jobStatuses.length) {
    return 'failed'
  }

  if (failedCount > 0 || canceledCount > 0) {
    return 'partially_failed'
  }

  if (jobStatuses.some((status) => status === 'needs_review')) {
    return 'needs_review'
  }

  return 'completed'
}
