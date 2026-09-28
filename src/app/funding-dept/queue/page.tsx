import { redirect } from 'next/navigation'

/**
 * "My schools' calls" now lives in DSR reports → Incoming Calls, one row per
 * call across all your schools. Old links (notifications, the department
 * overview) keep their school.
 */
export default function FundingDeptQueuePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const school = typeof searchParams.orgUnitId === 'string' ? searchParams.orgUnitId : ''
  const state = typeof searchParams.state === 'string' ? searchParams.state : ''
  const params = new URLSearchParams({ tab: 'incoming' })
  if (school) params.set('schoolId', school)
  if (state === 'pending') params.set('action', 'NOT_STARTED')
  if (state === 'dismissed' || state === 'all') params.set('includeExpired', 'true')
  redirect(`/funding-dept/reports?${params}`)
}
