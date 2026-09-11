import { describe, expect, it } from 'vitest'

import {
  NOT_TAKEN_UP_STATUSES,
  isTakenUp,
  notTakenUpSql,
  validateStatusTransition,
} from '@/lib/assignments/shared'

/**
 * LAPSED: the call closed and the faculty member never applied.
 *
 * Distinct from CANCELLED, which is the department withdrawing its own request.
 * Collapsing the two left dead work sitting in the overdue column indefinitely
 * and made "we pulled it" and "they let it die" the same number on every report.
 */

describe('lapsing an allocation', () => {
  it('is the department judgement, never the assignee own', () => {
    // A faculty member calling their own work dead is a decline, which already
    // exists and reads honestly to whoever finds the record later.
    const byAssignee = validateStatusTransition({
      from: 'ACCEPTED',
      to: 'LAPSED',
      isAssignee: true,
      canManage: false,
    })
    expect(byAssignee.allowed).toBe(false)

    const byManager = validateStatusTransition({
      from: 'ACCEPTED',
      to: 'LAPSED',
      isAssignee: false,
      canManage: true,
    })
    expect(byManager.allowed).toBe(true)
  })

  it('is reachable from every live state', () => {
    for (const from of ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] as const) {
      expect(
        validateStatusTransition({ from, to: 'LAPSED', isAssignee: false, canManage: true }).allowed
      ).toBe(true)
    }
  })

  it('is refused from a submitted record', () => {
    // Something that was submitted cannot also have gone unapplied for, and a
    // route that allowed it would let a bad close-out erase a real submission.
    const check = validateStatusTransition({
      from: 'COMPLETED',
      to: 'LAPSED',
      isAssignee: false,
      canManage: true,
    })
    expect(check.allowed).toBe(false)
  })

  it('can be reopened by a manager when the applicant did send it after all', () => {
    for (const to of ['ASSIGNED', 'IN_PROGRESS'] as const) {
      expect(
        validateStatusTransition({ from: 'LAPSED', to, isAssignee: false, canManage: true }).allowed
      ).toBe(true)
    }
    // But not by the assignee: the fact that reopens a lapse always arrives
    // from outside, and the department owns the record either way.
    expect(
      validateStatusTransition({
        from: 'LAPSED',
        to: 'IN_PROGRESS',
        isAssignee: true,
        canManage: false,
      }).allowed
    ).toBe(false)
  })
})

describe('not-taken-up predicate', () => {
  it('frees the call again, so it returns to the pending queue', () => {
    // The whole point of the state: a lapsed allocation must stop holding its
    // call out of the report whose job is to say "this still needs somebody".
    expect(isTakenUp('LAPSED')).toBe(false)
    expect(isTakenUp('CANCELLED')).toBe(false)
    expect(isTakenUp('DECLINED')).toBe(false)
    expect(NOT_TAKEN_UP_STATUSES).toContain('LAPSED')
  })

  it('leaves live and submitted work holding its call', () => {
    for (const status of ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED']) {
      expect(isTakenUp(status)).toBe(true)
    }
  })

  it('emits the statuses as SQL literals, not bound parameters', () => {
    // A bound parameter arrives typed as text, and Postgres has no
    // "CallAssignmentStatus" <> text operator, so the query fails outright
    // (42883). Literals stay untyped, coerce to the enum, and keep the status
    // index usable.
    const rendered = notTakenUpSql('ca').inspect()
    expect(rendered.sql).toContain("'LAPSED'")
    expect(rendered.sql).toContain('ca.status NOT IN')
    expect(rendered.values).toHaveLength(0)
  })
})
