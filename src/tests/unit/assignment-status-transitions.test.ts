import { describe, it, expect } from 'vitest'

import {
  ASSIGNMENT_STATUSES,
  validateStatusTransition,
  type AssignmentStatus,
} from '@/lib/assignments/shared'

/**
 * The lifecycle table decides who may record what, and the answer a faculty
 * member gives is the part no amount of managerial authority can supply. That
 * rule is asserted here rather than left to review discipline.
 */

const asAssignee = { isAssignee: true, canManage: false }
const asManager = { isAssignee: false, canManage: true }

function move(from: AssignmentStatus, to: AssignmentStatus, actor: typeof asAssignee) {
  return validateStatusTransition({ from, to, ...actor })
}

describe('validateStatusTransition: the faculty member answers for themselves', () => {
  it('lets the assignee accept or decline a fresh assignment', () => {
    expect(move('ASSIGNED', 'ACCEPTED', asAssignee).allowed).toBe(true)
    expect(move('ASSIGNED', 'DECLINED', asAssignee).allowed).toBe(true)
  })

  it('refuses to let a manager accept or decline on their behalf', () => {
    const accept = move('ASSIGNED', 'ACCEPTED', asManager)
    expect(accept.allowed).toBe(false)
    expect(accept.reason).toContain('Only the assigned faculty member')
    expect(move('ASSIGNED', 'DECLINED', asManager).allowed).toBe(false)
  })

  it('treats starting work as an implicit acceptance', () => {
    expect(move('ASSIGNED', 'IN_PROGRESS', asAssignee).allowed).toBe(true)
    expect(move('ACCEPTED', 'IN_PROGRESS', asAssignee).allowed).toBe(true)
  })

  it('allows a change of heart after accepting, but not after starting', () => {
    expect(move('ACCEPTED', 'DECLINED', asAssignee).allowed).toBe(true)
    expect(move('IN_PROGRESS', 'DECLINED', asAssignee).allowed).toBe(false)
  })
})

describe('validateStatusTransition: what a manager may do instead', () => {
  it('lets a manager cancel open work but not an assignee', () => {
    expect(move('ASSIGNED', 'CANCELLED', asManager).allowed).toBe(true)
    expect(move('IN_PROGRESS', 'CANCELLED', asManager).allowed).toBe(true)
    expect(move('ASSIGNED', 'CANCELLED', asAssignee).allowed).toBe(false)
  })

  it('lets a manager re-request a declined call', () => {
    expect(move('DECLINED', 'ASSIGNED', asManager).allowed).toBe(true)
    expect(move('DECLINED', 'CANCELLED', asManager).allowed).toBe(true)
  })

  it('does not let the assignee un-decline their own refusal', () => {
    expect(move('DECLINED', 'ASSIGNED', asAssignee).allowed).toBe(false)
    expect(move('DECLINED', 'ACCEPTED', asAssignee).allowed).toBe(false)
  })

  it('rejects moves that do not exist at all, and says so', () => {
    const result = move('CANCELLED', 'COMPLETED', asManager)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('cannot go from cancelled to completed')
  })

  it('treats a no-op as allowed so a resent request is not an error', () => {
    for (const status of ASSIGNMENT_STATUSES) {
      expect(move(status, status, asAssignee).allowed).toBe(true)
    }
  })
})

describe('validateStatusTransition: pre-existing flows still work', () => {
  it('keeps submission and re-opening available to the same actors as before', () => {
    expect(move('ASSIGNED', 'COMPLETED', asAssignee).allowed).toBe(true)
    expect(move('IN_PROGRESS', 'COMPLETED', asAssignee).allowed).toBe(true)
    expect(move('COMPLETED', 'IN_PROGRESS', asAssignee).allowed).toBe(true)
    expect(move('COMPLETED', 'ASSIGNED', asManager).allowed).toBe(true)
    expect(move('CANCELLED', 'ASSIGNED', asManager).allowed).toBe(true)
  })

  it('blocks a bystander with neither standing', () => {
    const result = validateStatusTransition({
      from: 'ASSIGNED',
      to: 'COMPLETED',
      isAssignee: false,
      canManage: false,
    })
    expect(result.allowed).toBe(false)
  })
})
