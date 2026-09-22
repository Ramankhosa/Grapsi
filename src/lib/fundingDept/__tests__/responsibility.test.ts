import { describe, expect, it } from 'vitest'
import { isExpiredInIndia, resolveResponsibility } from '../responsibility'

const asOf = new Date('2026-09-22T10:00:00+05:30')

describe('role workbench responsibility resolver', () => {
  it('keeps the whole India deadline day active', () => {
    expect(isExpiredInIndia('2026-09-22T00:00:00Z', asOf)).toBe(false)
    expect(isExpiredInIndia('2026-09-21T23:59:00+05:30', asOf)).toBe(true)
  })

  it('puts an overdue named action first while preserving waiting-with', () => {
    const result = resolveResponsibility({
      responsibilityType: 'MATCHED_FOLLOW_UP', asOf, matchingComplete: true,
      actions: [{ title: 'Chase response', owner_user_id: 'u1', waiting_with: 'FACULTY', status: 'OPEN', due_at: '2026-09-20T10:00:00+05:30' }],
    })
    expect(result.queue).toBe('ACTION_OVERDUE')
    expect(result.actionClass).toBe('WAITING_ON_FACULTY')
  })

  it('does not call an incomplete matching projection member neglect', () => {
    const result = resolveResponsibility({
      responsibilityType: 'MATCHED_FOLLOW_UP', asOf, matchingComplete: false,
    })
    expect(result).toMatchObject({ queue: 'DATA_ROUTING', actionClass: 'DATA_GAP' })
  })

  it('retains expired calls only when live work remains', () => {
    const result = resolveResponsibility({
      responsibilityType: 'MATCHED_FOLLOW_UP', asOf, matchingComplete: true,
      deadline: '2026-09-20', activeApplications: 1,
    })
    expect(result).toMatchObject({ expired: true, retainedBecauseLiveWork: true })
  })
})
