import { describe, expect, it } from 'vitest'

import { classifyEngagement } from '@/lib/fundingDept/facultyEngagementService'

/**
 * Where one faculty member stands with the department.
 *
 * The UNREACHABLE rule carries the weight here. It decides whether a name lands
 * on an officer worklist or an administrator one, and getting it wrong sends
 * officers to chase people the system cannot route a call to in the first place.
 */

const base = { everAssigned: 0, assignedInWindow: 0, live: 0, hasAreas: true, activated: true }

describe('faculty engagement classification', () => {
  it('names somebody who has never been sent a single call', () => {
    expect(classifyEngagement(base).code).toBe('NEVER_ASSIGNED')
  })

  it('separates unreachable from neglected, and says which gap it is', () => {
    // Both are an administrator problem, not a chase, so neither may be
    // reported as an officer failing to approach somebody.
    const noAreas = classifyEngagement({ ...base, hasAreas: false })
    expect(noAreas.code).toBe('UNREACHABLE')
    expect(noAreas.unreachable).toEqual({ noAreas: true, neverActivated: false })

    const dormantAccount = classifyEngagement({ ...base, activated: false })
    expect(dormantAccount.code).toBe('UNREACHABLE')
    expect(dormantAccount.unreachable).toEqual({ noAreas: false, neverActivated: true })

    const both = classifyEngagement({ ...base, hasAreas: false, activated: false })
    expect(both.unreachable).toEqual({ noAreas: true, neverActivated: true })
  })

  it('stops calling somebody unreachable once the department has reached them', () => {
    // A profile can lose its areas after the fact. Somebody who has held an
    // allocation was plainly reachable, and reclassifying them as a data gap
    // would quietly excuse whatever happened next.
    const reached = classifyEngagement({
      ...base,
      hasAreas: false,
      activated: false,
      everAssigned: 2,
    })
    expect(reached.code).not.toBe('UNREACHABLE')
  })

  it('counts anything sent inside the window as engaged', () => {
    expect(
      classifyEngagement({ ...base, everAssigned: 1, assignedInWindow: 1 }).code
    ).toBe('ENGAGED')
  })

  it('treats live work as engagement even when it was delegated before the window', () => {
    // Somebody carrying an application right now is not dormant, whatever the
    // date filter says.
    expect(classifyEngagement({ ...base, everAssigned: 3, live: 1 }).code).toBe('ENGAGED')
  })

  it('calls somebody dormant only when nothing is live and nothing came this period', () => {
    expect(classifyEngagement({ ...base, everAssigned: 4 }).code).toBe('DORMANT')
  })
})
